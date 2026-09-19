import { MATCHING_ENGINE_URL } from "./config";

export interface Order {
  id: number;
  party: string;
  giveToken: string;
  giveAmount: number;
  wantToken: string;
  wantAmount: number;
  /** Absent on orders placed before this field was added to the engine. */
  createdAt?: string;
  /** Unfilled part of `giveAmount`; absent on engines without partial fills. */
  remaining?: number;
}

export interface Match {
  orderAId: number;
  /** null when the order was routed to external liquidity instead of matched. */
  orderBId: number | null;
  /** "soroswap" for an externally routed fill; absent for a pool match. */
  venue?: string;
  txHash: string | null;
  at: string;
  /** Absent until the matching-engine is redeployed with this field --
   * older running instances only ever recorded order ids and the tx hash. */
  partyA?: string;
  partyB?: string | null;
  giveTokenA?: string;
  giveAmountA?: number;
  giveTokenB?: string;
  giveAmountB?: number | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MATCHING_ENGINE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`matching-engine ${path} -> ${res.status}`);
  return res.json();
}

export function engineHealth() {
  return api<{ ok: boolean }>("/health");
}

export function submitOrder(order: {
  party: string;
  giveToken: string;
  giveAmount: number;
  wantToken: string;
  wantAmount: number;
  ts: number;
  signature: string;
}) {
  return api<{ ok: boolean; order: Order; settled: Match | null; fills?: Match[] }>("/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function listOrders() {
  return api<{ orders: Order[] }>("/orders");
}

export function listMatches() {
  return api<{ matches: Match[] }>("/matches");
}
