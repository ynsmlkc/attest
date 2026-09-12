import { useState } from "react";
import { TRADABLE_TOKENS, type TokenInfo } from "../../lib/config";
import { submitOrder, type Match } from "../../lib/matchingEngine";
import { toStroops } from "../../lib/amounts";
import { TokenIcon } from "./TokenIcon";

interface Props {
  address: string | null;
  giveDefault: TokenInfo;
  wantDefault: TokenInfo;
  onSettled: (m: Match) => void;
}

export function OrderPanel({ address, giveDefault, wantDefault, onSettled }: Props) {
  const [giveCode, setGiveCode] = useState(giveDefault.code);
  const [wantCode, setWantCode] = useState(wantDefault.code);
  const [give, setGive] = useState("");
  const [want, setWant] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "matched" | "waiting" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const giveTok = TRADABLE_TOKENS.find((t) => t.code === giveCode) ?? giveDefault;
  const wantTok = TRADABLE_TOKENS.find((t) => t.code === wantCode) ?? wantDefault;

  function flip() {
    setGiveCode(wantCode);
    setWantCode(giveCode);
    setGive(want);
    setWant(give);
  }

  async function submit() {
    if (!address || !give || !want) return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const result = await submitOrder({
        party: address,
        giveToken: giveTok.sacId,
        giveAmount: Number(toStroops(give, giveTok.decimals)),
        wantToken: wantTok.sacId,
        wantAmount: Number(toStroops(want, wantTok.decimals)),
      });
      if (result.settled) {
        setStatus("matched");
        onSettled(result.settled);
      } else {
        setStatus("waiting");
      }
      setGive("");
      setWant("");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Order submission failed");
    }
  }

  return (
    <div className="border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-[13px] py-[11px]">
        <div className="mono text-[9.5px] tracking-[0.16em] uppercase">New order</div>
        <div className="mono text-[9px] tracking-[0.1em] text-text-faint uppercase">
          Sealed until settlement
        </div>
      </div>
      <div className="p-[13px]">
        <Field
          label="You give"
          value={give}
          onChange={setGive}
          token={giveTok}
          exclude={wantCode}
          onToken={setGiveCode}
        />
        <div className="flex items-center gap-2.5 py-2">
          <div className="h-px flex-1 bg-border" />
          <button
            onClick={flip}
            className="flex h-[26px] w-[26px] items-center justify-center border border-border-hover bg-surface-3 text-sm text-text-dim hover:border-amber hover:text-amber"
          >
            ⇅
          </button>
          <div className="h-px flex-1 bg-border" />
        </div>
        <Field
          label="You want"
          value={want}
          onChange={setWant}
          token={wantTok}
          exclude={giveCode}
          onToken={setWantCode}
        />

        <button
          onClick={submit}
          disabled={!address || status === "submitting" || !give || !want}
          className="mt-2.5 w-full bg-amber py-[11px] text-[13px] font-semibold tracking-[0.1em] text-[#0A0B0D] uppercase transition hover:bg-amber-hi disabled:opacity-40"
        >
          {!address ? "Connect wallet to trade" : status === "submitting" ? "Submitting to TEE…" : "Submit order"}
        </button>

        {status === "matched" && (
          <p className="mono mt-2.5 bg-up/10 px-2.5 py-2 text-[10.5px] text-up">
            Matched and settled inside the TEE — see activity below.
          </p>
        )}
        {status === "waiting" && (
          <p className="mono mt-2.5 bg-surface-3 px-2.5 py-2 text-[10.5px] text-text-dim">
            Resting in the book — waiting for an opposite match.
          </p>
        )}
        {status === "error" && (
          <p className="mono mt-2.5 bg-down/10 px-2.5 py-2 text-[10.5px] text-down">
            {errorMsg} — is the matching-engine CVM running?
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  token,
  exclude,
  onToken,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  token: TokenInfo;
  exclude: string;
  onToken: (v: string) => void;
}) {
  return (
    <div className="border border-border bg-panel px-3 py-2.5">
      <div className="mono flex justify-between text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
        <div>{label}</div>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <input
          type="number"
          min="0"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mono w-full min-w-0 flex-1 bg-transparent text-[20px] font-medium outline-none placeholder:text-text-ghost"
        />
        <select
          value={token.code}
          onChange={(e) => onToken(e.target.value)}
          className="flex items-center gap-1.5 border border-border-hover bg-transparent px-1.5 py-1 text-[12px] font-semibold outline-none hover:border-amber"
        >
          {TRADABLE_TOKENS.filter((t) => t.code !== exclude).map((t) => (
            <option key={t.code} value={t.code}>
              {t.code}
            </option>
          ))}
        </select>
        <TokenIcon token={token} size={18} />
      </div>
    </div>
  );
}
