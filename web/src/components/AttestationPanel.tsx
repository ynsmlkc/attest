import { useEffect, useState } from "react";
import { getEngineAddress, isEnclaveRegistered } from "../lib/contracts";
import {
  ATTESTATION_VERIFIER_ID,
  MATCHING_ENGINE_ENCLAVE_ID,
  MATCHING_ENGINE_ENGINE_ADDRESS,
} from "../lib/config";

type Status = "checking" | "verified" | "mismatch" | "error";

function short(addr: string, lead = 6, tail = 6) {
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function AttestationPanel() {
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

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">TEE Attestation</h2>
        {status === "checking" && (
          <span className="flex items-center gap-1.5 text-xs text-text-dim">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-text-faint" />
            checking on-chain…
          </span>
        )}
        {status === "verified" && (
          <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Verified
          </span>
        )}
        {(status === "mismatch" || status === "error") && (
          <span className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            {status === "mismatch" ? "Not registered" : "Check failed"}
          </span>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        <Row label="Matching engine" value="Real Intel TDX CVM (Phala Cloud)" mono={false} />
        <Row label="Enclave ID" value={short(MATCHING_ENGINE_ENCLAVE_ID, 8, 6)} />
        <Row
          label="Engine address"
          value={engineAddress ? short(engineAddress) : short(MATCHING_ENGINE_ENGINE_ADDRESS)}
        />
        <Row label="Verifier contract" value={short(ATTESTATION_VERIFIER_ID)} />
      </dl>

      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-text-faint">
        This key was derived inside the enclave via dstack's key derivation and never left it.
        On-chain checks confirm it's registered against a genuine, measurement-matched TDX
        quote — not an externally-held key a human controls.
      </p>
    </div>
  );
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-text-dim">{label}</dt>
      <dd className={mono ? "mono-nums text-text" : "text-right text-text"}>{value}</dd>
    </div>
  );
}
