import { useEffect, useState } from "react";
import { deposit, getVaultBalance, withdraw } from "../../lib/contracts";
import { fromStroops, toStroops } from "../../lib/amounts";
import { TRADABLE_TOKENS, type TokenInfo } from "../../lib/config";
import { TokenIcon } from "./TokenIcon";

export function BalancesCard({ address }: { address: string | null }) {
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

  const totalKnown = TRADABLE_TOKENS.every((t) => balances[t.code] !== undefined);

  return (
    <div className="border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-[13px] py-[11px]">
        <div className="mono text-[9.5px] tracking-[0.16em] uppercase">Balances</div>
        <div className="mono text-[9.5px] text-text-faint">
          {address ? (totalKnown ? "vault balances" : "loading…") : "not connected"}
        </div>
      </div>
      {!address ? (
        <div className="p-[13px] text-[11.5px] text-text-faint">
          Connect your wallet to deposit, withdraw, or view balances.
        </div>
      ) : (
        <>
          {TRADABLE_TOKENS.map((token) => (
            <div key={token.code} className="border-b border-border-2 p-[13px]">
              <div className="mb-2 flex items-center gap-2">
                <TokenIcon token={token} size={20} />
                <div className="w-[52px] text-[12px] font-semibold">{token.code}</div>
                <div className="mono flex-1 text-[11.5px] text-text">
                  {fromStroops(balances[token.code] ?? 0n, token.decimals)}
                </div>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={amounts[token.code] ?? ""}
                  onChange={(e) =>
                    setAmounts((prev) => ({ ...prev, [token.code]: e.target.value }))
                  }
                  className="mono w-full border border-border bg-panel px-2 py-1.5 text-[11px] outline-none focus:border-amber"
                />
                <button
                  onClick={() => handle("deposit", token)}
                  disabled={busy !== null}
                  className="mono border border-border-hover px-2 py-1.5 text-[9px] tracking-[0.1em] text-text-dim uppercase hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  {busy === `deposit-${token.code}` ? "…" : "Dep"}
                </button>
                <button
                  onClick={() => handle("withdraw", token)}
                  disabled={busy !== null}
                  className="mono border border-border-hover px-2 py-1.5 text-[9px] tracking-[0.1em] text-text-dim uppercase hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  {busy === `withdraw-${token.code}` ? "…" : "Wdr"}
                </button>
              </div>
            </div>
          ))}
          {error && <p className="mono px-[13px] py-2 text-[10px] text-down">{error}</p>}
        </>
      )}
    </div>
  );
}
