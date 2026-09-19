// Marketing landing page, structured after GTE's DESIGN.md ("Trading
// terminal behind gallery lighting"): full-bleed dark hero with a large
// thin-serif headline -> light editorial feature grid -> dark CTA band.
// Only this page borrows GTE's light-surface section; the terminal itself
// (App.tsx and everything under components/terminal) stays fully dark.

import { useState } from "react";
import { BentoFeatures } from "./BentoFeatures";
import { PipelineTabs } from "./PipelineTabs";
import { TeeChip } from "./TeeChip";
import { REPO_URL } from "../../lib/config";

interface Props {
  onLaunch: () => void;
}

const PROOF_POINTS: [string, string][] = [
  ["Intel TDX", "Real hardware attestation"],
  ["Soroban", "Verified on-chain, live testnet"],
  ["SEP-53", "Client-signed orders"],
  ["Reflector", "Live price-deviation guard"],
];

// Hero background: the reference mockup's actual image, downloaded once
// and served from our own /public (not hotlinked — a third-party preview
// CDN URL isn't something to depend on in shipped code) so this renders
// identically and reliably every time.
function HeroVisual() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <img
        src="/hero-bg.png"
        alt=""
        className="h-full w-full object-cover object-center brightness-[0.98] contrast-[1.02]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60 opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50 opacity-60" />
      <div
        className="absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-[calc(50%+24px)] blur-[50px]"
        style={{
          background:
            "radial-gradient(circle, rgba(255,140,50,0.12) 0%, rgba(20,90,160,0.15) 50%, rgba(0,0,0,0) 75%)",
        }}
      />
    </div>
  );
}

// Matches --duration below: the terminal fades/scales in over 480ms
// (see .app-enter in index.css), so this holds just long enough that the
// two overlap into a single continuous motion instead of a hard cut.
const LEAVE_DURATION = 420;

export function Landing({ onLaunch }: Props) {
  const [leaving, setLeaving] = useState(false);

  function handleLaunch() {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onLaunch, LEAVE_DURATION);
  }

  return (
    <div
      className={`h-screen overflow-x-hidden bg-white text-[#18181b] transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(.4,0,.2,1)] ${
        leaving ? "pointer-events-none overflow-hidden opacity-0 [transform:scale(0.98)]" : "overflow-y-auto opacity-100"
      }`}
    >
      {/* HERO — dark dramatic opener */}
      <section className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0f0c] text-white">
        <HeroVisual />
        <nav className="relative z-10 flex items-center justify-between px-6 py-7 sm:px-10">
          <div className="flex items-center gap-1.5">
            <img src="/logo-badge.svg" alt="Attest" className="h-16 w-auto object-contain md:h-28" />
          </div>
          <div className="mono absolute left-1/2 hidden -translate-x-1/2 items-center text-[11px] font-medium tracking-[0.24em] text-white/90 uppercase sm:flex">
            <span>Sealed</span>
            <span className="mx-2.5 text-xs font-bold tracking-normal text-[#4ade80]/90">›››</span>
            <span>Verified</span>
            <span className="mx-2.5 text-xs font-bold tracking-normal text-[#4ade80]/90">›››</span>
            <span>Atomic</span>
          </div>
          <button
            onClick={handleLaunch}
            className="btn-orange flex items-center rounded-[6px] border border-[#ff7b2b] py-1.5 pr-2 pl-3.5 text-[13px] shadow-md shadow-[#ff6813]/25 active:scale-[0.98]"
          >
            <span className="mr-2.5 font-bold tracking-tight select-none">Launch App</span>
            <span aria-hidden className="flex select-none items-center gap-1.5 border-l border-black/20 pl-2">
              <span className="flex flex-col gap-[2px]">
                <span className="block h-[3px] w-[3px] rounded-full bg-black" />
                <span className="block h-[3px] w-[3px] rounded-full bg-black" />
                <span className="block h-[3px] w-[3px] rounded-full bg-black" />
              </span>
              <span className="grid grid-cols-2 gap-[1.5px] p-[2px]">
                <span className="block h-[3px] w-[3px] bg-black" />
                <span className="block h-[3px] w-[3px] bg-transparent" />
                <span className="block h-[3px] w-[3px] bg-black" />
                <span className="block h-[3px] w-[3px] bg-black" />
              </span>
            </span>
          </button>
        </nav>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mono mb-7 rounded-full border border-[#ff6813]/40 px-3 py-1 text-[10px] tracking-[0.18em] text-[#ff8a4c] uppercase">
            Dark pool · TEE-verified settlement
          </div>
          <h1
            className="text-[clamp(2.4rem,7.5vw,5.5rem)] leading-[1.04] font-normal tracking-[-0.02em] text-[#f8f9fa]"
            style={{ fontFamily: "var(--font-hero-serif)" }}
          >
            <div>Trade sealed.</div>
            <div className="mt-1 flex items-center justify-center gap-3 md:gap-4">
              <span className="italic">Settle verified</span>
              <span aria-hidden className="inline-flex translate-y-0.5 items-center gap-[4px] md:gap-[6px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-9 w-[4px] rounded-[1px] bg-[#ff6813] shadow-sm sm:h-12 md:h-14 md:w-[6px] lg:h-16"
                    style={{ transform: "skewX(-22deg)" }}
                  />
                ))}
              </span>
            </div>
          </h1>
          <p className="mono mt-7 max-w-[540px] text-[13px] leading-relaxed text-white/55">
            No one sees your order until it's already matched — matched inside a real
            Intel TDX enclave, and checked on-chain, not just claimed.
          </p>
          <div className="mt-9 flex items-center gap-4">
            <button
              onClick={handleLaunch}
              className="btn-orange flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-semibold tracking-[0.06em] uppercase"
            >
              Launch app <span aria-hidden>→</span>
            </button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mono text-[11px] tracking-[0.1em] text-white/50 uppercase hover:text-[#ff8a4c]"
            >
              View source
            </a>
          </div>
        </div>

        <div className="relative z-10 mono flex flex-col items-center gap-2 pb-9 text-[9px] tracking-[0.22em] text-white/30 uppercase">
          Scroll
          <div className="landing-bounce h-2.5 w-2.5 border-r border-b border-white/30" />
        </div>
      </section>

      {/* PROOF STRIP */}
      <section className="border-b border-[#e5e7eb] bg-[#f7f7f7] px-6 py-7 sm:px-10">
        <div className="mx-auto flex max-w-[1100px] flex-wrap justify-between gap-6 text-center">
          {PROOF_POINTS.map(([k, v]) => (
            <div key={k} className="min-w-[140px] flex-1">
              <div className="mono text-[13px] font-semibold text-[#18181b]">{k}</div>
              <div className="mt-1 text-[11px] text-[#71717a]">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES — light bento grid */}
      <BentoFeatures />

      {/* HOW IT WORKS — interactive tabs, dark */}
      <PipelineTabs />

      {/* TEE SHOWCASE — draggable 3D chip, light close before CTA */}
      <section className="border-t border-[#e5e7eb] bg-[#f7f7f7] px-6 py-24 sm:px-10">
        <div className="mx-auto max-w-[1100px]">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
            <div>
              <span className="mono inline-block rounded-full bg-[#ff6813]/15 px-3 py-1 text-[10px] font-semibold text-[#e04606] uppercase">
                Get started
              </span>
              <h2 className="font-display mt-3 text-[clamp(1.8rem,5vw,3rem)] leading-[1.02] font-light tracking-[-0.01em] text-[#18181b]">
                Engineered for trust.
              </h2>
            </div>
            <a
              href={`${REPO_URL}/blob/main/README.md#security-review-2026-09-13-enclave-registration-hijack--found-and-closed`}
              target="_blank"
              rel="noreferrer"
              className="mono hidden flex-col items-center justify-center rounded-2xl border border-dashed border-[#c9c9c2] px-4 py-3 text-center text-[9px] text-[#71717a] uppercase hover:border-[#ff6813] hover:text-[#e04606] sm:flex"
            >
              <span className="tracking-widest">Security notes</span>
              <span className="mt-0.5 font-bold text-[#18181b]">self-reviewed</span>
            </a>
          </div>

          <div className="relative flex flex-col items-center overflow-hidden rounded-[24px] border border-[#18181b]/10 bg-[#0a0f0c] p-6 text-white sm:p-12">
            <div className="pointer-events-none absolute h-96 w-96 rounded-full bg-[#ff6813]/10 blur-[100px]" />
            <div className="mono relative z-10 mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-[#ff8a4c]">
              <span className="pulse">●</span>
              <span>Click &amp; drag to inspect the enclave</span>
            </div>
            <TeeChip />
            <div className="mono relative z-10 mt-4 grid w-full max-w-3xl grid-cols-2 gap-3 border-t border-white/10 pt-6 text-center sm:grid-cols-4">
              <ChipStat label="Enclave" value="Intel TDX v4" />
              <ChipStat label="Attestation" value="Soroban, on-chain" />
              <ChipStat label="Order signing" value="SEP-0053" />
              <ChipStat label="Price guard" value="Reflector, live" />
            </div>
            <button
              onClick={handleLaunch}
              className="btn-orange relative z-10 mt-8 rounded-xl px-8 py-3.5 text-sm font-bold tracking-[0.06em] uppercase"
            >
              Launch app →
            </button>
          </div>
        </div>
      </section>

      {/* CTA BAND — dark close */}
      <section className="bg-[#0a0f0c] px-6 py-24 text-center text-white sm:px-10">
        <h2 className="font-display text-[clamp(1.8rem,5vw,3rem)] font-light tracking-[-0.01em]">
          Ready to trade in the dark?
        </h2>
        <p className="mono mt-4 text-[12px] text-white/50">Testnet only — no real funds at risk yet.</p>
        <button
          onClick={handleLaunch}
          className="btn-orange mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-semibold tracking-[0.06em] uppercase"
        >
          Launch app <span aria-hidden>→</span>
        </button>
      </section>

      {/* FOOTER */}
      <footer className="flex flex-col items-center gap-2 bg-[#0a0f0c] px-6 pb-10 text-center sm:px-10">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="mono text-[10px] tracking-[0.1em] text-white/40 uppercase hover:text-[#ff8a4c]"
        >
          View on GitHub
        </a>
        <div className="mono text-[9px] tracking-[0.1em] text-white/25 uppercase">Attest · Stellar testnet</div>
      </footer>
    </div>
  );
}

function ChipStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.1em] text-white/40 uppercase">{label}</div>
      <div className="mt-1 text-[11px] font-semibold text-white">{value}</div>
    </div>
  );
}
