import { MATCHING_ENGINE_URL } from "./config";

export interface Order {
  id: number;
  party: string;
  giveToken: string;
  giveAmount: number;
  wantToken: string;
  wantAmount: number;
}

export interface Match {
  orderAId: number;
  orderBId: number;
  txHash: string | null;
  at: string;
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
}) {
  return api<{ ok: boolean; order: Order; settled: Match | null }>("/orders", {
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
