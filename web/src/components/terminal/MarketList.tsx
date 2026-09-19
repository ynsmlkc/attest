import { TRADABLE_TOKENS, type TokenInfo } from "../../lib/config";
import type { MarketData } from "../../lib/useMarketData";
import { sparklinePoints } from "../../lib/sparkline";
import { TokenIcon } from "./TokenIcon";

interface Props {
  market: Record<string, MarketData>;
  active: TokenInfo;
  onSelect: (t: TokenInfo) => void;
}

function fmtPrice(v: number) {
  return v.toFixed(v < 1 ? 4 : 2);
}

export function MarketList({ market, active, onSelect }: Props) {
  return (
    <div className="flex w-[300px] flex-none flex-col border-r border-border bg-surface">
      <div className="flex h-[38px] flex-none items-center justify-between border-b border-border px-3.5">
        <div className="mono text-[9.5px] tracking-[0.16em] text-text uppercase">Markets</div>
        <div className="mono text-[9.5px] tracking-[0.1em] text-text-faint">
          {TRADABLE_TOKENS.length} pairs · real
        </div>
      </div>
      <div className="mono flex h-[22px] flex-none items-center border-b border-border-2 px-3.5 text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
        <div className="flex-1">Asset</div>
        <div className="w-[70px] text-right">Price · 24h</div>
        <div className="w-[58px] text-right">Live</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {TRADABLE_TOKENS.map((t) => {
          const m = market[t.code];
          const isActive = t.code === active.code;
          const up = (m?.change24hPct ?? 0) >= 0;
          const prices = (m?.history ?? []).map((p) => p.price);
          return (
            <div
              key={t.code}
              onClick={() => onSelect(t)}
              className={`flex h-[62px] cursor-pointer items-center gap-2 border-b border-border-2 py-0 pr-3.5 pl-3 hover:bg-surface-3 ${
                isActive ? "bg-surface-3 shadow-[inset_2px_0_0_var(--color-amber)]" : ""
              }`}
            >
              <TokenIcon token={t} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold tracking-[0.02em]">{t.code}</div>
                <div className="mono truncate text-[8.5px] tracking-[0.04em] text-text-faint uppercase">
                  {t.name}
                </div>
              </div>
              <div className="w-[70px] text-right">
                {m?.loading ? (
                  <div className="mono text-[12.5px] text-text-faint">···</div>
                ) : m?.price != null ? (
                  <>
                    <div className="mono text-[12.5px] text-text">${fmtPrice(m.price)}</div>
                    <div
                      className="mono mt-[3px] text-[10.5px]"
                      style={{ color: up ? "var(--color-up)" : "var(--color-down)" }}
                    >
                      {m.change24hPct != null
                        ? `${up ? "+" : ""}${m.change24hPct.toFixed(2)}%`
                        : "—"}
                    </div>
                  </>
                ) : (
                  <div className="mono text-[10px] text-text-faint">no feed</div>
                )}
              </div>
              <div className="flex w-[58px] justify-end">
                {prices.length >= 2 && (
                  <svg width="56" height="22" viewBox="0 0 72 22" preserveAspectRatio="none">
                    <polyline
                      points={sparklinePoints(prices)}
                      fill="none"
                      stroke={up ? "var(--color-up)" : "var(--color-down)"}
                      strokeWidth="1.25"
                    />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mono flex h-11 flex-none items-center justify-between border-t border-border px-3.5 text-[9.5px] tracking-[0.1em] text-text-faint uppercase">
        <div>Real testnet assets only</div>
      </div>
    </div>
  );
}
