import { useEffect, useState } from "react";
import { getEngineAddress, isEnclaveRegistered } from "../../lib/contracts";
import {
  ATTESTATION_VERIFIER_ID,
  MATCHING_ENGINE_ENCLAVE_ID,
  MATCHING_ENGINE_ENGINE_ADDRESS,
} from "../../lib/config";
import { REPO_URL } from "../../lib/config";

type Status = "checking" | "verified" | "mismatch" | "error";

function short(addr: string, lead = 6, tail = 6) {
  return addr.length > lead + tail ? `${addr.slice(0, lead)}…${addr.slice(-tail)}` : addr;
}

export function AttestationsPanel() {
  const [status, setStatus] = useState<Status>("checking");
  const [engineAddress, setEngineAddress] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const registered = await isEnclaveRegistered(MATCHING_ENGINE_ENCLAVE_ID);
        if (!registered) {
          if (!cancelled) setStatus("mismatch");
          return;
        }
        const addr = await getEngineAddress(MATCHING_ENGINE_ENCLAVE_ID);
        if (cancelled) return;
        setEngineAddress(addr);
        setStatus(addr === MATCHING_ENGINE_ENGINE_ADDRESS ? "verified" : "mismatch");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const verified = status === "verified";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="font-display text-[22px] font-normal tracking-[-0.01em]">Enclave attestations</h1>
            <p className="mt-1.5 max-w-[720px] text-[12.5px] text-text-dim">
              Every matching engine admitted to the pool must present a TDX quote that the verifier contract checks
              on-chain. This page reads that contract state directly — it isn't a claim made by this front end.
            </p>
          </div>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${ATTESTATION_VERIFIER_ID}`}
            target="_blank"
            rel="noreferrer"
            className="mono border border-border-hover px-2.5 py-1.5 text-[9.5px] tracking-[0.12em] text-text-dim uppercase hover:border-amber hover:text-amber"
          >
            Verifier contract →
          </a>
        </div>

        <div className="flex border border-border bg-surface-2">
          <Stat label="Registered enclaves" value="1" sub="known to this app" color="var(--color-text)" />
          <Stat
            label="Verification"
            value={status === "checking" ? "…" : verified ? "Verified" : status === "mismatch" ? "Not registered" : "Check failed"}
            sub="live on-chain read"
            color={verified ? "var(--color-up)" : status === "checking" ? "var(--color-text-dim)" : "var(--color-down)"}
          />
          <Stat label="TEE type" value="Intel TDX" sub="via dstack" color="var(--color-text)" />
        </div>

        <div className="mono mt-4 flex h-7 items-center border-b border-border text-[8.5px] tracking-[0.16em] text-text-faint uppercase">
          <div className="w-[140px] pl-1">Status</div>
          <div className="w-[240px]">Enclave ID</div>
          <div className="w-[220px]">Engine address</div>
          <div className="flex-1">Verifier contract</div>
          <div className="w-[40px]" />
        </div>

        <div>
          <div
            onClick={() => setOpen((v) => !v)}
            className="flex h-[50px] cursor-pointer items-center border-b border-border-2 hover:bg-surface-2"
          >
            <div className="w-[140px] pl-1">
              <StatusBadge status={status} />
            </div>
            <div className="mono w-[240px] text-[11.5px] text-text">{short(MATCHING_ENGINE_ENCLAVE_ID, 10, 6)}</div>
            <div className="mono w-[220px] text-[11.5px] text-text-dim">
              {status === "checking" ? "checking…" : short(engineAddress ?? MATCHING_ENGINE_ENGINE_ADDRESS)}
            </div>
            <div className="mono flex-1 text-[11.5px] text-text-dim">{short(ATTESTATION_VERIFIER_ID)}</div>
            <div className="w-[40px] text-center text-[10px] text-text-faint">{open ? "▲" : "▼"}</div>
          </div>

          {open && (
            <div className="flex border-b border-border bg-[#101317]">
              <div className="flex-1 border-r border-border p-4.5">
                <div className="mono mb-3 text-[9px] tracking-[0.18em] text-text-faint uppercase">What's checked</div>
                <DetailRow k="MRTD" note="Trust domain initial state — firmware + VM shape, shared across every app on this dstack build" />
                <DetailRow k="RTMR3" note="Application measurement — extends over the docker-compose/app content, differs per app; this is what actually pins the code" />
                <DetailRow k="Quote signature" note="Intel-signed TDX v4 quote, verified via Soroban's native secp256r1_verify" />
              </div>
              <div className="flex-1 p-4.5">
                <div className="mono mb-3 text-[9px] tracking-[0.18em] text-text-faint uppercase">This engine</div>
                <div className="mono flex items-center justify-between border-b border-[#16191E] py-2 text-[11px]">
                  <span className="text-text-dim">Engine address matches derived key</span>
                  <span className={verified ? "text-up" : "text-text-faint"}>{verified ? "Yes" : status === "checking" ? "checking…" : "No"}</span>
                </div>
                <div className="mono flex items-center justify-between border-b border-[#16191E] py-2 text-[11px]">
                  <span className="text-text-dim">Registered on this verifier</span>
                  <span className={status !== "mismatch" ? "text-up" : "text-down"}>{status === "checking" ? "checking…" : status !== "mismatch" ? "Yes" : "No"}</span>
                </div>
                <div className="mt-3 border-t border-border pt-3 text-[11.5px] leading-relaxed text-text-dim">
                  MRTD alone only proves "some app is running on genuine TDX + dstack hardware" — RTMR3 is what proves
                  it's <em>this</em> code. Both are checked by the verifier contract at registration; nothing above is
                  asserted by this page. See the repo's{" "}
                  <a href={REPO_URL} target="_blank" rel="noreferrer">
                    README
                  </a>{" "}
                  for the exact byte offsets and how they were cross-validated against Phala's own reported values.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-3.5 border border-border bg-surface-2 p-4">
          <div className="w-[3px] flex-none bg-border-2" />
          <p className="text-[12px] leading-relaxed text-text-dim">
            This app only knows about one deployed matching-engine enclave — there's no on-chain index of every
            enclave ever registered on this verifier, so this list isn't (and doesn't claim to be) exhaustive. What's
            shown above is a direct, live read of <code className="mono">is_registered</code> /{" "}
            <code className="mono">get_engine_address</code> for that one enclave, refreshed on page load.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="flex-1 border-r border-border-2 p-3.5 last:border-r-0">
      <div className="mono text-[8.5px] tracking-[0.16em] text-text-faint uppercase">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2.5">
        <div className="mono text-[20px] font-medium" style={{ color }}>
          {value}
        </div>
        <div className="mono text-[10px] text-text-faint">{sub}</div>
      </div>
    </div>
  );
}

function DetailRow({ k, note }: { k: string; note: string }) {
  return (
    <div className="border-b border-[#16191E] py-2">
      <div className="text-[11.5px] font-medium text-text">{k}</div>
      <div className="mono mt-1 text-[9.5px] leading-relaxed text-text-faint">{note}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "checking") {
    return <span className="mono text-[9.5px] text-text-faint uppercase">checking…</span>;
  }
  const verified = status === "verified";
  return (
    <div
      className="mono inline-flex items-center gap-1.5 px-2 py-1 text-[9.5px] tracking-[0.08em] uppercase"
      style={{
        color: verified ? "var(--color-up)" : "var(--color-down)",
        borderColor: verified ? "#2C4A3C" : "#4a2c2c",
        background: verified ? "#10201A" : "#201010",
        border: "1px solid",
      }}
    >
      <div className="h-[5px] w-[5px]" style={{ background: verified ? "var(--color-up)" : "var(--color-down)" }} />
      {verified ? "Verified" : status === "mismatch" ? "Not registered" : "Check failed"}
    </div>
  );
}
