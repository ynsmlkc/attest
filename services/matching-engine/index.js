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
 * Holds an in-memory limit-order book (matcher.js): price-time priority,
 * partial fills, trades at the resting order's price. On a fill, signs and
 * submits SettlementVault.settle() with its own derived key -- this is
 * the actual point of the exercise: `engine_address` on-chain is genuinely
 * the address of a key that was generated inside, and never left, a
 * verified TEE. What the pool can't match is routed to Soroswap through the
 * vault's settle_external, at the trader's signed limit price or better.
 * Deliberately still a small engine (no cancel, no persistence) -- the goal
 * is proving the attestation chain end to end, not building a full exchange.
 */

const crypto = require("crypto");
const express = require("express");
const { DstackClient } = require("@phala/dstack-sdk");
const { Keypair, Networks, contract } = require("@stellar/stellar-sdk");
const { findFill, applyFill, minOutFor, externalCandidates } = require("./matcher");

const PORT = process.env.PORT || 80;
const RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const KEY_PATH = process.env.ENGINE_KEY_PATH || "attest/matching-engine/v1";
const ADMIN_KEY = process.env.ADMIN_KEY || null;

// /configure and /register are operator-only actions (repointing which vault
// this engine settles against, registering this enclave's own attestation) --
// they have nothing to do with SEP-53 order signing (which authenticates a
// *trader's* wallet, not the operator) and previously had no protection at
// all. Fails closed: if ADMIN_KEY isn't set, these routes are unusable rather
// than silently open. Constant-time compare so response timing can't leak
// the secret one byte at a time.
function requireAdminKey(req, res, next) {
  const provided = req.headers["x-admin-key"];
  if (!ADMIN_KEY || typeof provided !== "string") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  next();
}

let engineKeypair = null;
const orders = []; // { id, party, giveToken, giveAmount, wantToken, wantAmount, remaining }
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

// SEP-0053 order signing -- without this, anyone who knows a depositor's
// public address (visible on-chain from their own deposit() call) could
// submit an order claiming to be them; the engine had no way to tell.
// Client-side counterpart: web/src/lib/orderSigning.ts -- the canonical
// message built there MUST match canonicalOrderMessage() below byte for
// byte, since this rebuilds it independently rather than trusting the
// caller's copy. Freighter's signMessage() was verified live (browser
// console, against Keypair.verify) to implement SEP-53 exactly: raw
// 64-byte ed25519 over SHA256("Stellar Signed Message:\n" + message).
//
// SEP-53 itself specifies no replay defense, so this adds its own: `ts`
// must fall inside a short window of the server's clock, and a signature
// already seen inside that window is rejected outright.
const SIGNATURE_WINDOW_MS = 120_000;
const seenSignatures = new Map(); // signature -> ts, pruned opportunistically

// v2 bound the signature to one specific deploy (settlement vault + enclave
// id). Without that, a captured signed order would also be valid against any
// other engine instance (a mainnet engine, a parallel testnet one) that
// reuses this scheme. Both values come from this engine's own /configure
// state, never from the caller, so a signature made for a different deploy
// fails verification here.
//
// v3 adds ROUTING_CLAUSE as the last line: signing it is the trader's consent
// to this engine sending an unmatched remainder to Soroswap (there is no
// per-order switch -- routing pool-first-then-Soroswap is how this venue
// works, and the wallet prompt shows the line). The vault verifies the very
// same text on-chain, so it must match SettlementVault's ROUTING_CLAUSE and
// web/src/lib/orderSigning.ts byte for byte.
const ROUTING_CLAUSE = "\nrouting:pool first, then Soroswap at your limit or better";

function canonicalOrderMessage({ party, giveToken, giveAmount, wantToken, wantAmount, ts }) {
  return `Attest order v3\nvault:${settlementVaultId}\nenclave:${enclaveIdHex}\nparty:${party}\ngive:${giveToken}:${giveAmount}\nwant:${wantToken}:${wantAmount}\nts:${ts}${ROUTING_CLAUSE}`;
}

function verifyOrderSignature(fields) {
  const { party, ts, signature } = fields;
  if (!ts || !signature) return { ok: false, reason: "missing ts or signature" };
  const now = Date.now();
  for (const [sig, seenAt] of seenSignatures) {
    if (now - seenAt > SIGNATURE_WINDOW_MS) seenSignatures.delete(sig);
  }
  if (Math.abs(now - Number(ts)) > SIGNATURE_WINDOW_MS) {
    return { ok: false, reason: "timestamp outside the signing window" };
  }
  if (seenSignatures.has(signature)) {
    return { ok: false, reason: "signature already used" };
  }
  const message = canonicalOrderMessage(fields);
  const hash = crypto.createHash("sha256").update("Stellar Signed Message:\n" + message).digest();
  let verified = false;
  try {
    verified = Keypair.fromPublicKey(party).verify(hash, Buffer.from(signature, "base64"));
  } catch {
    return { ok: false, reason: "invalid party address or signature encoding" };
  }
  if (!verified) return { ok: false, reason: "signature does not match party" };
  seenSignatures.set(signature, now);
  return { ok: true };
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

// A pair whose settle() failed is skipped for a while, so one pair the vault
// keeps rejecting (e.g. off-market vs. the Reflector guard) can't jam the
// whole book -- other crossing pairs keep matching. Expires, since a failure
// can also be transient (RPC hiccup).
const FAILED_PAIR_TTL_MS = 60_000;
const failedPairs = new Map(); // "makerId:takerId" -> expiry (ms)

function isPairBlocked(maker, taker) {
  const key = `${maker.id}:${taker.id}`;
  const until = failedPairs.get(key);
  if (until === undefined) return false;
  if (Date.now() > until) {
    failedPairs.delete(key);
    return false;
  }
  return true;
}

// Serializes trySettleMatch(): it awaits a real network round-trip (sign +
// submit) between findFill() and the order-book update, so two concurrent
// POST /orders could otherwise match the same pair twice or splice a stale
// index. The tail never rejects, so one failed settle doesn't wedge the queue.
let settleQueue = Promise.resolve();
function withSettleLock(fn) {
  const run = settleQueue.then(fn);
  settleQueue = run.catch(() => {});
  return run;
}

function trySettleMatch(newOrder) {
  return withSettleLock(() => settleAllMatches(newOrder));
}

// Repeatedly matches until nothing crosses: a partial fill can leave a
// remainder that still crosses another resting order. Returns the settled
// records (oldest first) and the last error, if any pair failed.
//
// Once the pool has nothing more to match, whatever is left of the incoming
// order is routed to external liquidity (Soroswap, via the vault's
// settle_external) at the trader's signed limit price or better -- pool first,
// external second.
async function settleAllMatches(newOrder) {
  const records = [];
  let error = null;
  for (;;) {
    const fill = findFill(orders, isPairBlocked);
    if (!fill) break;
    try {
      records.push(await settleFill(fill));
    } catch (err) {
      console.error(err);
      error = err;
      failedPairs.set(`${fill.maker.id}:${fill.taker.id}`, Date.now() + FAILED_PAIR_TTL_MS);
    }
  }
  if (newOrder && orders.includes(newOrder)) {
    const ext = await tryRouteExternal(newOrder);
    if (ext) records.push(ext);
  }
  return { records, error };
}

// --- External routing (Soroswap Aggregator, through SettlementVault.settle_external)
//
// The engine only *decides* to route and picks the size; the vault verifies
// the trader's own signature, size and limit price on-chain and builds the
// route itself, so a compromised engine can't route worse than a trader
// signed for. The whole remainder is tried at once with amount_out_min = the
// signed limit price: if the market can't deliver that, the simulation fails,
// nothing is sent, and the order keeps resting (retried by the sweep below).
let externalRouting = process.env.EXTERNAL_ROUTING !== "off";
const EXTERNAL_RETRY_MS = 60_000; // per-order backoff after a failed attempt
const EXTERNAL_SWEEP_MS = Number(process.env.EXTERNAL_SWEEP_MS) || 60_000;
const EXTERNAL_DEADLINE_SECS = 300;
const externalBackoff = new Map(); // orderId -> retry-not-before (ms)

function isExternalBlocked(order) {
  const until = externalBackoff.get(order.id);
  if (until === undefined) return false;
  if (Date.now() > until) {
    externalBackoff.delete(order.id);
    return false;
  }
  return true;
}

async function tryRouteExternal(order) {
  if (!externalRouting || !settlementVaultId || !enclaveIdHex) return null;
  if (order.remaining <= 0 || isExternalBlocked(order)) return null;
  try {
    return await routeExternal(order);
  } catch (err) {
    // Expected whenever the market is worse than the limit (the vault/aggregator
    // rejects in simulation), or no Soroswap route exists for the pair.
    externalBackoff.set(order.id, Date.now() + EXTERNAL_RETRY_MS);
    console.log(`order ${order.id}: not routed externally (${String(err.message || err).slice(0, 160)})`);
    return null;
  }
}

async function routeExternal(order) {
  const amountIn = BigInt(order.remaining);
  const client = await contractClient(settlementVaultId);
  const tx = await client.settle_external({
    enclave_id: hexToBytes(enclaveIdHex),
    engine: engineKeypair.publicKey(),
    order: toSignedOrder(order),
    amount_in: amountIn,
    amount_out_min: minOutFor(order, amountIn),
    deadline: BigInt(Math.floor(Date.now() / 1000) + EXTERNAL_DEADLINE_SECS),
  });
  const sent = await tx.signAndSend();
  // The vault returns what it actually credited (may beat the minimum). The
  // SDK hands a Result-returning contract fn back wrapped (Ok/Err).
  const rawResult = sent.result;
  const received =
    rawResult && typeof rawResult.unwrap === "function" ? rawResult.unwrap() : rawResult;

  order.remaining = 0;
  orders.splice(orders.indexOf(order), 1);
  const record = {
    orderAId: order.id,
    orderBId: null,
    venue: "soroswap",
    txHash: sent.sendTransactionResponse ? sent.sendTransactionResponse.hash : null,
    at: new Date().toISOString(),
    partyA: order.party,
    partyB: null,
    giveTokenA: order.giveToken,
    giveAmountA: Number(amountIn),
    giveTokenB: order.wantToken,
    giveAmountB: received == null ? null : Number(received),
  };
  matches.push(record);
  return record;
}

// Resting orders get another look periodically: the market may have moved to
// (or past) their limit since they arrived.
function sweepExternal() {
  return withSettleLock(async () => {
    for (const order of externalCandidates(orders, isExternalBlocked)) {
      if (orders.includes(order)) await tryRouteExternal(order);
    }
  });
}

function toSignedOrder(o) {
  return {
    party: o.party,
    give_token: o.giveToken,
    give_amount: BigInt(o.giveAmount),
    want_token: o.wantToken,
    want_amount: BigInt(o.wantAmount),
    ts: BigInt(o.ts),
    signature: Buffer.from(o.signature, "base64"),
  };
}

async function settleFill(fill) {
  const a = fill.maker;
  const b = fill.taker;

  if (!settlementVaultId || !enclaveIdHex) {
    throw new Error("settlementVaultId and enclaveIdHex must be set via POST /configure first");
  }

  const client = await contractClient(settlementVaultId);
  // The vault re-verifies each trader's own signature on-chain, so the
  // orders go in exactly as signed; only the fill sizes are the engine's call.
  const tx = await client.settle({
    enclave_id: hexToBytes(enclaveIdHex),
    engine: engineKeypair.publicKey(),
    order_a: toSignedOrder(a),
    fill_a: fill.amountMaker,
    order_b: toSignedOrder(b),
    fill_b: fill.amountTaker,
  });
  const sent = await tx.signAndSend();

  // Deduct only after settle() succeeded on-chain; fully-filled orders leave
  // the book, partially-filled ones stay with a smaller `remaining`.
  for (const done of applyFill(fill)) {
    orders.splice(orders.indexOf(done), 1);
  }
  // partyA/partyB + token/amount fields let the UI show a wallet's own
  // settled history (pair, gave, received, fill price) without re-deriving
  // it from the ledger tx -- older clients that only know orderAId/orderBId
  // still work, these are additive. Amounts are this fill's, not the
  // orders' original sizes.
  const record = {
    orderAId: a.id,
    orderBId: b.id,
    txHash: sent.sendTransactionResponse ? sent.sendTransactionResponse.hash : null,
    at: new Date().toISOString(),
    partyA: a.party,
    partyB: b.party,
    giveTokenA: a.giveToken,
    giveAmountA: Number(fill.amountMaker),
    giveTokenB: b.giveToken,
    giveAmountB: Number(fill.amountTaker),
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
  // The web UI's fetch() calls always send Content-Type: application/json
  // (even on GET), which forces a CORS preflight -- without this, the
  // browser blocks every request after the preflight with no visible error
  // beyond "Failed to fetch", indistinguishable from the CVM actually being
  // down. Confirmed live: curl (no CORS enforcement) reached this API fine
  // while the browser silently failed on it, before this fix.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/pubkey", (_req, res) => {
    res.json({ publicKey: engineKeypair.publicKey() });
  });

  // Runtime-only config -- see the module-level comment on
  // settlementVaultId/enclaveIdHex for why these aren't compose env vars.
  app.post("/configure", requireAdminKey, (req, res) => {
    const { settlementVaultId: v, enclaveIdHex: e, externalRouting: x } = req.body;
    if (v) settlementVaultId = v;
    if (e) enclaveIdHex = e;
    if (typeof x === "boolean") externalRouting = x;
    res.json({ ok: true, settlementVaultId, enclaveIdHex, externalRouting });
  });

  app.get("/config", (_req, res) => {
    res.json({ settlementVaultId, enclaveIdHex, externalRouting });
  });

  // Registers this exact running enclave against a deployed
  // AttestationVerifier. `payload`/`signature`/`enclaveId` come from a real
  // quote fetched externally via `phala cvms attestation` for THIS CVM (see
  // README) -- this endpoint's only job is to sign the registration with
  // the key that only exists inside this enclave.
  app.post("/register", requireAdminKey, async (req, res) => {
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
    const { party, giveToken, giveAmount, wantToken, wantAmount, ts, signature } = req.body;
    if (!party || !giveToken || !giveAmount || !wantToken || !wantAmount) {
      return res.status(400).json({ ok: false, error: "missing fields" });
    }
    // Guards against a malformed/negative amount getting into the in-memory
    // order book, where it would keep producing an unsettleable pair.
    const giveAmountNum = Number(giveAmount);
    const wantAmountNum = Number(wantAmount);
    if (!Number.isFinite(giveAmountNum) || giveAmountNum <= 0 || !Number.isFinite(wantAmountNum) || wantAmountNum <= 0) {
      return res.status(400).json({ ok: false, error: "giveAmount/wantAmount must be positive finite numbers" });
    }
    // The vault rebuilds the signed text on-chain from integer i128 amounts
    // and a u64 ts, so anything that isn't a canonical integer here (1.5,
    // "0100", 1e21) would sign fine off-chain but never verify on-chain.
    const canonicalInt = (raw, n) => Number.isSafeInteger(n) && String(raw) === String(n);
    if (!canonicalInt(giveAmount, giveAmountNum) || !canonicalInt(wantAmount, wantAmountNum) || !canonicalInt(ts, Number(ts))) {
      return res.status(400).json({ ok: false, error: "giveAmount/wantAmount/ts must be plain integers (stroops / ms)" });
    }
    if (!settlementVaultId || !enclaveIdHex) {
      return res.status(503).json({ ok: false, error: "engine not configured yet: settlementVaultId and enclaveIdHex must be set via POST /configure" });
    }
    const sig = verifyOrderSignature({ party, giveToken, giveAmount, wantToken, wantAmount, ts, signature });
    if (!sig.ok) {
      return res.status(401).json({ ok: false, error: `order signature check failed: ${sig.reason}` });
    }
    const order = {
      id: nextOrderId++,
      party,
      giveToken,
      giveAmount: giveAmountNum,
      wantToken,
      wantAmount: wantAmountNum,
      // Still unfilled, in giveToken units; shrinks with each partial fill.
      remaining: giveAmountNum,
      // Kept exactly as signed: the vault verifies it again on-chain.
      ts: Number(ts),
      signature,
      createdAt: new Date().toISOString(),
    };
    orders.push(order);
    const { error } = await trySettleMatch(order);
    // Concurrent requests are serialized, so an earlier request's settle loop
    // may already have filled this order (it was in the book by then). Report
    // from the match log, not from this call's own loop, so every caller sees
    // the fills that involved *their* order.
    // `settled` stays a single match record (the first fill) so existing
    // clients keep working; `fills` carries all of them when one order
    // walks several resting orders.
    const fills = matches.filter((m) => m.orderAId === order.id || m.orderBId === order.id);
    if (fills.length === 0 && error) {
      return res.status(500).json({ ok: true, order, settleError: String(error) });
    }
    res.json({ ok: true, order, settled: fills[0] || null, fills });
  });

  // The signature stays server-side: it's only useful to whoever submits the
  // order to the vault, and there's no reason to publish it.
  app.get("/orders", (_req, res) =>
    res.json({ orders: orders.map(({ signature, ts, ...rest }) => rest) }),
  );
  app.get("/matches", (_req, res) => res.json({ matches }));

  setInterval(() => sweepExternal().catch((err) => console.error(err)), EXTERNAL_SWEEP_MS).unref();

  app.listen(PORT, () => console.log(`matching-engine listening on :${PORT}`));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
