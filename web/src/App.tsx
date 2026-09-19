import { useState } from "react";
import { Landing } from "./components/landing/Landing";
import { Header, type View } from "./components/terminal/Header";
import { MarketList } from "./components/terminal/MarketList";
import { ChartPanel } from "./components/terminal/ChartPanel";
import { OrderPanel } from "./components/terminal/OrderPanel";
import { AttestationCard } from "./components/terminal/AttestationCard";
import { BalancesCard } from "./components/terminal/BalancesCard";
import { ActivityTable } from "./components/terminal/ActivityTable";
import { AnchorPanel } from "./components/terminal/AnchorPanel";
import { OrdersPanel } from "./components/terminal/OrdersPanel";
import { AttestationsPanel } from "./components/terminal/AttestationsPanel";
import { useWallet } from "./lib/useWallet";
import { useMarketData } from "./lib/useMarketData";
import { NATIVE_XLM, TESTNET_USDC, TRADABLE_TOKENS } from "./lib/config";
import type { Match } from "./lib/matchingEngine";

function App() {
  const { address, connecting, error, connect, disconnect } = useWallet();
  const market = useMarketData();
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<View>("trade");
  const [activeCode, setActiveCode] = useState(NATIVE_XLM.code);
  const [engineOnline, setEngineOnline] = useState(true);
  const [, setLatestMatch] = useState<Match | null>(null);

  const active = TRADABLE_TOKENS.find((t) => t.code === activeCode) ?? NATIVE_XLM;

  if (!entered) {
    return <Landing onLaunch={() => setEntered(true)} />;
  }

  return (
    <div
      className="app-enter mx-auto flex h-screen max-w-[1440px] flex-col overflow-hidden bg-panel text-text"
      style={{ fontFeatureSettings: "'tnum' 1" }}
    >
      <Header
        address={address}
        connecting={connecting}
        onConnect={connect}
        onDisconnect={disconnect}
        engineOnline={engineOnline}
        view={view}
        onNavigate={setView}
      />

      {error && (
        <div className="mono flex-none border-b border-down/30 bg-down/10 px-5 py-2 text-[11px] text-down">
          {error}
        </div>
      )}

      {view === "trade" ? (
        <>
          <div className="flex min-h-0 flex-1">
            <MarketList market={market} active={active} onSelect={(t) => setActiveCode(t.code)} />

            <ChartPanel token={active} data={market[active.code] ?? { history: [], price: null, change24hPct: null, loading: true }} />

            <div className="flex w-[344px] flex-none flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-3.5">
              <OrderPanel
                address={address}
                giveDefault={NATIVE_XLM}
                wantDefault={TESTNET_USDC}
                onSettled={setLatestMatch}
              />
              <AttestationCard />
              <BalancesCard address={address} />
            </div>
          </div>

          <ActivityTable onEngineStatus={setEngineOnline} />
        </>
      ) : view === "anchor" ? (
        <AnchorPanel address={address} />
      ) : view === "orders" ? (
        <OrdersPanel address={address} onEngineStatus={setEngineOnline} />
      ) : (
        <AttestationsPanel />
      )}
    </div>
  );
}

export default App;
