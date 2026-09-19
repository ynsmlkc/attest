import { useEffect, useRef, useState } from "react";
import { TRADABLE_TOKENS, type TokenInfo } from "../../lib/config";
import { submitOrder, type Match } from "../../lib/matchingEngine";
import { signOrder } from "../../lib/orderSigning";
import { toStroops } from "../../lib/amounts";
import {
  deposit,
  getOrderKey,
  getReflectorPrice,
  getVaultBalance,
  registerOrderKey,
} from "../../lib/contracts";
import { TokenIcon } from "./TokenIcon";

/** Suggested amount only -- a live Reflector quote, formatted for display.
 * Never used for the actual signed order value (that's always whatever's
 * literally in the "You want" field when Submit is pressed). */
function formatSuggested(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount
    .toFixed(Math.min(decimals, 7))
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

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
  // Tracks whether the user has typed into "You want" themselves -- once
  // they have, their number is a deliberate price override and the live-quote
  // suggestion below stops touching it until "You give" (or the pair) changes
  // again, which resumes suggesting.
  const [wantEdited, setWantEdited] = useState(false);
  const lastSuggestion = useRef<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "registering" | "depositing" | "submitting" | "matched" | "partial" | "waiting" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const giveTok = TRADABLE_TOKENS.find((t) => t.code === giveCode) ?? giveDefault;
  const wantTok = TRADABLE_TOKENS.find((t) => t.code === wantCode) ?? wantDefault;

  function flip() {
    setGiveCode(wantCode);
    setWantCode(giveCode);
    setGive(want);
    setWant(give);
    setWantEdited(false);
  }

  // Suggests "You want" from live Reflector prices whenever "You give" or
  // either token changes -- a starting point, not a locked-in rate: whatever
  // ends up in this field at submit time is your signed limit price (the
  // engine fills at that price or better, in whole or in part), editable
  // like any other.
  useEffect(() => {
    if (wantEdited) return;
    const giveNum = Number(give);
    if (!give || !Number.isFinite(giveNum) || giveNum <= 0) return;
    let cancelled = false;
    (async () => {
      const [givePrice, wantPrice] = await Promise.all([
        getReflectorPrice(giveTok.reflectorSymbol),
        getReflectorPrice(wantTok.reflectorSymbol),
      ]);
      if (cancelled || wantEdited) return;
      if (!givePrice || !wantPrice) return;
      const suggested = formatSuggested((giveNum * givePrice) / wantPrice, wantTok.decimals);
      lastSuggestion.current = suggested;
      setWant(suggested);
    })();
    return () => {
      cancelled = true;
    };
  }, [give, giveTok.code, giveTok.reflectorSymbol, wantTok.code, wantTok.reflectorSymbol, wantTok.decimals, wantEdited]);

  function onWantChange(v: string) {
    // A change matching our own last suggestion (the effect above setting
    // it) isn't a user override; anything else is.
    setWantEdited(v !== lastSuggestion.current);
    setWant(v);
  }

  function onGiveChange(v: string) {
    setGive(v);
    const n = Number(v);
    if (!wantEdited && (!v || !Number.isFinite(n) || n <= 0)) {
      lastSuggestion.current = null;
      setWant("");
    }
  }

  async function submit() {
    if (!address || !give || !want) return;
    setErrorMsg(null);
    try {
      const giveAmount = toStroops(give, giveTok.decimals);

      // One-time: link the key this wallet signs orders with, so the vault
      // can verify every order's signature on-chain (see registerOrderKey).
      if (!(await getOrderKey(address))) {
        setStatus("registering");
        await registerOrderKey(address);
      }

      // Locks the traded asset into the vault as part of placing the
      // order, rather than requiring a separate manual "deposit" step
      // first -- only tops up the shortfall, since the wallet may already
      // hold some vault balance from an earlier deposit.
      setStatus("depositing");
      const currentBalance = await getVaultBalance(giveTok, address);
      if (currentBalance < giveAmount) {
        await deposit(giveTok, address, giveAmount - currentBalance);
      }

      setStatus("submitting");
      const orderFields = {
        party: address,
        giveToken: giveTok.sacId,
        giveAmount: Number(giveAmount),
        wantToken: wantTok.sacId,
        wantAmount: Number(toStroops(want, wantTok.decimals)),
      };
      // SEP-0053: proves this order actually came from `party`'s own
      // keypair, not just someone who knows their public address.
      const { ts, signature } = await signOrder(orderFields);
      const result = await submitOrder({ ...orderFields, ts, signature });
      if (result.settled) {
        // The engine fills partially too: if part of the order is still
        // unfilled it keeps resting in the book.
        setStatus((result.order.remaining ?? 0) > 0 ? "partial" : "matched");
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
          onChange={onGiveChange}
          token={giveTok}
          exclude={wantCode}
          onToken={setGiveCode}
        />
        <div className="flex items-center gap-2.5 py-2">
          <div className="h-px flex-1 bg-border" />
          <button
            onClick={flip}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border-hover bg-surface-3 text-sm text-text-dim hover:border-amber hover:text-amber"
          >
            ⇅
          </button>
          <div className="h-px flex-1 bg-border" />
        </div>
        <Field
          label="You want"
          value={want}
          onChange={onWantChange}
          token={wantTok}
          exclude={giveCode}
          onToken={(code) => {
            setWantCode(code);
            setWantEdited(false);
          }}
          hint={!wantEdited && want ? "live quote suggestion" : undefined}
        />

        <button
          onClick={submit}
          disabled={
            !address ||
            status === "registering" ||
            status === "depositing" ||
            status === "submitting" ||
            !give ||
            !want
          }
          className="mt-2.5 w-full btn-amber rounded-[3px] py-[11px] text-[13px] font-semibold tracking-[0.1em] uppercase transition disabled:opacity-40"
        >
          {!address
            ? "Connect wallet to trade"
            : status === "registering"
              ? "Linking order key…"
              : status === "depositing"
              ? "Locking funds into vault…"
              : status === "submitting"
                ? "Sign & submit…"
                : "Submit order"}
        </button>

        <p className="mono mt-2.5 text-[9.5px] leading-[1.5] text-text-faint">
          Matched privately in the pool first. Anything left over is sent to Soroswap at your limit
          price or better — that leg is a public on-chain swap.
        </p>

        {status === "matched" && (
          <p className="mono mt-2.5 bg-up/10 px-2.5 py-2 text-[10.5px] text-up">
            Matched and settled inside the TEE — see activity below.
          </p>
        )}
        {status === "partial" && (
          <p className="mono mt-2.5 bg-up/10 px-2.5 py-2 text-[10.5px] text-up">
            Partially matched and settled — the rest is resting in the book.
          </p>
        )}
        {status === "waiting" && (
          <p className="mono mt-2.5 bg-surface-3 px-2.5 py-2 text-[10.5px] text-text-dim">
            Resting in the book — waiting for an opposite match.
          </p>
        )}
        {status === "error" && (
          <p className="mono mt-2.5 bg-down/10 px-2.5 py-2 text-[10.5px] text-down">
            {errorMsg} — check your wallet balance and that the matching-engine CVM is running.
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
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  token: TokenInfo;
  exclude: string;
  onToken: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="border border-border bg-panel px-3 py-2.5">
      <div className="mono flex justify-between text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
        <div>{label}</div>
        {hint && <div className="text-amber/70 normal-case">{hint}</div>}
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
          className="flex items-center gap-1.5 rounded-[3px] border border-border-hover bg-transparent px-1.5 py-1 text-[12px] font-semibold outline-none hover:border-amber"
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
