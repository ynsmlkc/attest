import { Account, Contract, TransactionBuilder, contract, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";
import { NETWORK_PASSPHRASE, REFLECTOR_DECIMALS, REFLECTOR_ORACLE_ID, RPC_URL } from "./config";

export interface PricePoint {
  price: number;
  timestamp: number; // seconds
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number; // bucket start, seconds
}

const server = new SorobanRpc.Server(RPC_URL);

/**
 * Reflector's `prices(asset, records)` -- returns the last `records`
 * samples (newest first, resolution() seconds apart -- 300s/5min on this
 * pool, confirmed live). This is the ONLY real historical price source
 * this app uses; there is no synthetic/random-walk fallback. If the oracle
 * has fewer records than asked for (its history_retention_period is 24h,
 * confirmed live: 86400s), this simply returns fewer points.
 */
export async function getReflectorPriceHistory(
  symbol: string,
  records: number,
): Promise<PricePoint[]> {
  const assetScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    nativeToScVal(symbol, { type: "symbol" }),
  ]);
  const account = new Account(contract.NULL_ACCOUNT, "0");
  const op = new Contract(REFLECTOR_ORACLE_ID).call(
    "prices",
    assetScVal,
    nativeToScVal(records, { type: "u32" }),
  );
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) return [];
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) return [];

  const native = scValToNative(sim.result.retval) as
    | Array<{ price: bigint; timestamp: bigint }>
    | undefined;
  if (!native) return [];

  return native
    .map((p) => ({
      price: Number(p.price) / 10 ** REFLECTOR_DECIMALS,
      timestamp: Number(p.timestamp),
    }))
    .sort((a, b) => a.timestamp - b.timestamp); // oldest first
}

/** Single historical point via Reflector's `price(asset, timestamp)`. */
async function getReflectorPriceAt(symbol: string, timestamp: number): Promise<PricePoint | null> {
  const assetScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    nativeToScVal(symbol, { type: "symbol" }),
  ]);
  const account = new Account(contract.NULL_ACCOUNT, "0");
  const op = new Contract(REFLECTOR_ORACLE_ID).call(
    "price",
    assetScVal,
    nativeToScVal(timestamp, { type: "u64" }),
  );
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) return null;
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) return null;
  const native = scValToNative(sim.result.retval) as
    | { price: bigint; timestamp: bigint }
    | undefined;
  if (!native) return null;
  return { price: Number(native.price) / 10 ** REFLECTOR_DECIMALS, timestamp: Number(native.timestamp) };
}

/**
 * Real ~24h price history, mixing two genuine Reflector sources:
 *  - `prices(asset, 20)`: the most recent ~21 samples at native 5-minute
 *    resolution (confirmed live -- this oracle rejects records > 20 with a
 *    null return, not an error, so 20 is a hard ceiling, not a guess).
 *  - `price(asset, timestamp)` at hourly anchors further back: confirmed
 *    live to resolve up to ~20-21h ago; 23h ago returned null (the
 *    contract's 86400s history_retention_period, minus rounding near the
 *    boundary).
 * No interpolation and no synthetic points are added for gaps -- an hour
 * with no real sample simply contributes nothing.
 */
export async function getRealPriceHistory24h(symbol: string): Promise<PricePoint[]> {
  const recent = await getReflectorPriceHistory(symbol, 20);
  const nowSec = Math.floor(Date.now() / 1000);
  const hourlyOffsets = Array.from({ length: 21 }, (_, i) => (i + 2) * 3600); // 2h..22h ago
  const hourly = await Promise.all(
    hourlyOffsets.map((offset) => getReflectorPriceAt(symbol, nowSec - offset)),
  );
  const merged = [...recent, ...hourly.filter((p): p is PricePoint => p !== null)];
  const seen = new Set<number>();
  return merged
    .filter((p) => (seen.has(p.timestamp) ? false : (seen.add(p.timestamp), true)))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Groups real price samples into fixed-size time buckets and derives real
 * OHLC from the samples actually observed in each bucket -- open/close are
 * the first/last real samples in the bucket, high/low are the real
 * max/min. No interpolation, no invented wicks: a bucket with only one
 * sample becomes a flat candle (open=high=low=close), which is the honest
 * result when the oracle simply didn't publish more than one price in
 * that window.
 */
export function bucketIntoCandles(points: PricePoint[], bucketSeconds: number): Candle[] {
  if (points.length === 0) return [];
  const buckets = new Map<number, PricePoint[]>();
  for (const p of points) {
    const bucketStart = Math.floor(p.timestamp / bucketSeconds) * bucketSeconds;
    const arr = buckets.get(bucketStart) ?? [];
    arr.push(p);
    buckets.set(bucketStart, arr);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, samples]) => {
      const prices = samples.map((s) => s.price);
      return {
        timestamp,
        open: samples[0].price,
        close: samples[samples.length - 1].price,
        high: Math.max(...prices),
        low: Math.min(...prices),
      };
    });
}
