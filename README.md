# Attest

On-chain TEE attestation verification for Soroban — the piece SDF's own
dark pool research prototype flagged as missing. Full background:
`stellaridea2.md` (idea folder) and `attest-hackathon-plan.md`.

## Status

**SettlementVault milestone complete** (see `attest-hackathon-plan.md` §3).

### `contracts/attestation-verifier`

Deployed and tested on testnet: `CCYHD7JCOC4NAKMZLWRHDIWUNABKY4EVWXB55BIJ5AJO7R7MECB4OOO3`
(redeployed from the earlier `CDIDFYVVTEKQSXTQ5H26I47JYIQMUQBIVDLMRXMBYXIT752CJWRRU2NY`
to add `engine_address` — see below).

- `initialize`, `verify_quote`, `register_verified_enclave`,
  `is_registered`, `get_engine_address` all implemented. `verify_quote` and
  `register_verified_enclave` are proven — live, on testnet, not just in
  unit tests — against a real, Intel-signed TDX v4 attestation quote
  (Automata's public test vector):
  - the real quote's signature verifies via Soroban's native
    `secp256r1_verify` (CAP-0051) — the correct primitive, confirmed
    against Intel's public DCAP docs (ECDSA over NIST P-256)
  - the measurement compared against is extracted directly from the raw
    signed payload (offset 184, 48 bytes — TDX's MRTD register is
    SHA-384-sized, not 32 as an earlier draft assumed), not trusted from a
    separate caller-supplied field
  - a tampered payload or wrong measurement is genuinely rejected, checked
    live on testnet
  - `register_verified_enclave` runs the same check internally before
    writing storage — it can no longer be called with unverified data
  - along the way: Intel's raw quote signature was in ECDSA high-s form;
    Soroban's `secp256r1_verify` requires low-s (anti-malleability, same
    convention as Bitcoin/Ethereum). Whoever relays a quote on-chain needs
    to normalize `s` first — see `test.rs` doc comment.
- `VerifiedEnclave` now also stores `engine_address` — the wallet an
  enclave's operator will sign settlement transactions with, set (and
  auth-required) at registration time. This is what lets `SettlementVault`
  know *which caller* to trust for a given verified enclave, not just
  *whether* it's verified.

### `contracts/settlement-vault`

Deployed and tested on testnet: `CC6FG2ZOVBZCKNMFK3DOXWIBHDU5UCNGBQTPO4CVGWOUSQN65YHZ55U3`.

- `deposit` / `withdraw`: real SEP-41 token transfers into/out of the
  vault, credited to a per-(token, owner) internal balance.
- `settle`: the core of the project. Settles a matched trade a TEE computed
  off-chain — `party_a` gives `amount_a` of `token_a`, `party_b` gives
  `amount_b` of `token_b` — by atomically swapping their internal balances.
  Gated on `AttestationVerifier::is_registered(enclave_id)` AND the caller
  matching that enclave's `get_engine_address` — exactly the on-chain check
  SDF's own dark pool prototype left undone. Cross-contract calls the
  *live, separately deployed* AttestationVerifier via a locally-declared
  thin client interface (not a direct crate dependency — see
  `types.rs`/`Cargo.toml`: depending on another `#[contract]` crate
  directly pulls its WASM exports into your own binary and collides on
  shared names like `initialize`).
  - `max_deviation_bps` (set at `initialize`) is a second, independent
    guard: `settle` compares the notional value each side gives
    (`amount × Reflector reference price`) and rejects trades that deviate
    too far, even from a *genuinely verified* engine — defense in depth if
    an engine's signing key is ever compromised. Configured against
    Reflector's real testnet "Stellar Mainnet DEX" oracle:
    `CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP` (verified
    against Stellar's own oracle-providers docs, not assumed from memory).
    Degrades gracefully (skips the check) if the oracle has no price for
    either asset, since attestation — not the price check — is the primary
    trust anchor.
- **Proven live on testnet, both directions:** deposited 1000 of a demo
  token from one party and 2000 of another from a second party, called
  `settle` as the registered engine — balances swapped atomically and
  exactly as expected. Then called `settle` again with a never-registered
  `enclave_id` — rejected with `Error::EnclaveNotRegistered`, confirmed via
  the live diagnostic event log showing the real cross-contract call to
  `is_registered` returning `false`. `contracts/demo-token` is a minimal
  SEP-41-shaped fixture used only for this live proof — not a project
  deliverable.
- 7 unit tests cover deposit/withdraw, the happy-path settle, both
  attestation-gate rejections (unregistered enclave, wrong engine), and
  both price-deviation cases (within tolerance / rejected) against a mock
  oracle.

### Real TEE deployment (Phala Cloud)

A genuine TDX CVM was deployed on Phala Cloud (`deploy/tee-demo/docker-compose.yml`
— a minimal container just to pull a quote, not part of the matching-engine
design), and its **freshly-generated, live** attestation quote (fetched via
`phala cvms attestation`, not a pre-published test vector) was extracted and
verified on a new AttestationVerifier instance on testnet:
`CDBTUHUDMI47UO7MUPAY5JYQ7HM33F7KWXHBOXVQUNRMAA3D3IO3PO7P`.

- App ID `d6d2d13f967de5f068ca2f8c14e96bc1511cafc5`, dstack `dstack-dev-0.5.9`.
- The MRTD this project's own byte-offset logic extracts from the raw quote
  payload (offset 184, 48 bytes) matched Phala's own independently-reported
  `tcb_info.mrtd` exactly — cross-validating that the offset math isn't a
  coincidence specific to Automata's earlier test vector; it holds for a
  second, differently-generated real TDX quote too.
- This quote's signature was also high-s and needed the same low-s
  normalization as before — confirms that's a general TDX/DCAP property,
  not an artifact of one specific test vector.
- `register_verified_enclave` (with `engine_address` set to the `attest-dev`
  testnet account) and `is_registered` were both confirmed live, on-chain,
  against this real quote.

### End-to-end: real TEE → SettlementVault

A second SettlementVault instance, `CARXF7RTX5Z47642DYZNAFRKJ3VDGHY6R36ZLMSERVQA2P57N2JIMCSN`,
is initialized against the **real-TEE-verified** AttestationVerifier
(`CDBTUHUDMI47UO7MUPAY5JYQ7HM33F7KWXHBOXVQUNRMAA3D3IO3PO7P`) — not the
Automata-test-vector one. Proven live: deposited 500/750 of the two demo
tokens from two parties, settled with `engine`/`enclave_id` from the real
Phala CVM's registration, balances swapped exactly as expected. This didn't
require the CVM to be running again — the quote was already verified and
permanently recorded on-chain when it was registered, so `settle`'s
cross-contract `is_registered`/`get_engine_address` checks read that stored
state, not anything live from the TEE itself. The demo CVM stayed `stopped`
throughout (confirmed via `phala cvms get`) — no ongoing Phala Cloud cost.

### Anchor integration: TR Mock Anchor via SEP-6

Superseded the earlier BlindPay/SEP-24 plan (BlindPay doesn't support TRY)
with `tr-mock-anchor.fly.dev` — a sandbox anchor purpose-built for a
TRY↔USDC on/off-ramp, confirmed via its own `stellar.toml`
(`TRANSFER_SERVER` present, no `TRANSFER_SERVER_SEP0024`) to expose SEP-6
but not SEP-24. Its bank leg is simulated ("Nothing here is a real
financial service") but the Stellar leg pays genuine testnet USDC.

`scripts/sep6_onramp_demo.py` runs the real flow end-to-end — SEP-10 auth,
SEP-6 `/deposit`, the anchor's own SEP-6-scoped bank-transfer simulator
(`POST /sep6/tx/{id}/simulate-bank-transfer` — the one non-SEP call in the
whole flow, since SEP-6 has no operation for "a real bank received a real
wire transfer"; this is *not* the anchor's separate, API-key-gated `/v1`
business API), then polls `/sep6/transaction` to completion. Proven live:
100 TRY → 2.0534049 USDC actually paid to a testnet account
(`stellar_transaction_id` confirmed on Horizon), which was then deposited
into the real-TEE-connected SettlementVault
(`CARXF7RTX5Z47642DYZNAFRKJ3VDGHY6R36ZLMSERVQA2P57N2JIMCSN`) via its normal
`deposit` call — closing the loop from real fiat rail through real TEE
attestation to the dark pool vault, all live on testnet. (Needed a
USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 trustline on
the depositor account first, and the vault's `--token` is the asset's SAC
id — `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` — not the
classic issuer address.)

**Re-verified 2026-09-09** after the anchor shipped a `stellar.toml` version
bump to 2.7.0: its `/v1` business API is now gone entirely (every `/v1/*`
route 404s) — the anchor is SEP-only now, which our integration already
was, so nothing broke. One new, genuinely useful behavior: depositing to an
account with no USDC trustline yet now surfaces as SEP-6 status
`pending_trust` instead of hanging or erroring — confirmed live by
depositing to a fresh account before and after adding its trustline.

**Off-ramp direction, also proven live (`scripts/sep6_offramp_demo.py`):**
withdrew USDC out of SettlementVault back to a wallet, then sent it through
SEP-6 `/withdraw` back to the anchor for a (simulated) TRY payout — full
round trip: TRY → USDC → vault → USDC → TRY. One real gotcha hit and
solved along the way: `stellar tx new payment` has no memo flag at all
(checked its `--help`), but a SEP-6 withdrawal is unusable without one —
the anchor uses the memo to match an incoming payment back to a specific
withdrawal request. Built and signed that payment with Python's
`stellar_sdk` directly instead (`IdMemo`/`TextMemo`/`HashMemo` per the
anchor's declared `memo_type`), confirmed completed with the anchor's own
`external_transaction_id` and a real `stellar_transaction_id`.

### Not yet done

Full signature-chain-to-Root-CA (stretch goal), `report_data` binding
(currently unused — meant to tie a quote to one specific running instance,
not just "a" TDX enclave with the right code), Confidential Tokens
integration.

## Build

```bash
export PATH="$HOME/.cargo/bin:$PATH"  # rustup's cargo must come before Homebrew's
stellar contract build
cargo test --manifest-path contracts/attestation-verifier/Cargo.toml
cargo test --manifest-path contracts/settlement-vault/Cargo.toml
```

## License

MIT
