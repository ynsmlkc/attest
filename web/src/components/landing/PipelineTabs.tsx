// "How it works" interactive tabs -- three real steps in Attest's trust
// chain (sign -> verify -> settle). Visual structure (glass panel, circuit
// backdrop, per-step animated diagram) adapted from a richer reference
// mockup the user preferred over the original version of this component --
// but every stat shown is real: no fabricated hashes, gas estimates, or
// "verification passed" readouts. Where the reference mockup invented a
// number (a fake TDX quote hash, a fake gas estimate, fake locked-escrow
// balances, a "RUN SIMULATION" button that only played a canned animation),
// this version either drops it or replaces it with this project's actual
// deployed contract IDs (see lib/config.ts) -- same rule the rest of this
// app follows (e.g. AttestationsPanel dropping a fake "quote age" countdown).
import { useState } from "react";
import {
  ATTESTATION_VERIFIER_ID,
  MATCHING_ENGINE_ENCLAVE_ID,
  MATCHING_ENGINE_ENGINE_ADDRESS,
  REFLECTOR_ORACLE_ID,
  SETTLEMENT_VAULT_ID,
} from "../../lib/config";

function short(v: string, lead = 6, tail = 6) {
  return v.length > lead + tail + 1 ? `${v.slice(0, lead)}…${v.slice(-tail)}` : v;
}

type TabId = "sealed" | "verified" | "atomic";

const TABS: { id: TabId; label: string }[] = [
  { id: "sealed", label: "01 // SEALED" },
  { id: "verified", label: "02 // ATTESTATION" },
  { id: "atomic", label: "03 // SETTLEMENT" },
];

const COPY: Record<
  TabId,
  {
    badge: string;
    status: string;
    title: string;
    body: string;
    specs: [string, string][];
    console: [string, string][];
    subtext: string;
  }
> = {
  sealed: {
    badge: "Step 01 // Order ingress",
    status: "ENCLAVE: INGRESS SEALED",
    title: "Sealed until matched",
    body: "Both sides sign their order off-chain (SEP-0053). Neither order touches a public mempool -- only the matching engine running inside the enclave ever sees them, together.",
    specs: [
      ["SIGNING SPEC", "Ed25519 / SEP-0053"],
      ["MEMPOOL EXPOSURE", "Zero (non-visible)"],
      ["HARDWARE TARGET", "Intel TDX, via dstack"],
      ["ISOLATION ENGINE", "In-enclave order book"],
    ],
    console: [
      ["ENGINE ADDRESS", short(MATCHING_ENGINE_ENGINE_ADDRESS)],
      ["KEY ORIGIN", "Derived inside the enclave, never exported"],
    ],
    subtext: "Hardware secure enclave · encrypted in-memory matching",
  },
  verified: {
    badge: "Step 02 // Quote attestation",
    status: "HARDWARE: QUOTE VERIFIED",
    title: "Verified on-chain, not claimed",
    body: "AttestationVerifier re-derives the enclave's measurement from a real Intel-signed TDX quote and checks it directly in Soroban -- the exact check SDF's own dark-pool prototype left undone.",
    specs: [
      ["QUOTE", "Intel TDX v4 (DCAP)"],
      ["SIGNATURE CHECK", "secp256r1_verify, on-chain"],
      ["MEASUREMENTS", "MRTD + RTMR3"],
      ["ENCLAVE ID", short(MATCHING_ENGINE_ENCLAVE_ID)],
    ],
    console: [
      ["VERIFIER CONTRACT", short(ATTESTATION_VERIFIER_ID)],
      ["CHECK RUN BY", "register_verified_enclave (Soroban)"],
    ],
    subtext: "Cryptographic attestation · trust domain verification",
  },
  atomic: {
    badge: "Step 03 // Atomic settlement",
    status: "SOROBAN: ATOMIC COMMIT",
    title: "Settled atomically, or not at all",
    body: "SettlementVault swaps both parties' balances in one Soroban transaction -- gated on that verified enclave and a live Reflector price-deviation guard.",
    specs: [
      ["SIGNING", "Soroban auth envelope"],
      ["TX SHAPE", "Single atomic call"],
      ["PRICE GUARD", "Reflector oracle"],
      ["FAILURE MODE", "Whole swap reverts"],
    ],
    console: [
      ["VAULT CONTRACT", short(SETTLEMENT_VAULT_ID)],
      ["ORACLE", short(REFLECTOR_ORACLE_ID)],
    ],
    subtext: "Every fill settles atomically · all-or-nothing",
  },
};

export function PipelineTabs() {
  const [active, setActive] = useState<TabId>("sealed");
  const copy = COPY[active];

  return (
    <section className="flex min-h-screen flex-col justify-center border-t border-white/10 bg-[#0a0f0c] px-4 py-16 text-white sm:px-8 md:px-12">
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="mono flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] p-1.5 text-[11px]">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 font-semibold tracking-[0.06em] transition-all duration-300 ${
                  active === t.id
                    ? "bg-gradient-to-r from-amber to-amber-hi text-[#0a0b0d] shadow-[0_0_20px_rgba(223,169,79,0.45)]"
                    : "text-white/40 hover:bg-white/[0.05] hover:text-white/70"
                }`}
              >
                <span className={`h-[5px] w-[5px] rounded-full ${active === t.id ? "bg-black/60 pulse" : "bg-white/20"}`} />
                {t.label}
              </button>
            ))}
          </div>
          <div className="mono flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[10px]">
            <span className="relative flex h-2 w-2">
              <span className="pipe-ping absolute inline-flex h-full w-full rounded-full bg-amber opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
            </span>
            <span className="tracking-[0.18em] text-amber-hi uppercase">{copy.status}</span>
            <span className="text-white/15">|</span>
            <span className="text-white/40">INTEL TDX V4</span>
          </div>
        </div>

        <div className="pipe-glass relative overflow-hidden rounded-[20px] p-6 sm:p-9 lg:p-10">
          <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent" />
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12 lg:gap-10">
            <div className="flex flex-col justify-between gap-5 lg:col-span-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="mono inline-block rounded-md border border-amber/30 bg-white/[0.03] px-3 py-1 text-[10.5px] tracking-[0.08em] text-amber-hi">
                    {copy.badge}
                  </span>
                  <span className="mono flex items-center gap-1 text-[9.5px] tracking-wider text-white/40 uppercase">
                    <span className="h-1.5 w-1.5 rounded-full bg-up" />
                    Hardware provable
                  </span>
                </div>
                <h3 className="font-display text-[clamp(1.8rem,4vw,2.4rem)] leading-[1.1] font-normal tracking-[-0.01em] text-white/95">
                  {copy.title}
                </h3>
                <p className="text-[13.5px] leading-relaxed font-light text-white/55">{copy.body}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {copy.specs.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                      <div className="mono text-[9px] tracking-[0.1em] text-white/35 uppercase">{label}</div>
                      <div className="mono mt-0.5 text-[11.5px] font-medium text-white/85">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-white/[0.08] pt-4">
                <div className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.1em] text-white/35 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                  Real deployed contracts, this step
                </div>
                <div className="mono space-y-1.5 rounded-lg border border-white/[0.08] bg-black/30 p-3 text-[10.5px]">
                  {copy.console.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3">
                      <span className="text-white/40">{label}</span>
                      <span className="text-up">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative flex h-[360px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 pipe-grid sm:h-[420px] lg:col-span-7">
              <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-[#0a0f0c] via-transparent to-[#0a0f0c]/70" />
              {active === "sealed" && <SealedVisual />}
              {active === "verified" && <VerifiedVisual />}
              {active === "atomic" && <AtomicVisual />}
              <div className="pointer-events-none absolute bottom-3 z-20 w-full text-center">
                <span className="mono rounded-full border border-white/10 bg-[#0a0f0c]/80 px-3 py-1 text-[9.5px] tracking-[0.14em] text-white/40 uppercase">
                  {copy.subtext}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-6 sm:gap-10">
          {(
            [
              ["bg-up", "Zero mempool leakage"],
              ["bg-amber", "Hardware-provable integrity"],
              ["bg-[#7bc8e0]", "Atomic settlement"],
            ] as const
          ).map(([dot, label]) => (
            <div key={label} className="mono flex items-center gap-2 text-[10.5px] text-white/40">
              <span className={`h-1.5 w-1.5 rounded-full ${dot} pipe-dot-glow`} />
              <span className="text-white/60 uppercase tracking-[0.04em]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Step 1 -- two off-chain signed orders (party A / party B) converging on
// the enclave. Purely structural/illustrative (no invented numbers).
function SealedVisual() {
  const left = "M 40 110 C 180 110, 240 165, 280 250";
  const right = "M 560 110 C 420 110, 360 165, 320 250";
  return (
    <svg className="relative z-0 h-full w-full" viewBox="0 0 600 340">
      <path d={left} fill="none" stroke="#dfa94f" strokeOpacity="0.35" strokeWidth="30" strokeLinecap="round" />
      <path d={right} fill="none" stroke="#4fb286" strokeOpacity="0.35" strokeWidth="30" strokeLinecap="round" />
      <path d={left} fill="none" stroke="#dfa94f" strokeOpacity="0.8" strokeWidth="2" className="pipe-photon-a" />
      <path d={right} fill="none" stroke="#4fb286" strokeOpacity="0.8" strokeWidth="2" className="pipe-photon-b" />
      <g transform="translate(45, 108)">
        <circle r="26" fill="#0d1512" stroke="#dfa94f" strokeWidth="1.5" />
        <text y="-4" textAnchor="middle" fill="#f0c77e" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">PARTY A</text>
        <text y="9" textAnchor="middle" fill="#a08e7a" fontSize="7.5" fontFamily="var(--font-mono)">SIGNED ORDER</text>
      </g>
      <g transform="translate(555, 108)">
        <circle r="26" fill="#0d1512" stroke="#4fb286" strokeWidth="1.5" />
        <text y="-4" textAnchor="middle" fill="#8fe0bf" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">PARTY B</text>
        <text y="9" textAnchor="middle" fill="#a08e7a" fontSize="7.5" fontFamily="var(--font-mono)">SIGNED ORDER</text>
      </g>
      <g transform="translate(300, 270)">
        <ellipse rx="90" ry="40" fill="none" stroke="#dfa94f" strokeOpacity="0.3" strokeDasharray="6 5" className="pipe-spin" />
        <circle r="40" fill="#0d1512" stroke="#dfa94f" strokeWidth="2" className="pipe-glow-ring" />
        <text y="-2" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="var(--font-mono)" fontWeight="700">TEE</text>
        <text y="12" textAnchor="middle" fill="#dfa94f" fontSize="7.5" fontFamily="var(--font-mono)">MATCHING</text>
      </g>
    </svg>
  );
}

// Step 2 -- orbiting MRTD/RTMR3 measurement registers around the on-chain
// verifier core. Labels name real fields this project actually checks
// (see contracts/attestation-verifier); no fabricated pass/fail readouts.
function VerifiedVisual() {
  return (
    <svg className="relative z-0 h-full w-full" viewBox="0 0 600 340">
      <g stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" fill="none">
        <circle cx="300" cy="170" r="55" />
        <circle cx="300" cy="170" r="110" />
        <circle cx="300" cy="170" r="150" strokeDasharray="3 6" />
      </g>
      <g transform="translate(300, 170)" className="pipe-spin">
        <circle r="110" fill="none" stroke="#4fb286" strokeOpacity="0.5" strokeDasharray="12 10" />
        <g transform="translate(110, 0)">
          <circle r="12" fill="#0d1512" stroke="#4fb286" strokeWidth="1.5" />
          <circle r="4" fill="#4fb286" />
          <text x="18" y="4" fill="#8fe0bf" fontSize="9" fontFamily="var(--font-mono)" fontWeight="600">MRTD</text>
        </g>
        <g transform="translate(-110, 0)">
          <circle r="12" fill="#0d1512" stroke="#7bc8e0" strokeWidth="1.5" />
          <circle r="4" fill="#7bc8e0" />
          <text x="-18" y="4" textAnchor="end" fill="#a9dcee" fontSize="9" fontFamily="var(--font-mono)" fontWeight="600">RTMR3</text>
        </g>
      </g>
      <g transform="translate(300, 170)" className="pipe-spin-rev">
        <circle r="68" fill="none" stroke="#dfa94f" strokeOpacity="0.4" strokeDasharray="7 7" />
        <g transform="translate(0, 68)">
          <circle r="10" fill="#0d1512" stroke="#dfa94f" strokeWidth="1.5" />
          <circle r="3.5" fill="#f0c77e" />
          <text y="20" textAnchor="middle" fill="#f0c77e" fontSize="8" fontFamily="var(--font-mono)" fontWeight="600">QUOTE V4</text>
        </g>
      </g>
      <g transform="translate(300, 170)">
        <circle r="34" fill="#0d1512" stroke="#4fb286" strokeWidth="2" className="pipe-glow-ring" />
        <text y="-3" textAnchor="middle" fill="#fff" fontSize="9.5" fontFamily="var(--font-mono)" fontWeight="700">SOROBAN</text>
        <text y="10" textAnchor="middle" fill="#4fb286" fontSize="8" fontFamily="var(--font-mono)">secp256r1</text>
      </g>
    </svg>
  );
}

// Step 3 -- two vaults (the traded assets), an atomic swap gate in the
// middle. No invented "locked escrow" amounts -- the real balances are
// whatever's actually in each vault (see the Trade page's Balances card).
function AtomicVisual() {
  return (
    <svg className="relative z-0 h-full w-full" viewBox="0 0 600 340">
      <path
        d="M 130 130 C 220 130, 240 90, 300 90 C 360 90, 380 130, 470 130"
        fill="none"
        stroke="#dfa94f"
        strokeOpacity="0.7"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="pipe-photon-a"
      />
      <path
        d="M 470 220 C 380 220, 360 260, 300 260 C 240 260, 220 220, 130 220"
        fill="none"
        stroke="#7bc8e0"
        strokeOpacity="0.7"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="pipe-photon-b"
      />
      <g transform="translate(100, 175)">
        <rect x="-46" y="-65" width="92" height="130" rx="10" fill="#0d1512" stroke="#dfa94f" strokeWidth="1.5" />
        <text y="-45" textAnchor="middle" fill="#f0c77e" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">VAULT · XLM</text>
        <circle r="17" fill="#161f1b" stroke="#f0c77e" strokeWidth="1.2" />
        <text y="4" textAnchor="middle" fill="#fff" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">XLM</text>
        <text y="48" textAnchor="middle" fill="#80868e" fontSize="7.5" fontFamily="var(--font-mono)">REAL VAULT BALANCE</text>
      </g>
      <g transform="translate(500, 175)">
        <rect x="-46" y="-65" width="92" height="130" rx="10" fill="#0d1512" stroke="#7bc8e0" strokeWidth="1.5" />
        <text y="-45" textAnchor="middle" fill="#a9dcee" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">VAULT · USDC</text>
        <circle r="17" fill="#161f1b" stroke="#a9dcee" strokeWidth="1.2" />
        <text y="4" textAnchor="middle" fill="#fff" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">USDC</text>
        <text y="48" textAnchor="middle" fill="#80868e" fontSize="7.5" fontFamily="var(--font-mono)">REAL VAULT BALANCE</text>
      </g>
      <g transform="translate(300, 175)">
        <polygon
          points="0,-48 42,-24 42,24 0,48 -42,24 -42,-24"
          fill="#0d1512"
          stroke="#4fb286"
          strokeWidth="2"
          className="pipe-glow-ring"
        />
        <text y="-3" textAnchor="middle" fill="#fff" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">ATOMIC</text>
        <text y="10" textAnchor="middle" fill="#4fb286" fontSize="8.5" fontFamily="var(--font-mono)" fontWeight="700">SWAP</text>
        <g transform="translate(0, -70)">
          <rect x="-58" y="-11" width="116" height="22" rx="4" fill="#161f1b" stroke="#dfa94f" strokeWidth="1.2" />
          <text y="4" textAnchor="middle" fill="#f0c77e" fontSize="7.5" fontFamily="var(--font-mono)" fontWeight="600">REFLECTOR ORACLE GUARD</text>
        </g>
        <g transform="translate(0, 70)">
          <rect x="-62" y="-11" width="124" height="22" rx="4" fill="#161f1b" stroke="#4fb286" strokeWidth="1.2" />
          <text y="4" textAnchor="middle" fill="#8fe0bf" fontSize="7.5" fontFamily="var(--font-mono)" fontWeight="600">SOROBAN 1-TX COMMIT</text>
        </g>
      </g>
    </svg>
  );
}
