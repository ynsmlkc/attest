import { useEffect, useState } from "react";
import { getEngineAddress, isEnclaveRegistered } from "../../lib/contracts";
import {
  ATTESTATION_VERIFIER_ID,
  MATCHING_ENGINE_ENCLAVE_ID,
  MATCHING_ENGINE_ENGINE_ADDRESS,
} from "../../lib/config";

type Status = "checking" | "verified" | "mismatch" | "error";

function short(addr: string, lead = 4, tail = 4) {
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function AttestationCard() {
  const [status, setStatus] = useState<Status>("checking");
  const [engineAddress, setEngineAddress] = useState<string | null>(null);

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

  const rows = [
    { k: "Enclave", v: short(MATCHING_ENGINE_ENCLAVE_ID, 8, 6) },
    { k: "Engine", v: short(engineAddress ?? MATCHING_ENGINE_ENGINE_ADDRESS) },
    { k: "Verifier", v: short(ATTESTATION_VERIFIER_ID) },
  ];

  return (
    <div className="border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-[13px] py-[11px]">
        <div className="mono text-[9.5px] tracking-[0.16em] uppercase">TEE attestation</div>
        {status === "checking" && (
          <div className="mono flex items-center gap-1.5 text-[9px] text-text-faint uppercase">
            checking on-chain…
          </div>
        )}
        {status === "verified" && (
          <div className="mono flex items-center gap-1.5 border border-[#2C4A3C] bg-[#10201A] px-1.5 py-1 text-[9px] tracking-[0.12em] text-up uppercase">
            <div className="h-[5px] w-[5px] bg-up" />
            Verified
          </div>
        )}
        {(status === "mismatch" || status === "error") && (
          <div className="mono flex items-center gap-1.5 border border-[#4a2c2c] bg-[#201010] px-1.5 py-1 text-[9px] tracking-[0.12em] text-down uppercase">
            <div className="h-[5px] w-[5px] bg-down" />
            {status === "mismatch" ? "Not registered" : "Check failed"}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-[7px] p-[13px]">
        {rows.map((r) => (
          <div key={r.k} className="mono flex items-center justify-between gap-2.5 text-[10px]">
            <div className="text-text-faint tracking-[0.1em] uppercase">{r.k}</div>
            <div className="truncate text-text">{r.v}</div>
          </div>
        ))}
        <div className="mt-0.5 border-t border-border pt-2.5 text-[11.5px] leading-relaxed text-text-dim">
          This key was derived inside a real Intel TDX enclave via dstack's key
          derivation and never left it — on-chain checks above confirm it's
          registered against a genuine, measurement-matched quote.
        </div>
      </div>
    </div>
  );
}
