import { useEffect, useState } from "react";
import { listMatches, type Match } from "../../lib/matchingEngine";

export function ActivityTable({ onEngineStatus }: { onEngineStatus?: (online: boolean) => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const { matches } = await listMatches();
        if (!cancelled) {
          setMatches(matches.slice().reverse());
          setOnline(true);
          onEngineStatus?.(true);
        }
      } catch {
        if (!cancelled) {
          setOnline(false);
          onEngineStatus?.(false);
        }
      }
    }
    tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-[184px] flex-none flex-col border-t border-border bg-surface">
      <div className="flex h-9 flex-none items-center gap-4.5 border-b border-border px-5">
        <div className="mono text-[9.5px] tracking-[0.16em] text-text uppercase shadow-[inset_0_-1px_0_var(--color-amber)] pb-0.5">
          Settled activity
        </div>
        <div className="flex-1" />
        <div
          className="mono flex items-center gap-1.5 text-[9px] tracking-[0.12em] uppercase"
          style={{ color: online ? "var(--color-up)" : "var(--color-down)" }}
        >
          <div className={`h-[5px] w-[5px] ${online ? "pulse bg-up" : "bg-down"}`} />
          Matching engine {online ? "online" : "offline"}
        </div>
      </div>
      <div className="mono flex h-6 flex-none items-center border-b border-border-2 px-5 text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
        <div className="w-[110px]">Order pair</div>
        <div className="flex-1">Settled</div>
        <div className="w-[240px]">Ledger tx</div>
        <div className="w-[90px] text-right">Enclave</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="mono px-5 py-3 text-[11px] text-text-faint">
            No trades settled yet — submit two opposite orders to see one here.
          </div>
        ) : (
          matches.map((m) => (
            <div
              key={`${m.orderAId}-${m.orderBId}-${m.at}`}
              className="mono flex h-[30px] items-center border-b border-border-2 px-5 text-[11px] hover:bg-surface-3"
            >
              <div className="w-[110px] tracking-[0.04em] text-text">
                #{m.orderAId} ↔ #{m.orderBId}
              </div>
              <div className="flex-1 text-text-faint">{new Date(m.at).toLocaleTimeString()}</div>
              <div className="w-[240px]">
                {m.txHash ? (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${m.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {m.txHash}
                  </a>
                ) : (
                  <span className="text-text-faint">pending</span>
                )}
              </div>
              <div className="w-[90px] text-right text-up">Attested</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
