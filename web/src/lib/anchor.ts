import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { signTransaction } from "./wallet";

// Same real, live SEP-6 sandbox anchor used by scripts/sep6_onramp_demo.py
// and scripts/sep6_offramp_demo.py -- this is a browser port of that same
// flow, not a different/mocked implementation. See repo root README's
// "Anchor integration" section for how this anchor was found and verified.
export const ANCHOR_URL = "https://tr-mock-anchor.fly.dev";
export const ANCHOR_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

export interface Sep6Transaction {
  id: string;
  kind: "deposit" | "withdrawal";
  status: string;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  from?: string;
  to?: string;
  external_transaction_id?: string;
  stellar_transaction_id?: string;
  started_at: string;
  completed_at?: string | null;
}

export async function sep10Auth(publicKey: string): Promise<string> {
  const challenge = await fetch(`${ANCHOR_URL}/auth?account=${publicKey}`).then((r) => r.json());
  const { signedTxXdr } = await signTransaction(challenge.transaction, {
    networkPassphrase: challenge.network_passphrase,
    address: publicKey,
  });
  const resp = await fetch(`${ANCHOR_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedTxXdr }),
  }).then((r) => r.json());
  if (!resp.token) throw new Error("SEP-10 auth failed");
  return resp.token;
}

export interface DepositInstructions {
  id: string;
  how: string;
  instructions: Record<string, { value: string; description: string }>;
  min_amount: number;
  max_amount: number;
  fee_percent: number;
  extra_info?: { message?: string };
}

export async function sep6Deposit(
  token: string,
  publicKey: string,
  amountTry: string,
): Promise<DepositInstructions> {
  const url = new URL(`${ANCHOR_URL}/sep6/deposit`);
  url.searchParams.set("asset_code", "USDC");
  url.searchParams.set("account", publicKey);
  url.searchParams.set("type", "bank_account");
  url.searchParams.set("amount", amountTry);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`SEP-6 deposit request failed (${resp.status})`);
  return resp.json();
}

export interface WithdrawInstructions {
  id: string;
  account_id: string;
  memo_type: "id" | "text" | "hash";
  memo: string;
  min_amount: number;
  max_amount: number;
  fee_percent: number;
  extra_info?: { message?: string };
}

export async function sep6Withdraw(token: string, amountUsdc: string): Promise<WithdrawInstructions> {
  const url = new URL(`${ANCHOR_URL}/sep6/withdraw`);
  url.searchParams.set("asset_code", "USDC");
  url.searchParams.set("type", "bank_account");
  url.searchParams.set("amount", amountUsdc);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`SEP-6 withdraw request failed (${resp.status})`);
  return resp.json();
}

export interface Sep6AssetLimits {
  /** SEP-6 /info makes min/max optional, and this anchor no longer sends them. */
  min_amount?: number;
  max_amount?: number;
  fee_percent: number;
}

/** "10–5000 TRY", or a single bound, or null when the anchor publishes neither. */
export function formatLimitRange(l: Sep6AssetLimits, unit: string): string | null {
  const { min_amount: min, max_amount: max } = l;
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}–${max} ${unit}`;
  return min != null ? `min ${min} ${unit}` : `max ${max} ${unit}`;
}

/** Unauthenticated -- real per-transaction min/max and fee for USDC, used
 * for the Anchor screen's limits panel instead of a fabricated 24h-usage
 * progress bar (which this anchor doesn't track or expose). */
export async function getSep6Limits(): Promise<{ deposit: Sep6AssetLimits; withdraw: Sep6AssetLimits }> {
  const resp = await fetch(`${ANCHOR_URL}/sep6/info`);
  const info = await resp.json();
  return { deposit: info.deposit.USDC, withdraw: info.withdraw.USDC };
}

/** Unauthenticated real SEP-38 indicative quote -- replaces any hardcoded
 * TRY/USDC rate. `sellAsset`/`buyAsset` follow SEP-38's asset identifier
 * format (`iso4217:TRY`, `stellar:USDC:<issuer>`). */
export async function getQuote(
  direction: "deposit" | "withdraw",
  amount: string,
): Promise<{ price: string; sellAmount: string; buyAmount: string; feeTry: string }> {
  const stellarUsdc = `stellar:USDC:${ANCHOR_USDC_ISSUER}`;
  const url = new URL(`${ANCHOR_URL}/sep38/price`);
  if (direction === "deposit") {
    url.searchParams.set("sell_asset", "iso4217:TRY");
    url.searchParams.set("buy_asset", stellarUsdc);
    url.searchParams.set("sell_amount", amount);
  } else {
    url.searchParams.set("sell_asset", stellarUsdc);
    url.searchParams.set("buy_asset", "iso4217:TRY");
    url.searchParams.set("sell_amount", amount);
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`SEP-38 quote failed (${resp.status})`);
  const data = await resp.json();
  if (direction === "withdraw" && Number(data.price) === 0) {
    throw new Error("anchor returned an invalid (zero) quote price");
  }
  // `price` is always sell-per-buy; re-express as TRY/USDC either way so the
  // UI can show one consistent unit regardless of transfer direction.
  const tryPerUsdc = direction === "deposit" ? data.price : (1 / Number(data.price)).toString();
  return {
    price: tryPerUsdc,
    sellAmount: data.sell_amount,
    buyAmount: data.buy_amount,
    feeTry: data.fee?.asset === "iso4217:TRY" ? data.fee.total : "0",
  };
}

/** The one non-SEP call in the flow -- the anchor's own SEP-6-scoped
 * sandbox trigger standing in for a real bank wire, same as the Python
 * scripts. Not the anchor's separate /v1 business API. */
export async function simulateBankTransfer(token: string, txId: string) {
  const resp = await fetch(`${ANCHOR_URL}/sep6/tx/${txId}/simulate-bank-transfer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Simulate bank transfer failed (${resp.status})`);
  return resp.json();
}

export async function getSep6Transaction(token: string, txId: string): Promise<Sep6Transaction> {
  const resp = await fetch(`${ANCHOR_URL}/sep6/transaction?id=${txId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  return data.transaction;
}

export async function listSep6Transactions(token: string): Promise<Sep6Transaction[]> {
  const resp = await fetch(`${ANCHOR_URL}/sep6/transactions?asset_code=USDC`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.transactions ?? [];
}

/** Builds, signs (via Freighter), and submits a real classic-asset USDC
 * payment with the exact memo the anchor's SEP-6 /withdraw response
 * requires -- ported from scripts/sep6_offramp_demo.py's stellar_sdk use,
 * since `stellar tx new payment` has no memo flag at all (see that
 * script's docstring / repo README). */
export async function sendWithdrawPayment(
  sourcePublicKey: string,
  destination: string,
  memoType: "id" | "text" | "hash",
  memoValue: string,
  amountUsdc: string,
): Promise<string> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(sourcePublicKey);
  const asset = new Asset("USDC", ANCHOR_USDC_ISSUER);
  const memo = memoType === "id" ? Memo.id(memoValue) : memoType === "text" ? Memo.text(memoValue) : Memo.hash(memoValue);

  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addMemo(memo)
    .addOperation(Operation.payment({ destination, asset, amount: amountUsdc }))
    // The clock starts when this is built, not when Freighter's popup opens:
    // 60s was too short for a human to read and approve (tx_too_late).
    .setTimeout(300)
    .build();

  const { signedTxXdr } = await signTransaction(tx.toXDR(), {
    networkPassphrase: Networks.TESTNET,
    address: sourcePublicKey,
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  try {
    const result = await horizon.submitTransaction(signedTx);
    return result.hash;
  } catch (e) {
    throw new Error(describeHorizonError(e));
  }
}

/** Horizon's submitTransaction throws a generic "...400 Bad Request"-style
 * Error whose message hides the actual on-chain reason -- the real result
 * codes live in the underlying HTTP error response. Surfaces those instead,
 * with a plain-language hint for the two failure modes this screen's
 * real-wallet-balance requirement (not the SettlementVault balance) most
 * often produces. */
function describeHorizonError(e: unknown): string {
  const data = (e as { response?: { data?: { extras?: { result_codes?: Record<string, unknown> }; detail?: string } } })
    ?.response?.data;
  const codes = data?.extras?.result_codes;
  const opCodes = Array.isArray(codes?.operations) ? (codes.operations as string[]).join(", ") : undefined;
  const code = opCodes || (codes?.transaction as string | undefined) || data?.detail;
  if (!code) return e instanceof Error ? e.message : "On-chain payment failed";
  if (code.includes("underfunded")) {
    return `Payment rejected (${code}) -- your wallet doesn't hold enough real USDC. This checks your actual Stellar balance, not the vault's trading balance; withdraw from the vault first if that's where it is.`;
  }
  if (code.includes("no_trust")) {
    return `Payment rejected (${code}) -- this account has no USDC trustline yet.`;
  }
  if (code.includes("too_late")) {
    return `Payment rejected (${code}) -- the approval took too long and the transaction expired before it was submitted. Nothing was sent; just try again and approve in Freighter a bit faster.`;
  }
  if (code.includes("bad_seq")) {
    return `Payment rejected (${code}) -- stale transaction sequence, just try again.`;
  }
  return `Payment rejected: ${code}`;
}
