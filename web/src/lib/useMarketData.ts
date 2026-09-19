import { useEffect, useState } from "react";
import { getRealPriceHistory24h, type PricePoint } from "./priceHistory";
import { TRADABLE_TOKENS } from "./config";

export interface MarketData {
  history: PricePoint[]; // real points, oldest first, up to ~22h
  price: number | null; // most recent real sample
  change24hPct: number | null; // derived from real oldest vs newest in `history`
  loading: boolean;
}

const REFRESH_MS = 5 * 60_000; // matches Reflector's own 300s resolution

export function useMarketData(): Record<string, MarketData> {
  const [data, setData] = useState<Record<string, MarketData>>(
    Object.fromEntries(
      TRADABLE_TOKENS.map((t) => [
        t.code,
        { history: [], price: null, change24hPct: null, loading: true },
      ]),
    ),
  );

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      for (const token of TRADABLE_TOKENS) {
        const history = await getRealPriceHistory24h(token.reflectorSymbol).catch(() => []);
        if (cancelled) return;
        const price = history.length ? history[history.length - 1].price : null;
        const change24hPct =
          history.length >= 2
            ? ((history[history.length - 1].price - history[0].price) / history[0].price) * 100
            : null;
        setData((prev) => ({
          ...prev,
          [token.code]: { history, price, change24hPct, loading: false },
        }));
      }
    }

    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return data;
}
