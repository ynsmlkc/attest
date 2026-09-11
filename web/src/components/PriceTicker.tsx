import { useEffect, useState } from "react";
import { getReflectorPrice } from "../lib/contracts";
import { TRADABLE_TOKENS } from "../lib/config";

interface PriceState {
  price: number | null;
  prevPrice: number | null;
  loading: boolean;
}

export function PriceTicker() {
  const [prices, setPrices] = useState<Record<string, PriceState>>(
    Object.fromEntries(
      TRADABLE_TOKENS.map((t) => [t.code, { price: null, prevPrice: null, loading: true }]),
    ),
  );

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      for (const token of TRADABLE_TOKENS) {
        const price = await getReflectorPrice(token.reflectorSymbol).catch(() => null);
        if (cancelled) return;
        setPrices((prev) => ({
          ...prev,
          [token.code]: {
            price,
            prevPrice: prev[token.code]?.price ?? null,
            loading: false,
          },
        }));
      }
    }

    tick();
    const id = setInterval(tick, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-6 border-y border-border bg-surface/60 px-6 py-3 backdrop-blur md:px-10">
      <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-faint uppercase">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-success" />
        Reflector Live Feed
      </span>
      {TRADABLE_TOKENS.map((token) => {
        const state = prices[token.code];
        const up =
          state?.price != null && state?.prevPrice != null && state.price >= state.prevPrice;
        return (
          <div key={token.code} className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-text-dim">{token.code}</span>
            {state?.loading && state.price == null ? (
              <span className="mono-nums text-sm text-text-faint">···</span>
            ) : state?.price != null ? (
              <span
                className={`mono-nums text-sm font-semibold ${up ? "text-success" : "text-danger"}`}
              >
                ${state.price.toFixed(4)}
              </span>
            ) : (
              <span className="mono-nums text-sm text-text-faint">no feed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
