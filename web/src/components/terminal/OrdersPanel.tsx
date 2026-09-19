import { useEffect, useState } from "react";
import { listMatches, listOrders, type Match, type Order } from "../../lib/matchingEngine";
import { tokenBySac, type TokenInfo } from "../../lib/config";
import { fromStroops } from "../../lib/amounts";
import { TokenIcon } from "./TokenIcon";

type Tab = "open" | "history";

function short(addr: string, lead = 4, tail = 4) {
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

function pairView(giveSac: string, wantSac: string) {
  const give = tokenBySac(giveSac);
  const want = tokenBySac(wantSac);
  return { give, want, label: `${give?.code ?? "?"} / ${want?.code ?? "?"}` };
}

export function OrdersPanel({ address, onEngineStatus }: { address: string | null; onEngineStatus?: (online: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("open");
  const [orders, setOrders] = useState<Order[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [o, m] = await Promise.all([listOrders(), listMatches()]);
        if (cancelled) return;
        setOrders(o.orders);
        setMatches(m.matches);
        setOnline(true);
        onEngineStatus?.(true);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setOnline(false);
        onEngineStatus?.(false);
        setError(e instanceof Error ? e.message : "Failed to reach the matching engine");
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

  const myOrders = address ? orders.filter((o) => o.party === address) : [];
  const partyAware = matches.some((m) => m.partyA !== undefined);
  const myMatches = partyAware && address ? matches.filter((m) => m.partyA === address || m.partyB === address) : matches;
  const historyRows = (partyAware ? myMatches : matches).slice().reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="font-display text-[22px] font-normal tracking-[-0.01em]">Your orders</h1>
            <div className="mono mt-1.5 text-[10px] tracking-[0.12em] text-text-faint uppercase">
              {address ? `Wallet ${short(address)} · testnet` : "Connect wallet to see your orders"}
            </div>
          </div>
          <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.12em] text-text-dim uppercase">
            <div className={`h-1.5 w-1.5 ${online ? "pulse bg-up" : "bg-down"}`} />
            {online ? "Engine online" : "Engine offline"}
          </div>
        </div>

        <div className="flex border-b border-border">
          {(["open", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`mono px-4 py-2.5 text-[10px] tracking-[0.18em] uppercase ${
                tab === t ? "text-text shadow-[inset_0_-1px_0_var(--color-amber)]" : "text-text-dim hover:text-text"
              }`}
            >
              {t === "open" ? "Open" : "History"} <span className="text-text-faint">{t === "open" ? myOrders.length : historyRows.length}</span>
            </button>
          ))}
        </div>

        <div className="mono flex items-center gap-2 border-b border-border-2 px-0.5 py-2.5 text-[10px] text-text-faint">
          <div className="h-[11px] w-[3px] bg-border-2" />
          Only your own orders are shown — the rest of the book stays sealed until matched.
        </div>

        {error && <p className="mono mt-2.5 bg-down/10 px-2.5 py-2 text-[10.5px] text-down">{error}</p>}

        {tab === "open" &&
          (myOrders.length === 0 ? (
            <EmptyState address={address} />
          ) : (
            <Table
              head={[
                { label: "Pair", className: "w-[230px] pl-1" },
                { label: "You give", className: "flex-1" },
                { label: "You want", className: "flex-1" },
                { label: "Limit", className: "flex-1" },
                { label: "Placed", className: "flex-1" },
                { label: "Status", className: "flex-1" },
                { label: "Action", className: "w-[110px] text-right" },
              ]}
              rows={myOrders.map((o) => {
                const { give, want, label } = pairView(o.giveToken, o.wantToken);
                const limit = give && want ? (o.wantAmount / o.giveAmount).toFixed(4) : "—";
                return (
                  <Row key={o.id}>
                    <PairCell label={label} give={give} want={want} sub={`ord ${o.id}`} />
                    <Cell mono>{give ? `${fromStroops(BigInt(o.giveAmount), give.decimals)} ${give.code}` : "—"}</Cell>
                    <Cell mono>{want ? `${fromStroops(BigInt(o.wantAmount), want.decimals)} ${want.code}` : "—"}</Cell>
                    <Cell mono dim>{limit}</Cell>
                    <Cell mono faint>{o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : "—"}</Cell>
                    <div className="flex-1">
                      <div className="mono inline-flex items-center gap-1.5 border border-[#4A3A20] bg-[#16120A] px-2 py-1 text-[9.5px] tracking-[0.08em] text-amber">
                        <div className="h-[5px] w-[5px] pulse bg-amber" />
                        Sealed — awaiting match
                      </div>
                    </div>
                    <div className="w-[110px] text-right">
                      <span
                        title="Cancellation isn't implemented by the matching-engine yet"
                        className="mono inline-block cursor-not-allowed border border-border px-2.5 py-1 text-[9.5px] tracking-[0.1em] text-text-faint uppercase"
                      >
                        Cancel
                      </span>
                    </div>
                  </Row>
                );
              })}
            />
          ))}

        {tab === "history" &&
          (historyRows.length === 0 ? (
            <div className="mono px-1 py-10 text-center text-[11.5px] text-text-faint">No settled orders yet.</div>
          ) : (
            <>
              {!partyAware && (
                <p className="mono mt-2.5 bg-surface-3 px-2.5 py-2 text-[10.5px] text-text-dim">
                  This matching-engine build doesn't record which wallet was on each side of a match yet — showing
                  all settled trades network-wide, not just yours.
                </p>
              )}
              <Table
                head={
                  partyAware
                    ? [
                        { label: "Pair", className: "w-[230px] pl-1" },
                        { label: "Gave", className: "flex-1" },
                        { label: "Received", className: "flex-1" },
                        { label: "Settled", className: "flex-1" },
                        { label: "Ledger tx", className: "flex-1" },
                        { label: "Enclave", className: "w-[110px] text-right" },
                      ]
                    : [
                        { label: "Order pair", className: "w-[230px] pl-1" },
                        { label: "Settled", className: "flex-1" },
                        { label: "Ledger tx", className: "flex-1" },
                        { label: "Enclave", className: "w-[110px] text-right" },
                      ]
                }
                rows={historyRows.map((m) => {
                  const mine = m.partyA === address;
                  const giveSac = mine ? m.giveTokenA : m.giveTokenB;
                  const wantSac = mine ? m.giveTokenB : m.giveTokenA;
                  const giveAmt = mine ? m.giveAmountA : m.giveAmountB;
                  const wantAmt = mine ? m.giveAmountB : m.giveAmountA;
                  const gave = giveSac ? tokenBySac(giveSac) : undefined;
                  const got = wantSac ? tokenBySac(wantSac) : undefined;
                  return (
                    <Row key={`${m.orderAId}-${m.orderBId}-${m.at}`}>
                      {partyAware ? (
                        <>
                          <PairCell label={gave && got ? `${gave.code} / ${got.code}` : "—"} give={gave} want={got} sub={`#${m.orderAId} ↔ ${m.venue === "soroswap" ? "Soroswap" : `#${m.orderBId}`}`} />
                          <Cell mono dim>{gave && giveAmt != null ? `${fromStroops(BigInt(giveAmt), gave.decimals)} ${gave.code}` : "—"}</Cell>
                          <Cell mono>{got && wantAmt != null ? `${fromStroops(BigInt(wantAmt), got.decimals)} ${got.code}` : "—"}</Cell>
                        </>
                      ) : (
                        <div className="mono w-[230px] pl-1 text-[12.5px] text-text">
                          #{m.orderAId} ↔ {m.venue === "soroswap" ? "Soroswap" : `#${m.orderBId}`}
                        </div>
                      )}
                      <Cell mono faint>{new Date(m.at).toLocaleTimeString()}</Cell>
                      <div className="flex-1 font-mono text-[11.5px]">
                        {m.txHash ? (
                          <a href={`https://stellar.expert/explorer/testnet/tx/${m.txHash}`} target="_blank" rel="noreferrer">
                            {short(m.txHash, 6, 6)}
                          </a>
                        ) : (
                          <span className="text-text-faint">pending</span>
                        )}
                      </div>
                      <div className="w-[110px] text-right">
                        <div className="mono inline-flex items-center gap-1.5 border border-[#2C4A3C] bg-[#10201A] px-2 py-1 text-[9.5px] tracking-[0.08em] text-up">
                          <div className="h-[5px] w-[5px] bg-up" />
                          {m.venue === "soroswap" ? "Soroswap" : "Attested"}
                        </div>
                      </div>
                    </Row>
                  );
                })}
              />
            </>
          ))}
      </div>
    </div>
  );
}

function EmptyState({ address }: { address: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <div className="h-[15px] w-[15px] rotate-45 border border-border" />
      <div className="text-[13px] text-text-faint">
        {address ? "No resting orders — nothing of yours is sitting in the pool right now." : "Connect your wallet to see your resting orders."}
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: { label: string; className: string }[]; rows: React.ReactNode[] }) {
  return (
    <div>
      <div className="mono flex h-[26px] items-center border-b border-border text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
        {head.map((h, i) => (
          <div key={i} className={h.className}>
            {h.label}
          </div>
        ))}
      </div>
      <div>{rows}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[56px] items-center border-b border-border-2 hover:bg-surface-2">{children}</div>;
}

function Cell({ children, mono, dim, faint }: { children: React.ReactNode; mono?: boolean; dim?: boolean; faint?: boolean }) {
  return (
    <div className={`flex-1 text-[12.5px] ${mono ? "font-mono" : ""} ${dim ? "text-text-dim" : faint ? "text-text-faint" : "text-text"}`}>{children}</div>
  );
}

function PairCell({ label, give, want, sub }: { label: string; give?: TokenInfo; want?: TokenInfo; sub: string }) {
  return (
    <div className="flex w-[230px] items-center gap-2.5 pl-1">
      <div className="flex items-center">
        {give && <TokenIcon token={give} size={22} />}
        {want && <div className="-ml-2"><TokenIcon token={want} size={22} /></div>}
      </div>
      <div>
        <div className="text-[12.5px] font-semibold">{label}</div>
        <div className="mono mt-0.5 text-[9px] tracking-[0.08em] text-text-faint uppercase">{sub}</div>
      </div>
    </div>
  );
}
