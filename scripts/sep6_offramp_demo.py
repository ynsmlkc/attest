#!/usr/bin/env python3
"""
Real SEP-6 off-ramp demo against the TR Mock Anchor: takes USDC a user just
withdrew out of SettlementVault and sends it back out through the same
SEP-6 anchor as a (simulated) TRY payout — closing the loop the on-ramp
script (sep6_onramp_demo.py) opens.

Flow:
  1. SEP-10 auth (same as on-ramp).
  2. SEP-6 GET /withdraw: get the anchor's treasury account, memo, and
     memo_type.
  3. Build, sign, and submit a REAL on-chain USDC payment to that account
     with that memo — via Python's stellar_sdk directly, NOT
     `stellar tx new payment`, which has no memo flag at all (checked its
     --help: only --destination/--asset/--amount). SEP-6 withdrawals are
     unusable without a memo (that memo is the anchor's only way to match
     an incoming payment back to a specific withdrawal request), so this
     script builds the transaction itself instead.
  4. Poll SEP-6 GET /transaction until the anchor reports it completed and
     records the (simulated) TRY payout.
"""

import json
import subprocess
import sys
import time

import requests
from stellar_sdk import Asset, HashMemo, IdMemo, Keypair, Network, Server, TextMemo, TransactionBuilder, TransactionEnvelope

ANCHOR = "https://tr-mock-anchor.fly.dev"
USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

MEMO_BUILDERS = {
    "id": lambda v: IdMemo(int(v)),
    "text": lambda v: TextMemo(v),
    "hash": lambda v: HashMemo(bytes.fromhex(v)),
}


def stellar_cli(*args):
    result = subprocess.run(
        ["stellar", *args], capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def sep10_auth(public_key: str, secret_key: str) -> str:
    challenge = requests.get(f"{ANCHOR}/auth", params={"account": public_key}).json()
    envelope = TransactionEnvelope.from_xdr(
        challenge["transaction"], challenge["network_passphrase"]
    )
    envelope.sign(Keypair.from_secret(secret_key))
    resp = requests.post(
        f"{ANCHOR}/auth", json={"transaction": envelope.to_xdr()}
    ).json()
    return resp["token"]


def sep6_withdraw_request(token: str, amount_usdc: str) -> dict:
    resp = requests.get(
        f"{ANCHOR}/sep6/withdraw",
        params={"asset_code": "USDC", "type": "bank_account", "amount": amount_usdc},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    return resp.json()


def poll_sep6_transaction(token: str, tx_id: str, timeout_s: int = 90) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = requests.get(
            f"{ANCHOR}/sep6/transaction",
            params={"id": tx_id},
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        tx = resp["transaction"]
        print(f"  transaction status: {tx['status']}")
        if tx["status"] in ("completed", "error"):
            return tx
        time.sleep(3)
    raise TimeoutError(f"SEP-6 transaction {tx_id} did not settle in {timeout_s}s")


def main():
    if len(sys.argv) != 4:
        print("usage: sep6_offramp_demo.py <identity> <secret-key> <amount_usdc>")
        sys.exit(1)

    identity, secret_key, amount_usdc = sys.argv[1], sys.argv[2], sys.argv[3]
    public_key = stellar_cli("keys", "address", identity)
    print(f"withdrawer: {identity} ({public_key})")

    print("\n[1/4] SEP-10 auth...")
    token = sep10_auth(public_key, secret_key)
    print("  got JWT")

    print("\n[2/4] SEP-6 GET /withdraw...")
    withdraw = sep6_withdraw_request(token, amount_usdc)
    print(json.dumps(withdraw, indent=2))
    tx_id = withdraw["id"]
    dest_account = withdraw["account_id"]
    memo_type = withdraw["memo_type"]
    memo = MEMO_BUILDERS[memo_type](withdraw["memo"])

    print(f"\n[3/4] Sending real on-chain USDC payment to {dest_account} "
          f"(memo type={memo_type} value={withdraw['memo']})...")
    kp = Keypair.from_secret(secret_key)
    server = Server("https://horizon-testnet.stellar.org")
    source_account = server.load_account(kp.public_key)
    asset = Asset("USDC", USDC_ISSUER)
    tx = (
        TransactionBuilder(
            source_account=source_account,
            network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
            base_fee=100,
        )
        .add_memo(memo)
        .append_payment_op(destination=dest_account, asset=asset, amount=amount_usdc)
        .set_timeout(60)
        .build()
    )
    tx.sign(kp)
    submit_result = server.submit_transaction(tx)
    print(f"  stellar_transaction_id={submit_result['hash']} successful={submit_result['successful']}")

    print("\n[4/4] Polling SEP-6 /transaction until settled...")
    tx_status = poll_sep6_transaction(token, tx_id)
    print(json.dumps(tx_status, indent=2))


if __name__ == "__main__":
    main()
