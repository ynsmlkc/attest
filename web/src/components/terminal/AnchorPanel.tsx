import { useEffect, useState } from "react";
import {
  ANCHOR_URL,
  getQuote,
  getSep6Limits,
  getSep6Transaction,
  listSep6Transactions,
  sendWithdrawPayment,
  formatLimitRange,
  sep10Auth,
  sep6Deposit,
  sep6Withdraw,
  simulateBankTransfer,
  type DepositInstructions,
  type Sep6AssetLimits,
  type Sep6Transaction,
  type WithdrawInstructions,
} from "../../lib/anchor";
import { deposit, getVaultBalance } from "../../lib/contracts";
import { fromStroops, toStroops } from "../../lib/amounts";
import { NATIVE_XLM, TESTNET_USDC } from "../../lib/config";
import { TokenIcon } from "./TokenIcon";

type Mode = "deposit" | "withdraw";
type Stage = "input" | "requesting" | "instructions" | "processing" | "completed" | "error";

function short(v: string, lead = 6, tail = 6) {
  return v.length > lead + tail ? `${v.slice(0, lead)}…${v.slice(-tail)}` : v;
}

async function copy(v: string) {
  try {
    await navigator.clipboard.writeText(v);
  } catch {
    // clipboard permission denied -- nothing to fall back to, ignore
  }
}

export function AnchorPanel({ address }: { address: string | null }) {
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<Stage>("input");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ price: string; buyAmount: string; feeTry: string } | null>(null);
  const [depositInfo, setDepositInfo] = useState<DepositInstructions | null>(null);
  const [withdrawInfo, setWithdrawInfo] = useState<WithdrawInstructions | null>(null);
  const [tx, setTx] = useState<Sep6Transaction | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [vaultDeposited, setVaultDeposited] = useState(false);

  const [limits, setLimits] = useState<{ deposit: Sep6AssetLimits; withdraw: Sep6AssetLimits } | null>(null);
  const [recent, setRecent] = useState<Sep6Transaction[]>([]);
  const [balances, setBalances] = useState<Record<string, bigint>>({});

  useEffect(() => {
    getSep6Limits().then(setLimits).catch(() => setLimits(null));
  }, []);

  useEffect(() => {
    if (!address) return;
    getVaultBalance(NATIVE_XLM, address).then((b) => setBalances((p) => ({ ...p, XLM: b }))).catch(() => {});
    getVaultBalance(TESTNET_USDC, address).then((b) => setBalances((p) => ({ ...p, USDC: b }))).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!token) return;
    listSep6Transactions(token).then((txs) => setRecent(txs.slice(0, 6))).catch(() => setRecent([]));
  }, [token, tx?.status]);

  // Live SEP-38 quote, debounced against amount changes.
  useEffect(() => {
    if (!amount || Number(amount) <= 0) {
      setQuote(null);
      return;
    }
    const id = setTimeout(() => {
      getQuote(mode, amount)
        .then((q) => setQuote(q))
        .catch(() => setQuote(null));
    }, 350);
    return () => clearTimeout(id);
  }, [amount, mode]);

  // Poll the anchor while a transaction is in flight.
  useEffect(() => {
    if (!token || !tx || stage !== "processing") return;
    const id = setInterval(async () => {
      try {
        const next = await getSep6Transaction(token, tx.id);
        setTx(next);
        setLastPolledAt(Date.now());
        if (next.status === "completed" || next.status === "error") {
          setStage(next.status === "completed" ? "completed" : "error");
          if (next.status === "error") setErrorMsg("Anchor reported an error on this transaction.");
        }
      } catch {
        // transient poll failure -- keep trying on the next tick
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tx?.id, stage]);

  function resetFlow() {
    setStage("input");
    setAmount("");
    setDepositInfo(null);
    setWithdrawInfo(null);
    setTx(null);
    setVaultDeposited(false);
    setErrorMsg(null);
  }

  async function requestInstructions() {
    if (!address || !amount) return;
    setStage("requesting");
    setErrorMsg(null);
    try {
      const jwt = token ?? (await sep10Auth(address));
      setToken(jwt);
      if (mode === "deposit") {
        const info = await sep6Deposit(jwt, address, amount);
        setDepositInfo(info);
      } else {
        const info = await sep6Withdraw(jwt, amount);
        setWithdrawInfo(info);
      }
      setStage("instructions");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to reach the anchor");
      setStage("error");
    }
  }

  async function simulateDeposit() {
    if (!token || !depositInfo) return;
    setErrorMsg(null);
    try {
      await simulateBankTransfer(token, depositInfo.id);
      const initial = await getSep6Transaction(token, depositInfo.id);
      setTx(initial);
      setLastPolledAt(Date.now());
      setStage("processing");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to simulate the bank transfer");
    }
  }

  async function sendPayment() {
    if (!token || !withdrawInfo || !address) return;
    setErrorMsg(null);
    try {
      await sendWithdrawPayment(address, withdrawInfo.account_id, withdrawInfo.memo_type, withdrawInfo.memo, amount);
      const initial = await getSep6Transaction(token, withdrawInfo.id);
      setTx(initial);
      setLastPolledAt(Date.now());
      setStage("processing");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "On-chain payment failed");
    }
  }

  async function depositIntoVault() {
    if (!address || !tx?.amount_out) return;
    try {
      await deposit(TESTNET_USDC, address, toStroops(tx.amount_out, TESTNET_USDC.decimals));
      setVaultDeposited(true);
      getVaultBalance(TESTNET_USDC, address).then((b) => setBalances((p) => ({ ...p, USDC: b }))).catch(() => {});
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Vault deposit failed");
    }
  }

  const activeLimits = limits ? (mode === "deposit" ? limits.deposit : limits.withdraw) : null;
  const secondsAgo = lastPolledAt ? Math.max(0, Math.round((Date.now() - lastPolledAt) / 1000)) : null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-[230px] flex-none border-r border-border bg-surface p-3.5">
        <SideCard title="Anchor">
          <Row k="Home domain" v="tr-mock-anchor.fly.dev" />
          <Row k="Protocol" v="SEP-6 / SEP-10 / SEP-38" />
          <Row k="KYC" v="None (sandbox)" />
          <Row k="Network" v="Testnet" />
        </SideCard>

        <div className="mt-3">
          <SideCard title="Recent transfers">
            {!token ? (
              <div className="mono px-[13px] py-2.5 text-[10.5px] text-text-faint">
                Authenticate with the anchor to see your history.
              </div>
            ) : recent.length === 0 ? (
              <div className="mono px-[13px] py-2.5 text-[10.5px] text-text-faint">No transfers yet.</div>
            ) : (
              recent.map((t) => (
                <div key={t.id} className="mono flex items-center justify-between gap-2 border-b border-border-2 px-[13px] py-2 text-[10px] last:border-b-0">
                  <div className="text-text">{t.kind === "deposit" ? "↓" : "↑"} {t.amount_in ?? "—"}</div>
                  <StatusPill status={t.status} />
                </div>
              ))
            )}
          </SideCard>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-[480px]">
          <h1 className="font-display text-[23px] font-normal tracking-[-0.01em]">Fund your account</h1>
          <p className="mt-1 text-[12.5px] text-text-dim">
            Real testnet USDC via a live SEP-6 sandbox anchor — bank leg simulated, Stellar leg is real.
          </p>

          <div className="mt-5 flex border border-border bg-surface-2">
            {(["deposit", "withdraw"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  resetFlow();
                }}
                className={`flex-1 py-2.5 text-[12px] font-semibold tracking-[0.04em] uppercase transition ${
                  mode === m ? "bg-amber text-[#0A0B0D]" : "text-text-dim hover:text-text"
                }`}
              >
                {m === "deposit" ? "Deposit · TRY → USDC" : "Withdraw · USDC → TRY"}
              </button>
            ))}
          </div>

          {stage === "input" || stage === "requesting" ? (
            <div className="mt-3 border border-border bg-panel px-3.5 py-3">
              <div className="mono flex justify-between text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
                <div>{mode === "deposit" ? "Amount (TRY)" : "Amount (USDC)"}</div>
                {activeLimits && formatLimitRange(activeLimits, "") && (
                  <div>{formatLimitRange(activeLimits, "")}</div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <input
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mono w-full min-w-0 flex-1 bg-transparent text-[20px] font-medium outline-none placeholder:text-text-ghost"
                />
                <TokenIcon token={mode === "deposit" ? TESTNET_USDC : TESTNET_USDC} size={18} />
                <div className="text-[12px] font-semibold">{mode === "deposit" ? "TRY" : "USDC"}</div>
              </div>
              {quote && (
                <div className="mono mt-2 flex items-center gap-2 border-t border-border pt-2 text-[10.5px] text-text-dim">
                  <div className="h-[5px] w-[5px] pulse bg-up" />
                  {mode === "deposit"
                    ? `≈ ${quote.buyAmount} USDC · rate ${Number(quote.price).toFixed(4)} TRY/USDC · fee ${quote.feeTry} TRY`
                    : `≈ ${quote.buyAmount} TRY · rate ${Number(quote.price).toFixed(4)} TRY/USDC`}
                </div>
              )}
              <button
                onClick={requestInstructions}
                disabled={!address || !amount || stage === "requesting"}
                className="mt-3 w-full btn-amber rounded-[3px] py-[11px] text-[13px] font-semibold tracking-[0.1em] uppercase transition disabled:opacity-40"
              >
                {!address
                  ? "Connect wallet"
                  : stage === "requesting"
                    ? "Requesting from anchor…"
                    : mode === "deposit"
                      ? "Get bank transfer instructions"
                      : "Get payout instructions"}
              </button>
            </div>
          ) : null}

          {stage === "instructions" && mode === "deposit" && depositInfo && (
            <InstructionsCard
              rows={Object.entries(depositInfo.instructions ?? {})
                .filter(([k]) => k !== "external_transfer_memo")
                .map(([k, v]) => ({
                  label: v.description || k,
                  value: v.value,
                }))}
              highlightLabel="Reference code — required"
              highlightValue={depositInfo.instructions?.external_transfer_memo?.value ?? depositInfo.id}
              warning="Include this exact reference in the transfer description, or the anchor cannot match your deposit."
              cta="Simulate bank transfer (sandbox)"
              onCta={simulateDeposit}
            />
          )}

          {stage === "instructions" && mode === "withdraw" && withdrawInfo && (
            <InstructionsCard
              rows={[
                { label: "Destination", value: short(withdrawInfo.account_id, 8, 6) },
                { label: "Asset", value: "USDC" },
                { label: "Send exactly", value: `${amount} USDC` },
              ]}
              highlightLabel={`Memo — required (${withdrawInfo.memo_type})`}
              highlightValue={withdrawInfo.memo}
              warning="This payment must carry this exact memo, or the anchor cannot credit your TRY payout."
              cta="Send payment via Freighter"
              onCta={sendPayment}
            />
          )}

          {(stage === "processing" || stage === "completed" || stage === "error") && tx && (
            <div className="mt-3 border border-border bg-surface-2 p-3.5">
              <div className="mono mb-3 flex items-center justify-between text-[9.5px] tracking-[0.16em] uppercase">
                <div>Transfer status</div>
                <StatusPill status={tx.status} />
              </div>
              <StepTracker mode={mode} status={tx.status} />
              {tx.status === "pending_trust" && (
                <p className="mono mt-3 bg-amber/10 px-2.5 py-2 text-[10.5px] text-amber">
                  The anchor is waiting for your account to hold a USDC trustline before it can pay out — add one in
                  Freighter (or via `stellar contract asset`) and it'll resolve on the next poll.
                </p>
              )}
              <div className="mono mt-3 text-[10px] text-text-faint">
                {secondsAgo !== null ? `polled ${secondsAgo}s ago` : ""}
                {tx.stellar_transaction_id && (
                  <>
                    {" · "}
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${tx.stellar_transaction_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber"
                    >
                      view ledger tx
                    </a>
                  </>
                )}
              </div>
              {stage === "completed" && mode === "deposit" && tx.amount_out && !vaultDeposited && (
                <button
                  onClick={depositIntoVault}
                  className="mt-3 w-full btn-amber rounded-[3px] py-[11px] text-[13px] font-semibold tracking-[0.1em] uppercase transition"
                >
                  Deposit {tx.amount_out} USDC into vault
                </button>
              )}
              {vaultDeposited && (
                <p className="mono mt-3 bg-up/10 px-2.5 py-2 text-[10.5px] text-up">
                  Credited to your SettlementVault balance.
                </p>
              )}
              <button onClick={resetFlow} className="mono mt-3 text-[11px] text-text-dim hover:text-amber">
                Start another transfer →
              </button>
            </div>
          )}

          {errorMsg && <p className="mono mt-3 bg-down/10 px-2.5 py-2 text-[10.5px] text-down">{errorMsg}</p>}

          <p className="mono mt-4 text-[10px] leading-relaxed text-text-faint">
            Sandbox anchor ({ANCHOR_URL.replace("https://", "")}) — bank leg simulated, Stellar leg is real testnet
            USDC.
          </p>
        </div>
      </div>

      <div className="w-[230px] flex-none border-l border-border bg-surface p-3.5">
        <SideCard title="Trading balance">
          {!address ? (
            <div className="mono px-0 py-0.5 text-[10.5px] text-text-faint">Connect wallet to view.</div>
          ) : (
            <>
              <Row k="USDC" v={fromStroops(balances.USDC ?? 0n, TESTNET_USDC.decimals)} />
              <Row k="XLM" v={fromStroops(balances.XLM ?? 0n, NATIVE_XLM.decimals)} />
            </>
          )}
        </SideCard>
        <div className="mt-3">
          <SideCard title="Anchor limits">
            {limits ? (
              <>
                <Row k="Deposit min/max" v={formatLimitRange(limits.deposit, "TRY") ?? "—"} />
                <Row k="Deposit fee" v={`${limits.deposit.fee_percent}%`} />
                <Row k="Withdraw min/max" v={formatLimitRange(limits.withdraw, "USDC") ?? "—"} />
                <Row k="Withdraw fee" v={`${limits.withdraw.fee_percent}%`} />
              </>
            ) : (
              <div className="mono px-[13px] py-2.5 text-[10.5px] text-text-faint">Loading…</div>
            )}
          </SideCard>
        </div>
      </div>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border bg-surface-2">
      <div className="border-b border-border px-[13px] py-[11px]">
        <div className="mono text-[9.5px] tracking-[0.16em] uppercase">{title}</div>
      </div>
      <div className="flex flex-col gap-[7px] p-[13px]">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="mono flex items-center justify-between gap-2.5 text-[10px]">
      <div className="text-text-faint tracking-[0.1em] uppercase">{k}</div>
      <div className="truncate text-text">{v}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isDone = status === "completed";
  const isError = status === "error";
  return (
    <div
      className={`mono flex items-center gap-1.5 px-1.5 py-0.5 text-[8.5px] tracking-[0.1em] uppercase ${
        isDone ? "text-up" : isError ? "text-down" : "text-amber"
      }`}
    >
      <div className={`h-[5px] w-[5px] ${isDone ? "bg-up" : isError ? "bg-down" : "pulse bg-amber"}`} />
      {status.replace(/_/g, " ")}
    </div>
  );
}

function StepTracker({ mode, status }: { mode: Mode; status: string }) {
  const steps =
    mode === "deposit"
      ? ["Bank transfer", "Anchor processing", "USDC credited"]
      : ["Payment sent", "Anchor processing", "TRY payout"];
  const stepIndex = status === "completed" ? 3 : status === "pending_user_transfer_start" ? 1 : 2;
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === stepIndex && status !== "completed";
        const done = n < stepIndex || status === "completed";
        return (
          <div key={label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[9px] ${
                  done ? "border-up bg-up/20 text-up" : active ? "border-amber text-amber" : "border-border text-text-faint"
                } ${active ? "pulse" : ""}`}
              >
                {done ? "✓" : n}
              </div>
              <div className="mono w-[70px] text-center text-[8.5px] text-text-faint uppercase">{label}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-1 h-px flex-1 ${done ? "bg-up" : "bg-border"}`} style={{ marginBottom: 18 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InstructionsCard({
  rows,
  highlightLabel,
  highlightValue,
  warning,
  cta,
  onCta,
}: {
  rows: { label: string; value: string }[];
  highlightLabel: string;
  highlightValue: string;
  warning: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="mt-3 border border-border bg-surface-2 p-3.5">
      <div className="mono mb-2.5 text-[9.5px] tracking-[0.16em] uppercase">Instructions</div>
      {rows.map((r) => (
        <div key={r.label} className="mono flex items-center justify-between gap-2.5 border-b border-border-2 py-2 text-[11px] last:border-b-0">
          <div className="text-text-faint">{r.label}</div>
          <div className="flex items-center gap-2">
            <span className="text-text">{r.value}</span>
            <button onClick={() => copy(r.value)} className="text-[9px] text-text-dim hover:text-amber">
              Copy
            </button>
          </div>
        </div>
      ))}
      <div className="mt-2.5 border border-amber bg-amber/10 p-2.5">
        <div className="mono flex items-center justify-between text-[9px] tracking-[0.12em] text-amber uppercase">
          {highlightLabel}
          <button onClick={() => copy(highlightValue)} className="text-text-dim hover:text-amber">
            Copy
          </button>
        </div>
        <div className="mono mt-1 text-[13px] font-semibold">{highlightValue}</div>
        <div className="mt-1.5 text-[10.5px] leading-relaxed text-text-dim">{warning}</div>
      </div>
      <button
        onClick={onCta}
        className="mt-3 w-full btn-amber rounded-[3px] py-[11px] text-[13px] font-semibold tracking-[0.1em] uppercase transition"
      >
        {cta}
      </button>
    </div>
  );
}
