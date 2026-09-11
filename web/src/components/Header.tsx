interface HeaderProps {
  address: string | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Header({ address, connecting, onConnect, onDisconnect }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-5 md:px-10">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-dim shadow-[0_0_20px_-4px_var(--color-brand-glow)]">
          <span className="font-mono text-sm font-bold text-white">A</span>
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Attest</h1>
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-dim uppercase">
              Testnet
            </span>
          </div>
          <p className="text-xs text-text-dim">TEE-Verified Dark Pool</p>
        </div>
      </div>

      {address ? (
        <button
          onClick={onDisconnect}
          className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition hover:border-border-hover"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="mono-nums text-text-dim group-hover:text-text">
            {short(address)}
          </span>
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={connecting}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-[0_0_20px_-6px_var(--color-brand-glow)] transition hover:bg-brand-dim disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect Freighter"}
        </button>
      )}
    </header>
  );
}
