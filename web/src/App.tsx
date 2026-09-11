import { useState } from "react";
import { Header } from "./components/Header";
import { PriceTicker } from "./components/PriceTicker";
import { AttestationPanel } from "./components/AttestationPanel";
import { BalancePanel } from "./components/BalancePanel";
import { OrderForm } from "./components/OrderForm";
import { ActivityFeed } from "./components/ActivityFeed";
import { useWallet } from "./lib/useWallet";
import type { Match } from "./lib/matchingEngine";

function App() {
  const { address, connecting, error, connect, disconnect } = useWallet();
  const [latestMatch, setLatestMatch] = useState<Match | null>(null);

  return (
    <div className="min-h-screen">
      <Header
        address={address}
        connecting={connecting}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      <PriceTicker />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        {error && (
          <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Trade privately. Settle provably.
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-dim">
            Orders are matched inside a genuine Intel TDX enclave, not a server you have to
            trust. Every settlement is signed by a key that was generated inside — and never
            left — that verified hardware.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <OrderForm address={address} onSettled={setLatestMatch} />
            <ActivityFeed latestExternal={latestMatch} />
          </div>
          <div className="space-y-6">
            <AttestationPanel />
            <BalancePanel address={address} />
          </div>
        </div>
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs text-text-faint md:px-10">
        Attest · Soroban TEE attestation verification ·{" "}
        <a
          href="https://github.com/ynsmlkc/attest"
          target="_blank"
          rel="noreferrer"
          className="hover:text-text-dim"
        >
          source
        </a>
      </footer>
    </div>
  );
}

export default App;
