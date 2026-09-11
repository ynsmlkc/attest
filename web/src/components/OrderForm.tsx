import { useState } from "react";
import { submitOrder, type Match } from "../lib/matchingEngine";
import { NATIVE_XLM, TESTNET_USDC, TRADABLE_TOKENS } from "../lib/config";
import { toStroops } from "./BalancePanel";

interface Props {
  address: string | null;
  onSettled?: (m: Match) => void;
}

export function OrderForm({ address, onSettled }: Props) {
  const [giveCode, setGiveCode] = useState(NATIVE_XLM.code);
  const [wantCode, setWantCode] = useState(TESTNET_USDC.code);
  const [giveAmount, setGiveAmount] = useState("");
  const [wantAmount, setWantAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "matched" | "waiting" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const giveToken = TRADABLE_TOKENS.find((t) => t.code === giveCode)!;
  const wantToken = TRADABLE_TOKENS.find((t) => t.code === wantCode)!;

  function swap() {
    setGiveCode(wantCode);
    setWantCode(giveCode);
    setGiveAmount(wantAmount);
    setWantAmount(giveAmount);
  }

  async function submit() {
    if (!address || !giveAmount || !wantAmount) return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const result = await submitOrder({
        party: address,
        giveToken: giveToken.sacId,
        giveAmount: Number(toStroops(giveAmount, giveToken.decimals)),
        wantToken: wantToken.sacId,
        wantAmount: Number(toStroops(wantAmount, wantToken.decimals)),
      });
      if (result.settled) {
        setStatus("matched");
        onSettled?.(result.settled);
      } else {
        setStatus("waiting");
      }
      setGiveAmount("");
      setWantAmount("");
    } catch (e) {
      setStatus("error");
      setErrorMsg(
        e instanceof Error
          ? `${e.message} — is the matching-engine CVM running?`
          : "Failed to submit order",
      );
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-text">New Order</h2>

      <div className="space-y-2">
        <FieldRow
          label="You give"
          amount={giveAmount}
          onAmount={setGiveAmount}
          token={giveCode}
          onToken={setGiveCode}
          exclude={wantCode}
        />

        <div className="flex justify-center">
          <button
            onClick={swap}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-2 text-text-dim transition hover:border-border-hover hover:text-text"
            aria-label="Swap direction"
          >
            ↓
          </button>
        </div>

        <FieldRow
          label="You want"
          amount={wantAmount}
          onAmount={setWantAmount}
          token={wantCode}
          onToken={setWantCode}
          exclude={giveCode}
        />
      </div>

      <button
        onClick={submit}
        disabled={!address || status === "submitting" || !giveAmount || !wantAmount}
        className="mt-4 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_-6px_var(--color-brand-glow)] transition hover:bg-brand-dim disabled:opacity-40"
      >
        {!address
          ? "Connect wallet to trade"
          : status === "submitting"
            ? "Submitting to TEE…"
            : "Submit Order"}
      </button>

      {status === "matched" && (
        <p className="mt-3 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
          Matched and settled inside the TEE — see Activity.
        </p>
      )}
      {status === "waiting" && (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-text-dim">
          Order resting in the book — waiting for an opposite match.
        </p>
      )}
      {status === "error" && errorMsg && (
        <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{errorMsg}</p>
      )}
    </div>
  );
}

function FieldRow({
  label,
  amount,
  onAmount,
  token,
  onToken,
  exclude,
}: {
  label: string;
  amount: string;
  onAmount: (v: string) => void;
  token: string;
  onToken: (v: string) => void;
  exclude: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-1.5 text-xs text-text-faint">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          className="mono-nums w-full bg-transparent text-lg font-medium outline-none placeholder:text-text-faint"
        />
        <select
          value={token}
          onChange={(e) => onToken(e.target.value)}
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm font-medium outline-none"
        >
          {TRADABLE_TOKENS.filter((t) => t.code !== exclude).map((t) => (
            <option key={t.code} value={t.code}>
              {t.code}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
