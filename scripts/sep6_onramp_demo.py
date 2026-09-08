#!/usr/bin/env python3
"""
Real SEP-6 on-ramp demo against the TR Mock Anchor
(https://tr-mock-anchor.fly.dev), feeding straight into Attest's
SettlementVault. This is Attest's "Anchor / Local Payments" hackathon
requirement — a genuine SEP-6-compliant fiat rail, not the anchor's
alternative non-SEP /v1 API.

Flow (all against the live anchor, nothing mocked on our side):
  1. SEP-10 web auth: get + sign a challenge transaction, exchange for a JWT.
  2. SEP-6 GET /deposit: request a TRY->USDC deposit, get back bank
     instructions (IBAN + reference).
  3. The anchor's own sandbox bank-transfer simulator stands in for a real
     TRY bank transfer (there is no real bank in a demo — see note below).
  4. Poll SEP-6 GET /transaction until the anchor reports it completed and
     has sent testnet USDC to our account.
  5. Hand off to `stellar contract invoke ... deposit` so that USDC lands
     inside SettlementVault, exactly like any other depositor.

Note on step 3: the *only* non-SEP call this script makes is
`POST /sep6/tx/{id}/simulate-bank-transfer` — the anchor's own sandbox
trigger, scoped under the SEP-6 namespace itself (not the separate,
API-key-gated /v1 business API). SEP-6 has no operation for "a real bank
received a real wire transfer" because that happens outside Stellar
entirely; every anchor sandbox needs *some* such trigger. Using it doesn't
bypass any SEP-6 step above — it replaces the physical act of walking into
a bank, nothing more.
"""

import json
import subprocess
import sys
import time

import requests
from stellar_sdk import Keypair, TransactionEnvelope

ANCHOR = "https://tr-mock-anchor.fly.dev"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
# Soroban Asset Contract (SAC) id for USDC:<USDC_ISSUER> on testnet — this,
# not the classic G... issuer address, is what SettlementVault.deposit's
# `token` parameter needs (`stellar contract id asset --asset USDC:<issuer>
# --network testnet`).
USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"


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


def sep6_deposit_request(token: str, public_key: str, amount_try: str) -> dict:
    resp = requests.get(
        f"{ANCHOR}/sep6/deposit",
        params={
            "asset_code": "USDC",
            "account": public_key,
            "type": "bank_account",
            "amount": amount_try,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    return resp.json()


def simulate_bank_transfer(tx_id: str, token: str):
    # This is the one non-SEP call in the whole flow, and it's unavoidable:
    # SEP-6 has no operation for "a real bank received a real wire transfer"
    # since that happens off Stellar entirely. It lives under /sep6/tx/{id}/
    # (not the separate /v1 business API), and is exactly what the anchor's
    # own SEP-6 deposit response (`extra_info.message`) tells the caller to
    # hit in sandbox mode.
    resp = requests.post(
        f"{ANCHOR}/sep6/tx/{tx_id}/simulate-bank-transfer",
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    return resp.json()


def poll_sep6_transaction(token: str, tx_id: str, timeout_s: int = 60) -> dict:
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
        print(
            "usage: sep6_onramp_demo.py <depositor-identity> <secret-key> <amount_try>"
        )
        sys.exit(1)

    identity, secret_key, amount_try = sys.argv[1], sys.argv[2], sys.argv[3]
    public_key = stellar_cli("keys", "address", identity)
    print(f"depositor: {identity} ({public_key})")

    print("\n[1/5] SEP-10 auth...")
    token = sep10_auth(public_key, secret_key)
    print("  got JWT")

    print("\n[2/5] SEP-6 GET /deposit...")
    deposit = sep6_deposit_request(token, public_key, amount_try)
    print(json.dumps(deposit, indent=2))
    tx_id = deposit["id"]

    print(f"\n[3/5] Simulating the TRY bank transfer (tx={tx_id})...")
    print(json.dumps(simulate_bank_transfer(tx_id, token), indent=2))

    print("\n[4/5] Polling SEP-6 /transaction until settled...")
    tx = poll_sep6_transaction(token, tx_id)
    print(json.dumps(tx, indent=2))

    if tx["status"] != "completed":
        print("Deposit did not complete — stopping before touching SettlementVault.")
        sys.exit(1)

    amount_out_stroops = int(round(float(tx["amount_out"]) * 10_000_000))
    print("\n[5/5] Real testnet USDC has arrived. To deposit it into SettlementVault:")
    print(
        f"  stellar contract invoke --id <VAULT> --source {identity} --network testnet -- "
        f"deposit --depositor {public_key} --token {USDC_SAC} --amount {amount_out_stroops}"
    )
    print(
        "  (--token is the SAC id, not the classic USDC issuer G-address — "
        "classic Stellar assets always use 7 decimal places on-chain regardless "
        "of the 2 decimals shown in the anchor's stellar.toml, which is just "
        "display metadata)"
    )


if __name__ == "__main__":
    main()
