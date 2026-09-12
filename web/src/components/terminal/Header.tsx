interface Props {
  address: string | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  engineOnline: boolean;
}

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Header({ address, connecting, onConnect, onDisconnect, engineOnline }: Props) {
  return (
    <div className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-5">
      <div className="flex items-center gap-2.5">
        <div className="h-[15px] w-[15px] rotate-45 bg-amber" />
        <div className="text-base font-semibold tracking-[0.18em] uppercase">Attest</div>
      </div>
      <div className="mono border border-border-2 px-2 py-1 text-[9px] tracking-[0.14em] text-text-dim uppercase">
        Dark Pool · Testnet
      </div>

      <div className="ml-2 flex items-center gap-6 text-[12.5px] text-text-dim">
        <div className="font-medium text-text shadow-[inset_0_-1px_0_var(--color-amber)] pb-0.5">
          Trade
        </div>
        <div className="hidden sm:block">Orders</div>
        <div className="hidden sm:block">Pool</div>
        <div className="hidden md:block">Attestations</div>
        <a
          href="https://github.com/ynsmlkc/attest"
          target="_blank"
          rel="noreferrer"
          className="hidden text-text-dim hover:text-amber md:block"
        >
          Docs
        </a>
      </div>

      <div className="flex-1" />

      <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.12em] text-text-dim uppercase">
        <div
          className={`h-1.5 w-1.5 ${engineOnline ? "pulse bg-up" : "bg-down"}`}
        />
        {engineOnline ? "Engine online" : "Engine offline"}
      </div>

      {address ? (
        <button
          onClick={onDisconnect}
          className="mono ml-4 flex items-center gap-2 border border-border-hover bg-surface-3 px-3 py-2 text-[11px] tracking-[0.04em] transition hover:border-amber"
        >
          <div className="h-[5px] w-[5px] bg-amber" />
          {short(address)}
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={connecting}
          className="mono ml-4 flex items-center gap-2 border border-border-hover bg-surface-3 px-3 py-2 text-[11px] tracking-[0.04em] transition hover:border-amber disabled:opacity-50"
        >
          <div className="h-[5px] w-[5px] bg-amber" />
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}
