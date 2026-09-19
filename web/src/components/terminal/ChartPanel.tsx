import { useMemo, useState } from "react";
import type { TokenInfo } from "../../lib/config";
import type { MarketData } from "../../lib/useMarketData";
import { bucketIntoCandles } from "../../lib/priceHistory";

const TIMEFRAMES = ["24H", "1W", "1M", "3M", "6M"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const UP = "#4FB286";
const DOWN = "#D2684F";

function fmtPrice(v: number, dp = 4) {
  return v.toFixed(dp);
}

export function ChartPanel({ token, data }: { token: TokenInfo; data: MarketData }) {
  const [tf, setTf] = useState<Timeframe>("24H");

  const candles = useMemo(() => bucketIntoCandles(data.history, 3600), [data.history]);

  const geometry = useMemo(() => {
    if (candles.length === 0) return null;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const mn = Math.min(...lows);
    const mx = Math.max(...highs);
    const pad = (mx - mn) * 0.12 || mx * 0.01 || 0.001;
    const lo = mn - pad;
    const hi = mx + pad;
    const span = hi - lo || 1;
    const TOP = 8;
    const H = 300;
    const PW = 664;
    const n = candles.length;
    const step = PW / n;
    const w = Math.max(3, step * 0.58);
    const y = (v: number) => TOP + (1 - (v - lo) / span) * H;

    const bars = candles.map((c, i) => {
      const x = i * step + (step - w) / 2;
      const up = c.close >= c.open;
      const yo = y(c.open);
      const yc = y(c.close);
      return {
        x: +x.toFixed(1),
        w: +w.toFixed(1),
        color: up ? UP : DOWN,
        y: +Math.min(yo, yc).toFixed(1),
        h: +Math.max(1.2, Math.abs(yc - yo)).toFixed(1),
        wx: +(x + w / 2).toFixed(1),
        wy: +y(c.high).toFixed(1),
        wh: +(y(c.low) - y(c.high)).toFixed(1),
      };
    });

    const grid = [0, 1, 2, 3, 4].map((i) => {
      const yy = TOP + (H / 4) * i;
      return { y: +yy.toFixed(1), label: fmtPrice(hi - (span / 4) * i, token.decimals >= 4 ? 4 : 2) };
    });

    return { bars, grid, hi: mx, lo: mn };
  }, [candles, token.decimals]);

  const dataPointCount = data.history.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-none items-start justify-between border-b border-border px-[22px] pt-[18px] pb-3.5">
        <div className="flex items-center gap-5">
          <div>
            <div className="flex items-baseline gap-2">
              <div className="text-[22px] font-semibold tracking-[0.01em]">{token.code}</div>
              <div className="text-[22px] font-normal text-text-ghost">/</div>
              <div className="text-[22px] font-medium text-text-dim">USDC</div>
            </div>
            <div className="mono mt-1 text-[9.5px] tracking-[0.14em] text-text-faint uppercase">
              {token.name} · dark pool
            </div>
          </div>
          <div className="h-11 w-px bg-border" />
          <div>
            <div className="mono text-[32px] leading-none font-medium tracking-[-0.01em]">
              {data.price != null ? `$${fmtPrice(data.price, token.decimals >= 4 ? 4 : 2)}` : "—"}
            </div>
            <div className="mono mt-1.5 flex items-center gap-2.5 text-[11px]">
              {data.change24hPct != null && (
                <span style={{ color: data.change24hPct >= 0 ? UP : DOWN }}>
                  {data.change24hPct >= 0 ? "+" : ""}
                  {data.change24hPct.toFixed(2)}%
                </span>
              )}
              <span className="tracking-[0.1em] text-text-faint uppercase">
                {dataPointCount} real samples
              </span>
            </div>
          </div>
        </div>
        <div className="flex border border-border">
          {TIMEFRAMES.map((id) => (
            <button
              key={id}
              onClick={() => setTf(id)}
              className="mono border-r border-border px-3.5 py-[7px] text-[10px] tracking-[0.12em] text-text-dim last:border-r-0 hover:text-text"
              style={{
                color: id === tf ? "#0A0B0D" : undefined,
                background: id === tf ? "var(--color-amber)" : "transparent",
              }}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-[22px] pt-2.5">
        {tf !== "24H" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="mono max-w-sm text-center text-[11px] leading-relaxed text-text-faint">
              No real historical data beyond ~22h — Reflector's oracle retains
              a 24-hour window. Shown honestly rather than invented: switch
              back to 24H for the real chart.
            </div>
          </div>
        ) : !geometry ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="mono text-[11px] text-text-faint">Loading real price history…</div>
          </div>
        ) : (
          <svg width="728" height="330" viewBox="0 0 728 330" className="block">
            {geometry.grid.map((g, i) => (
              <g key={i}>
                <line x1="0" y1={g.y} x2="664" y2={g.y} stroke="#16191E" strokeWidth="1" />
                <text x="674" y={g.y + 3} fill="#80868E" fontFamily="IBM Plex Mono, monospace" fontSize="9">
                  {g.label}
                </text>
              </g>
            ))}
            {geometry.bars.map((c, i) => (
              <g key={i}>
                <rect x={c.wx} y={c.wy} width="1" height={c.wh} fill={c.color} opacity="0.8" />
                <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={c.color} />
              </g>
            ))}
          </svg>
        )}
      </div>

      <div className="flex flex-none border-t border-border bg-surface">
        {[
          { k: "24h high", v: geometry ? `$${fmtPrice(geometry.hi, 4)}` : "—" },
          { k: "24h low", v: geometry ? `$${fmtPrice(geometry.lo, 4)}` : "—" },
          { k: "real candles", v: `${candles.length}` },
          { k: "oracle", v: "Reflector, live" },
        ].map((s) => (
          <div key={s.k} className="flex-1 border-r border-border-2 px-4 py-3 last:border-r-0">
            <div className="mono text-[8.5px] tracking-[0.16em] text-text-faint uppercase">{s.k}</div>
            <div className="mono mt-[5px] text-[13px] text-text">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
