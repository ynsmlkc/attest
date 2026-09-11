import { useEffect, useState } from "react";
import { listMatches, type Match } from "../lib/matchingEngine";

export function ActivityFeed({ latestExternal }: { latestExternal?: Match | null }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [engineOnline, setEngineOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const { matches } = await listMatches();
        if (!cancelled) {
          setMatches(matches.slice().reverse());
          setEngineOnline(true);
        }
      } catch {
        if (!cancelled) setEngineOnline(false);
      }
    }
    tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [latestExternal]);

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Settled Trades</h2>
        <span
          className={`flex items-center gap-1.5 text-xs ${engineOnline ? "text-text-dim" : "text-danger"}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${engineOnline ? "bg-success" : "bg-danger"}`}
          />
          {engineOnline ? "engine online" : "engine offline"}
        </span>
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-text-faint">No trades settled yet.</p>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li
              key={`${m.orderAId}-${m.orderBId}-${m.at}`}
              className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm"
            >
              <div>
                <span className="text-text-dim">
                  Order #{m.orderAId} ↔ #{m.orderBId}
                </span>
                <div className="text-xs text-text-faint">
                  {new Date(m.at).toLocaleTimeString()}
                </div>
              </div>
              {m.txHash ? (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${m.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono-nums text-xs text-brand hover:underline"
                >
                  {m.txHash.slice(0, 8)}…
                </a>
              ) : (
                <span className="text-xs text-text-faint">pending</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
