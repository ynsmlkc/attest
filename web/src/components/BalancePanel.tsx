import { useEffect, useState } from "react";
import { deposit, getVaultBalance, withdraw } from "../lib/contracts";
import { TRADABLE_TOKENS, type TokenInfo } from "../lib/config";

interface Props {
  address: string | null;
}

function toStroops(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const digits = `${whole || "0"}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return BigInt(digits || "0");
}

function fromStroops(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function BalancePanel({ address }: Props) {
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(token: TokenInfo) {
    if (!address) return;
    const bal = await getVaultBalance(token, address).catch(() => 0n);
    setBalances((prev) => ({ ...prev, [token.code]: bal }));
  }

  useEffect(() => {
    if (!address) return;
    TRADABLE_TOKENS.forEach(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function handle(action: "deposit" | "withdraw", token: TokenInfo) {
    if (!address) return;
    const raw = amounts[token.code];
    if (!raw || Number(raw) <= 0) return;
    setBusy(`${action}-${token.code}`);
    setError(null);
    try {
      const stroops = toStroops(raw, token.decimals);
      if (action === "deposit") await deposit(token, address, stroops);
      else await withdraw(token, address, stroops);
      setAmounts((prev) => ({ ...prev, [token.code]: "" }));
      await refresh(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  if (!address) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-2 text-sm font-semibold text-text">Vault Balances</h2>
        <p className="text-sm text-text-faint">Connect your wallet to view balances.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-text">Vault Balances</h2>
      <div className="space-y-4">
        {TRADABLE_TOKENS.map((token) => (
          <div key={token.code} className="rounded-lg border border-border bg-surface-2 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="font-medium text-text">{token.code}</span>
              <span className="mono-nums text-sm text-text-dim">
                {fromStroops(balances[token.code] ?? 0n, token.decimals)}{" "}
                <span className="text-text-faint">in vault</span>
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                placeholder="0.00"
                value={amounts[token.code] ?? ""}
                onChange={(e) =>
                  setAmounts((prev) => ({ ...prev, [token.code]: e.target.value }))
                }
                className="mono-nums w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <button
                onClick={() => handle("deposit", token)}
                disabled={busy !== null}
                className="whitespace-nowrap rounded-md bg-brand px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-dim disabled:opacity-50"
              >
                {busy === `deposit-${token.code}` ? "…" : "Deposit"}
              </button>
              <button
                onClick={() => handle("withdraw", token)}
                disabled={busy !== null}
                className="whitespace-nowrap rounded-md border border-border px-3 py-2 text-xs font-medium text-text-dim transition hover:border-border-hover hover:text-text disabled:opacity-50"
              >
                {busy === `withdraw-${token.code}` ? "…" : "Withdraw"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}

export { toStroops, fromStroops };
