# Positioning: why Attest, and against what

## The source

Attest's entire premise comes from one specific SDF blog post:
[Building a Dark Pool on Stellar: MPC, FHE, and TEEs Compared](https://stellar.org/blog/developers/building-a-dark-pool-on-stellar-mpc-fhe-and-tees-compared),
authored by **Yan Michalevsky** — PhD in applied security/privacy from
Stanford, co-founder and CTO of **Anjuna Security** (a real secure-enclave
company), and a listed speaker at Black Hat Europe on TEE-adjacent
research. This is not a random ecosystem post; it's written by someone
whose day job is TEEs.

The post compares FHE (204 min for a 10x10 matching round — impractical),
MPC (scales badly past ~100 participants), and TEE (chosen — native
performance) as approaches to a Stellar dark pool, and ends with this
exact sentence:

> "The remaining work is engineering, not research: **hardening the
> attestation verification (including contract-level quote
> verification)**, completing OS kernel verification against
> reproducible builds, and stress-testing at scale."

Attest builds exactly the bolded gap: on-chain, contract-level
verification that an attestation quote is genuine — not just "a TEE
exists somewhere," but "this exact registered enclave, running this
exact code, is the one authorizing this settlement."

## The reference implementation is public — and confirms the gap is real

The blog post links three repos under the same author
(`ymcrcat` on GitHub): `dark-pool-mpc`, `dark-pool-fhe`, and
**`stellar-dark-pool`** (the TEE version — the one the post recommends).
Found and reviewed live on 2026-09-11/12:

- Created 2025-12-26, last pushed 2026-01-21 — an 8-month-dormant working
  prototype, 0 stars. Confirmed via GitHub API (`created_at`/`pushed_at`),
  not assumed from the repo's UI.
- Architecture matches ours closely: Soroban settlement/vault contract +
  off-chain Python matching engine + planned Phala Cloud / Intel TDX
  deployment. Its `docs/TEE.md` independently identifies **RTMR3** as the
  register that carries "the compose-hash" (application-specific
  measurement) — the same conclusion Attest reached empirically by
  deploying two different apps on the same dstack build and finding
  identical MRTD but different RTMR3 (see repo root `README.md`). Two
  independent paths to the same finding is a good sign the finding is
  real, not an artifact of our specific setup.
- Its own docs use conditional language throughout — "ideally running in
  a TEE," "planned TEE attestation" — and `docs/TEE.md` states explicitly:
  **"No on-chain verifier contract is mentioned... Verification happens
  before trusting the HTTPS connection, not post-deployment on-chain."**
  Its `settle_trade()` is gated by `set_matching_engine()` — a plain
  admin-set address, not an attestation check. This is the reference
  prototype for the paper that named this exact gap, and it still hasn't
  closed it, seven-plus months after the post that named it.

**What Attest did instead, live and proven (see root `README.md` for full
detail with tx hashes/addresses):** deployed a real Intel TDX CVM on
Phala Cloud, extracted its genuine attestation quote, verified it
on-chain against `AttestationVerifier` (real `secp256r1_verify`, real
measurement match — both MRTD and RTMR3), and gated `SettlementVault`'s
`settle()` on that verified enclave's own registered key — a key
generated inside, and never extracted from, that enclave
(`services/matching-engine`). Not "planned." Deployed, registered, and
exercised with real settlement transactions.

## What their prototype does better — worth adopting

- **SEP-0053 order signing.** Their client signs each order with the
  trader's Stellar keypair before submitting it off-chain; the matching
  engine verifies that signature. Attest's `services/matching-engine`
  currently has no equivalent — anyone who knows a depositor's public
  address (visible on-chain from their `deposit()` call anyway) can
  submit an order *claiming* to be that depositor, and the engine has no
  way to tell. This is a real gap worth closing, independent of the
  competitive angle.
- Price-time priority matching with partial fills — more complete than
  Attest's current exact-pair-only matching (a deliberate scope cut, see
  root README, but genuinely less capable as a matcher).

## Other dark-pool-adjacent SCF activity (context, not direct competitors)

Scanned SCF #45 in full (218 submissions) plus general search — three
more dark-pool-flavored projects found, none of them TEE-based and none
of them SCF-funded for this angle:

- **Sub Rosa** (SCF #44 & #45, both Panel Review Failed) — general-purpose
  sealed-bid infrastructure via Drand/tlock timelock encryption, not TEE,
  not continuous matching.
- **PNLX** (SCF #45, Community Vote) — confidential perpetual DEX via
  threshold encryption + RISC Zero zkVM, not TEE. Live testnet, real
  trade evidence, but a fundamentally different (and per the SDF post's
  own FHE/MPC benchmarks, likely slower) technical approach.
- **DuskPool** — "Privacy-Preserving Dark Pool for RWAs," SCF #41, **not
  awarded** ($94.8K requested). Unrelated team to `ymcrcat`. No further
  detail surfaced beyond the rejection.

## The pitch this supports

"SDF's own research — written by the co-founder of a real TEE security
company — named contract-level attestation verification as the one
piece separating their TEE dark pool prototype from production. Seven
months later, their own reference implementation still hasn't built it.
We did, live, on testnet, with a matching engine that runs inside the
attested enclave itself rather than trusting an external key."
