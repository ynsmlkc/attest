"use strict";

/**
 * Runs inside a real Phala Cloud TDX CVM.
 *
 * On startup, derives this instance's Stellar keypair from dstack's
 * enclave-bound key derivation (`DstackClient.getKey`) -- the raw 32-byte
 * result is used directly as a Stellar Keypair.fromRawEd25519Seed(), which
 * is byte-for-byte what dstack-sdk's own `toKeypairSecure` helper does for
 * Solana (same ed25519 curve, verified against dstack-sdk's actual source,
 * not assumed -- see README). The resulting secret key never leaves this
 * process; the derivation is deterministic per (app measurement, path), so
 * a genuine TDX enclave running this exact code always re-derives the same
 * key, and no other code -- including a different version of this service
 * -- can reproduce it.
 *
 * Holds a tiny in-memory order book and matches exact opposite pairs
 * (A gives X wants Y amount == B gives Y wants X amount). On a match, signs
 * and submits SettlementVault.settle() with its own derived key -- this is
 * the actual point of the exercise: `engine_address` on-chain is genuinely
 * the address of a key that was generated inside, and never left, a
 * verified TEE. Deliberately not a general order-matching engine (no
 * partial fills, no price levels) -- the goal is proving the attestation
 * chain end to end, not building an exchange.
 */

const express = require("express");
const { DstackClient } = require("@phala/dstack-sdk");
const { Keypair, Networks, contract } = require("@stellar/stellar-sdk");

const PORT = process.env.PORT || 80;
const RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const KEY_PATH = process.env.ENGINE_KEY_PATH || "attest/matching-engine/v1";

let engineKeypair = null;
const orders = []; // { id, party, giveToken, giveAmount, wantToken, wantAmount }
const matches = []; // { orderAId, orderBId, txHash, at }
let nextOrderId = 1;

// SettlementVault/enclave_id are deliberately RUNTIME config, not
// compose-baked env vars: Phala's RTMR3 (the app-specific measurement -- see
// attestation-verifier's README/lib.rs) is computed over the whole
// docker-compose.yaml, environment included. Baking a specific vault ID in
// would mean every vault change produces a different measurement, which
// would need re-registering against a new AttestationVerifier each time --
// a circular dependency, since the verifier needs to know the enclave's
// measurement, which would depend on which verifier/vault it's configured
// to call. Setting these via POST /configure after boot keeps the image's
// measurement stable regardless of which vault it's later pointed at.
let settlementVaultId = process.env.SETTLEMENT_VAULT_ID || null;
let enclaveIdHex = process.env.ENCLAVE_ID_HEX || null;

async function deriveEngineKeypair() {
  const client = new DstackClient();
  const result = await client.getKey(KEY_PATH);
  // result.key is a Uint8Array(32) -- the raw ed25519 seed. Verified against
  // dstack-sdk's own source (dist/solana.js): the modern getKey() path feeds
  // this directly into Keypair.fromSeed() with no extra hashing (the SHA256
  // step in `toKeypairSecure` only applies to the deprecated deriveKey/TLS
  // path). Stellar's Keypair.fromRawEd25519Seed does the equivalent thing.
  return Keypair.fromRawEd25519Seed(Buffer.from(result.key));
}

function hexToBytes(hex) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

async function contractClient(contractId) {
  return contract.Client.from({
    contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: engineKeypair.publicKey(),
    signTransaction: engineKeypair,
  });
}

function findMatch() {
  for (let i = 0; i < orders.length; i++) {
    for (let j = 0; j < orders.length; j++) {
      if (i === j) continue;
      const a = orders[i];
      const b = orders[j];
      if (
        a.giveToken === b.wantToken &&
        a.giveAmount === b.wantAmount &&
        b.giveToken === a.wantToken &&
        b.giveAmount === a.wantAmount
      ) {
        return [a, b];
      }
    }
  }
  return null;
}

async function trySettleMatch() {
  const match = findMatch();
  if (!match) return null;
  const [a, b] = match;

  if (!settlementVaultId || !enclaveIdHex) {
    throw new Error("settlementVaultId and enclaveIdHex must be set via POST /configure first");
  }

  const client = await contractClient(settlementVaultId);
  const tx = await client.settle({
    enclave_id: hexToBytes(enclaveIdHex),
    engine: engineKeypair.publicKey(),
    token_a: a.giveToken,
    party_a: a.party,
    amount_a: BigInt(a.giveAmount),
    token_b: b.giveToken,
    party_b: b.party,
    amount_b: BigInt(b.giveAmount),
  });
  const sent = await tx.signAndSend();

  orders.splice(orders.indexOf(a), 1);
  orders.splice(orders.indexOf(b), 1);
  const record = {
    orderAId: a.id,
    orderBId: b.id,
    txHash: sent.sendTransactionResponse ? sent.sendTransactionResponse.hash : null,
    at: new Date().toISOString(),
  };
  matches.push(record);
  return record;
}

async function main() {
  console.log(`Deriving engine keypair from dstack (path=${KEY_PATH})...`);
  engineKeypair = await deriveEngineKeypair();
  console.log(`Engine Stellar address: ${engineKeypair.publicKey()}`);

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/pubkey", (_req, res) => {
    res.json({ publicKey: engineKeypair.publicKey() });
  });

  // Runtime-only config -- see the module-level comment on
  // settlementVaultId/enclaveIdHex for why these aren't compose env vars.
  app.post("/configure", (req, res) => {
    const { settlementVaultId: v, enclaveIdHex: e } = req.body;
    if (v) settlementVaultId = v;
    if (e) enclaveIdHex = e;
    res.json({ ok: true, settlementVaultId, enclaveIdHex });
  });

  app.get("/config", (_req, res) => {
    res.json({ settlementVaultId, enclaveIdHex });
  });

  // Registers this exact running enclave against a deployed
  // AttestationVerifier. `payload`/`signature`/`enclaveId` come from a real
  // quote fetched externally via `phala cvms attestation` for THIS CVM (see
  // README) -- this endpoint's only job is to sign the registration with
  // the key that only exists inside this enclave.
  app.post("/register", async (req, res) => {
    try {
      const { verifierContractId, payload, signature, enclaveId, teeType } = req.body;
      const client = await contractClient(verifierContractId);
      const tx = await client.register_verified_enclave({
        tee_type: { tag: teeType || "IntelTdx", values: undefined },
        payload: hexToBytes(payload),
        signature: hexToBytes(signature),
        enclave_id: hexToBytes(enclaveId),
        engine_address: engineKeypair.publicKey(),
      });
      const sent = await tx.signAndSend();
      res.json({ ok: true, hash: sent.sendTransactionResponse ? sent.sendTransactionResponse.hash : null });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post("/orders", async (req, res) => {
    const { party, giveToken, giveAmount, wantToken, wantAmount } = req.body;
    if (!party || !giveToken || !giveAmount || !wantToken || !wantAmount) {
      return res.status(400).json({ ok: false, error: "missing fields" });
    }
    const order = {
      id: nextOrderId++,
      party,
      giveToken,
      giveAmount: Number(giveAmount),
      wantToken,
      wantAmount: Number(wantAmount),
    };
    orders.push(order);
    try {
      const settled = await trySettleMatch();
      res.json({ ok: true, order, settled });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: true, order, settleError: String(err) });
    }
  });

  app.get("/orders", (_req, res) => res.json({ orders }));
  app.get("/matches", (_req, res) => res.json({ matches }));

  app.listen(PORT, () => console.log(`matching-engine listening on :${PORT}`));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
