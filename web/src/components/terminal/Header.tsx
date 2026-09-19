import { useEffect, useState } from "react";
import { ANCHOR_URL } from "../../lib/anchor";
import { REPO_URL } from "../../lib/config";

export type View = "trade" | "anchor" | "orders" | "attestations";

interface Props {
  address: string | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  engineOnline: boolean;
  view: View;
  onNavigate: (v: View) => void;
}

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Header({ address, connecting, onConnect, onDisconnect, engineOnline, view, onNavigate }: Props) {
  const [anchorReachable, setAnchorReachable] = useState<boolean | null>(null);

  useEffect(() => {
    if (view !== "anchor") return;
    let cancelled = false;
    fetch(`${ANCHOR_URL}/sep6/info`)
      .then((r) => {
        if (!cancelled) setAnchorReachable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setAnchorReachable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  return (
    <div className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-5">
      <div className="flex items-center gap-2.5">
        <img src="/logo-mark.svg" alt="" className="h-[36px] w-[36px]" />
        <div className="font-display text-[19px] font-normal tracking-[-0.01em] text-text">Attest</div>
      </div>
      <div className="mono border border-border-2 px-2 py-1 text-[9px] tracking-[0.14em] text-text-dim uppercase">
        Dark Pool · Testnet
      </div>

      <div className="ml-2 flex items-center gap-6 text-[12.5px] text-text-dim">
        <button
          onClick={() => onNavigate("trade")}
          className={`pb-0.5 ${view === "trade" ? "font-medium text-text shadow-[inset_0_-1px_0_var(--color-amber)]" : "hover:text-text"}`}
        >
          Trade
        </button>
        <button
          onClick={() => onNavigate("orders")}
          className={`hidden pb-0.5 sm:block ${view === "orders" ? "font-medium text-text shadow-[inset_0_-1px_0_var(--color-amber)]" : "hover:text-text"}`}
        >
          Orders
        </button>
        <button
          onClick={() => onNavigate("attestations")}
          className={`hidden pb-0.5 md:block ${view === "attestations" ? "font-medium text-text shadow-[inset_0_-1px_0_var(--color-amber)]" : "hover:text-text"}`}
        >
          Attestations
        </button>
        <button
          onClick={() => onNavigate("anchor")}
          className={`pb-0.5 ${view === "anchor" ? "font-medium text-text shadow-[inset_0_-1px_0_var(--color-amber)]" : "hover:text-text"}`}
        >
          Anchor
        </button>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="hidden text-text-dim hover:text-amber md:block"
        >
          Docs
        </a>
      </div>

      <div className="flex-1" />

      {view === "trade" || view === "orders" ? (
        <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.12em] text-text-dim uppercase">
          <div className={`h-1.5 w-1.5 ${engineOnline ? "pulse bg-up" : "bg-down"}`} />
          {engineOnline ? "Engine online" : "Engine offline"}
        </div>
      ) : view === "anchor" ? (
        <div
          className="mono flex items-center gap-2 text-[9.5px] tracking-[0.12em] uppercase"
          style={{ color: anchorReachable === false ? "var(--color-down)" : "var(--color-up)" }}
        >
          <div className={`h-1.5 w-1.5 ${anchorReachable === false ? "bg-down" : "pulse bg-up"}`} />
          {anchorReachable === null ? "Checking anchor…" : anchorReachable ? "Anchor reachable · SEP-6" : "Anchor unreachable"}
        </div>
      ) : (
        <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.12em] text-text-dim uppercase">
          <div className="h-1.5 w-1.5 pulse bg-up" />
          Verifier reachable
        </div>
      )}

      {address ? (
        <button
          onClick={onDisconnect}
          className="mono ml-4 flex items-center gap-2 rounded-[3px] border border-border-hover bg-surface-3 px-3 py-2 text-[11px] tracking-[0.04em] transition hover:border-amber"
        >
          <div className="h-[5px] w-[5px] bg-amber" />
          {short(address)}
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={connecting}
          className="mono ml-4 flex items-center gap-2 rounded-[3px] border border-border-hover bg-surface-3 px-3 py-2 text-[11px] tracking-[0.04em] transition hover:border-amber disabled:opacity-50"
        >
          <div className="h-[5px] w-[5px] bg-amber" />
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}
