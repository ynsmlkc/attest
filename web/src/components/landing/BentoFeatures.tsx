// Bento-grid feature section — layout adapted from a reference mockup,
// copy is Attest's own and only states things proven live (see README).
export function BentoFeatures() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-24 sm:px-10">
      <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="mono text-[10px] tracking-[0.18em] text-[#e04606] uppercase">Architecture</span>
          <h2 className="font-display mt-2 text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] font-light tracking-[-0.01em] text-[#18181b]">
            Three real, on-chain checks — not a trust-me claim.
          </h2>
        </div>
        <p className="max-w-[340px] text-[13px] leading-relaxed text-[#71717a]">
          Built to prove that the exact gap SDF's own dark-pool research flagged as missing can actually be closed
          on Soroban — not just described in a paper.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        {/* Large card */}
        <article className="rounded-[20px] bg-[#ebebeb] p-8 sm:p-10 md:col-span-8">
          <h3 className="font-display max-w-md text-[26px] leading-tight font-light text-[#18181b] sm:text-[30px]">
            Nothing leaks until it matches.
          </h3>
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-[#71717a]">
            Orders are signed off-chain (SEP-0053) and matched inside a real Intel TDX enclave — no mempool, no
            front-running, no one watching the book.
          </p>
          <div className="mono mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[#d8d8d2] pt-6 text-[11px] text-[#71717a]">
            <div className="flex items-center gap-3">
              <span className="rounded border border-[#c9c9c2] bg-white px-2.5 py-1 font-bold text-[#18181b]">TEE MATCHED</span>
              <span className="text-[#9a9a92]">SEALED ORDER BOOK</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#ff6813]" />
              <span className="font-semibold tracking-wider text-[#18181b] uppercase">Intel TDX v4 · dstack</span>
            </div>
          </div>
        </article>

        {/* Verified badge card */}
        <article className="flex flex-col justify-between rounded-[20px] bg-[#ebebeb] p-8 md:col-span-4">
          <div>
            <h3 className="font-display text-[22px] leading-tight font-light text-[#18181b]">
              Verified on-chain, not claimed.
            </h3>
            <p className="mt-3 text-[13px] leading-relaxed text-[#71717a]">
              AttestationVerifier re-checks the quote itself, in Soroban, every time.
            </p>
          </div>
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-[#d8d8d2] bg-white/60 p-6">
            <div className="font-display text-[28px] font-normal tracking-[-0.01em] text-[#18181b]">Attest</div>
            <div className="mono mt-1 text-[9px] tracking-[0.16em] text-[#9a9a92] uppercase">On-chain Verifier</div>
          </div>
        </article>

        {/* Atomic settlement */}
        <article className="rounded-[20px] bg-[#ebebeb] p-8 md:col-span-4">
          <h3 className="font-display text-[22px] leading-tight font-light text-[#18181b]">Atomic, or not at all</h3>
          <p className="mt-3 text-[13px] leading-relaxed text-[#71717a]">
            Every fill — whole or partial — swaps both sides in one Soroban transaction, or doesn't happen at all.
          </p>
          <div className="mt-6 flex items-center gap-3">
            <svg className="h-9 w-9 text-[#18181b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
            <span className="mono text-xs font-semibold text-[#4a4a44]">Single atomic swap</span>
          </div>
        </article>

        {/* Non-custodial */}
        <article className="rounded-[20px] bg-[#ebebeb] p-8 md:col-span-4">
          <h3 className="font-display text-[22px] leading-tight font-light text-[#18181b]">Non-custodial</h3>
          <p className="mt-3 text-[13px] leading-relaxed text-[#71717a]">
            Depositors can always withdraw their own balance — no counterparty required.
          </p>
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[#d8d8d2] bg-white/60 p-4">
            <svg className="h-7 w-7 text-[#18181b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
            <span className="mono text-xs font-medium text-[#4a4a44]">Self-custody, always</span>
          </div>
        </article>

        {/* Price guard */}
        <article className="rounded-[20px] bg-[#ebebeb] p-8 md:col-span-4">
          <h3 className="font-display text-[22px] leading-tight font-light text-[#18181b]">Price-guarded</h3>
          <p className="mt-3 text-[13px] leading-relaxed text-[#71717a]">
            A live Reflector oracle check rejects trades that stray too far from reference price.
          </p>
          <div className="mono mt-6 flex items-center justify-between border-t border-[#d8d8d2] pt-4">
            <div className="text-xs font-bold tracking-wider text-[#4a4a44] uppercase">Guard</div>
            <div className="rounded-md bg-[#18181b] px-2.5 py-1 text-xs text-white">Reflector, live</div>
          </div>
        </article>
      </div>
    </section>
  );
}
