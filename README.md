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
- **2026-09-10 finding, since fixed:** `initialize` now also takes
  `expected_app_measurement` (RTMR3), checked alongside MRTD. Deploying a
  second, completely different app (`services/matching-engine`) on the same
  dstack build produced an *identical* MRTD to the first demo CVM —  MRTD
  only measures the virtual firmware, not application code, so it's shared
  across every app on a given dstack version. RTMR3 (offset 520, 48 bytes)
  is the field that actually covers the docker-compose/app content and so
  differs per app — verified by computing its offset from the TD Report
  Body's documented field layout and cross-checking the resulting slice
  against Phala's own independently-reported `tcb_info.rtmr3`, exact match.
  Before this fix, `expected_measurement` alone only proved "some app is
  running on genuine TDX+dstack hardware," not "this specific app" — a real
  gap in exactly the property the project exists to prove.

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
- **2026-09-19: `settle` now verifies the traders, not just the engine.**
  It takes each side's `SignedOrder` (party, give/want token+amount, `ts`,
  SEP-0053 signature) plus a fill size per side, and the vault itself
  re-derives the signed text, verifies the ed25519 signature against the
  key the trader linked with `set_order_key`, tracks how much of each order
  is filled (partial fills, no replay past the signed size), enforces the
  signed limit price and a 7-day order age. Before this, `settle` trusted
  the engine key completely — a compromised key could move any depositor's
  balance, bounded only by the price-deviation guard. Now it can only
  execute what traders signed for. The signed text is the v3 message the web
  client and engine also build (`order_digest` in `lib.rs`; a test pins its
  exact format). Contract change → needs a fresh vault
  deploy (no upgrade path), like every earlier cascade; not deployed yet.
- **2026-09-19: `settle_external` (Soroswap Aggregator).** Routes a trader's
  signed order to external liquidity: the vault builds a single-hop Soroswap
  route, grants the router/token auth tree itself, and credits the measured
  output; the signed limit price becomes the swap's minimum, so the engine
  cannot loosen it. `set_dex` (admin) stores the aggregator + router. Proven
  against the *live* testnet aggregator from a scratch vault (5 XLM → 0.5277494
  USDC, tx `3ec9ae99…2438`) — details, the auth-tree gotchas and what's still
  missing (engine/web routing) in `docs/external-liquidity.md`.
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

### `services/matching-engine` — a real matching engine running inside a TEE

Everything above proves attestation *verification* — that a genuine,
specific TEE quote checks out on-chain. Until this milestone, nothing in
the project actually ran inside that TEE: the demo CVMs above only existed
to produce a quote, and every `settle()` call was signed by an ordinary
externally-held keypair (`attest-dev`) that a human typed the trade
parameters for. This closes that gap.

`services/matching-engine` is a small Node service, deployed as its own
Phala Cloud TDX CVM, that:

1. On boot, derives its own Stellar keypair via dstack's enclave-bound key
   derivation (`DstackClient.getKey('attest/matching-engine/v1')`). The
   32-byte result is used directly as an ed25519 seed
   (`Keypair.fromRawEd25519Seed`) — verified against `@phala/dstack-sdk`'s
   own published source (`dist/solana.js`): the modern `getKey()` path feeds
   the raw key straight into `Keypair.fromSeed()` with no extra hashing (the
   SHA256 step in its `toKeypairSecure` helper only applies to the
   deprecated `deriveKey`/TLS-key path), so Solana's and Stellar's identical
   ed25519 derivation apply the same way. This secret key never leaves the
   process and is deterministic per (app measurement, key path) — no other
   code can reproduce it.
2. Holds an in-memory limit-order book (`matcher.js`, unit-tested with
   `node --test`): orders cross on limit price, matching is price-time
   priority, trades execute at the resting order's price, and partially
   filled orders keep resting with a smaller remainder. (Originally exact
   opposite pairs only; partial fills added 2026-09-19 — not yet on the
   deployed CVM.) A pair the vault keeps rejecting is skipped for 60s so
   it can't jam the book.
3. On a match, builds, signs (with its own derived key), and submits
   `SettlementVault.settle()` itself, via `@stellar/stellar-sdk`'s
   `contract.Client` (confirmed its exact generated argument shapes —
   `{tag, values}` enums, `Buffer` for `Bytes`/`BytesN`, `bigint` for
   `i128` — by generating real TypeScript bindings from the deployed wasm
   with `stellar contract bindings typescript`, not assumed).

**`settlementVaultId`/`enclaveIdHex` are runtime config (`POST /configure`
after boot), not compose-baked env vars.** Phala's RTMR3 is computed over
the whole `docker-compose.yaml`, environment included — baking a specific
vault ID in would mean every vault change produces a different measurement,
which would then need re-registering against a new AttestationVerifier,
which itself needs to already know the enclave's measurement: a circular
dependency, hit and fixed live (confirmed empirically: removing those two
env vars from the compose changed RTMR3 again, exactly as expected once
understood).

**Proven live, end to end, on testnet:**

- Deployed to a real TDX CVM; genuinely derived engine address:
  `GBYCHHAKPZO2MG552GJRCSFFWPUUFLHBDNB5DVHQQKBXLZBTKHASYUPZ`.
- Docker image build gotchas hit and fixed: `@stellar/js-xdr` requires
  Node ≥22 (bumped the Dockerfile off `node:20-alpine`); `@phala/dstack-sdk`
  declares `@noble/curves` as an *optional* peer dependency but imports it
  unconditionally at module load — added it (and `@noble/hashes`) as direct
  dependencies; Phala Cloud pulls a pre-pushed image rather than building
  locally, and the image must be `linux/amd64` (a plain `docker build` on
  Apple Silicon produces `arm64`, which fails to pull on Phala's TDX
  hosts with "no matching manifest") — built with
  `docker buildx build --platform linux/amd64`.
- Called `POST /register` on the running CVM with this exact deployment's
  real, freshly-fetched quote (payload/signature/enclave_id) — the enclave
  signed its own `register_verified_enclave` call with its derived key;
  confirmed on-chain via `is_registered` and `get_engine_address` matching
  the derived address.
- Deposited real demo-token balances for two parties into SettlementVault,
  then `POST`ed two exactly-opposite orders to the running CVM's `/orders`
  endpoint. The engine matched them and settled on its own — real
  transaction hash, no human specifying trade parameters — and the
  resulting on-chain balances were confirmed exactly correct for both
  parties.

### `web` — trading UI

A real frontend (Vite + React + Tailwind), not a mockup — see `web/README.md`.
Live Reflector prices for real testnet XLM/USDC, an on-chain attestation
panel that live-checks the matching-engine's registered enclave, and
deposit/withdraw/order-submission wired to the actual deployed contracts
and CVM, signed via Freighter.

An **Anchor** tab now brings the fiat rail above (TR Mock Anchor) into the
same UI instead of leaving it CLI-only: SEP-10 auth and SEP-6
deposit/withdraw driven through Freighter, a live SEP-38 quote, real bank
instructions and payout memo shown to the user, and a status tracker
polling the anchor directly (correctly surfacing real states like
`pending_trust`, not just a hardcoded happy path). See `web/README.md`'s
"Anchor screen" section.

**Orders** and **Attestations** are also real tabs now (the design's
"Pool" nav item was dropped entirely — this project has no AMM/LP pool,
just an order-matching book, so there was nothing honest to put there).
Orders is a per-wallet view over the matching-engine's own order/match
data; Attestations reuses the same live `is_registered`/`get_engine_address`
checks as the Trade page's attestation card, page-sized. Building Orders'
history tab honestly required a small source fix:
`services/matching-engine`'s match records never stored which wallet was
on which side of a settled trade (only order ids and the tx hash) — added
`partyA`/`partyB` and each side's token/amount to the record. The
currently-deployed CVM predates this field, so until it's rebuilt and
redeployed the UI detects that and falls back to an honestly-labeled
global feed instead of fabricating per-wallet history. See `web/README.md`
for both screens' exact data sources.

**SEP-0053 order signing is also closed now** (was flagged as a real gap
in `docs/positioning.md`): `New Order` submissions are signed client-side
via Freighter's `signMessage()` (`web/src/lib/orderSigning.ts`) and
verified server-side against the same canonical message
(`services/matching-engine/index.js`'s `verifyOrderSignature`) — before
wiring this in, Freighter's `signMessage()` was confirmed live to actually
implement SEP-53 (`"Stellar Signed Message:\n"` prefix, SHA-256, raw
64-byte ed25519), not assumed from the SEP text. SEP-53 defines no replay
protection on its own, so a short timestamp window plus a seen-signatures
cache was added. Like the Orders history fix above, this is a source
change the currently-deployed CVM doesn't run yet — needs a rebuild and
redeploy to actually start rejecting unsigned orders.

**Real bug found and fixed while restarting the CVM for this session's
testing, 2026-09-12: the matching-engine had no CORS headers at all.**
`curl` reached every endpoint fine (no CORS enforcement outside a browser),
which is exactly why this stayed invisible — every previous "engine
offline" reading from inside the actual web UI may well have been this,
not the CVM being stopped. Confirmed directly: `curl -i` against `/matches`
with an `Origin` header came back with no `Access-Control-Allow-Origin` at
all, and the browser's own network log showed the preflight `OPTIONS`
request hanging/blocked. Fixed with a small CORS middleware in
`services/matching-engine/index.js`.

**Rebuild+push+redeploy attempted, 2026-09-12 — hit a real architectural
wall, documented here rather than silently worked around:**

1. Rebuilt and pushed `ynsmlkc/attest-matching-engine:latest` to Docker Hub
   with all three fixes (CORS, order-signing, match-party-enrichment).
2. `phala deploy --cvm-id ... -c docker-compose.yml` reported success in
   ~1s — too fast to have actually re-pulled anything. Verified directly
   with `curl`: no `Access-Control-Allow-Origin` header, and an unsigned
   order was still accepted with 200. **The old container was still
   running.** Cause: `docker-compose.yml`'s `image:` line is unchanged text
   (`ynsmlkc/attest-matching-engine:latest`), Docker's default pull policy
   only pulls a tag it doesn't already have cached, and the node already
   has `:latest` cached from the original deploy — so nothing told it to
   check Docker Hub again.
3. The fix for *that* (`pull_policy: always`, or pinning the compose to the
   new image's digest) is itself a real problem here: **any byte of
   `docker-compose.yml` changing changes RTMR3** (this project's own
   earlier finding, see the RTMR3 fix above) — so forcing a real code
   update on this enclave necessarily produces a new RTMR3, which
   `AttestationVerifier::register_verified_enclave` at
   `CCF2V4ZFJV3PB7BTCIM2YFK4LXFZGP4ZX55XVCUJSQ6HBQIUFQQ5MIMQ` would then
   reject (`AppMeasurementMismatch`) — because `initialize()` is
   one-time-only (`Error::AlreadyInitialized` on a second call), so this
   verifier instance's `expected_app_measurement` can never be updated to
   match new code.
4. Shipping this engine update for real therefore needs the same cascade
   this project used the last time RTMR3 checking was added — **done,
   same day:**
   - `docker-compose.yml` pinned to the pushed image's digest
     (`ynsmlkc/attest-matching-engine@sha256:06b6285b8fcf9...`), redeployed
     (`phala deploy`, ~54s this time — a real update, confirmed by `curl`
     immediately showing `Access-Control-Allow-Origin` present and an
     unsigned order getting a real `401`).
   - Fetched a fresh attestation quote (`phala cvms attestation --json`) —
     the raw TDX quote hex is embedded in the end-entity certificate's
     `quote` field, not the summary JSON's `tcb_info`. Extracted `payload`
     (bytes 0..632), `signature` (636..700, verified already low-s — no
     normalization needed this time), `pubkey` (700..764, `04`-prefixed),
     `MRTD` (payload 184..232), `RTMR3` (payload 520..568) — same offsets
     as always, cross-checked against Phala's own reported `tcb_info.mrtd`
     / `tcb_info.rtmr3` (exact match, verified with a Python script, not
     assumed) and locally re-verified with the `ecdsa` library before
     trusting it on-chain.
   - **New finding: the engine's derived Stellar address did NOT change**
     (`GBYCHHAKPZO2MG552GJRCSFFWPUUFLHBDNB5DVHQQKBXLZBTKHASYUPZ`, identical
     before and after the RTMR3 change) — dstack's `getKey` derivation is
     evidently scoped to MRTD (or something else stable across a
     compose-only edit), not RTMR3, contradicting this project's own
     earlier "deterministic per (app measurement, path)" phrasing if "app
     measurement" was read as including RTMR3. Worth knowing: an engine's
     signing identity surviving a code update is generically true here,
     not a fluke of this specific change.
   - New `AttestationVerifier`: `CC7BIO5LUPIDRRYRLAWRPWHBT6VYECXZC4AUQUZXLZWHC7Q6JEKW3FWK`
     (`initialize`d with the fresh MRTD/RTMR3/pubkey, admin `attest-dev`).
   - New `SettlementVault`: `CDLIBABHVQGWIRXBX7J4KA4ANKCXKN47EGKKJZ4SYOOTJTOA673POWPS`
     (pointed at the new verifier + the same Reflector oracle,
     `max_deviation_bps=500`).
   - Engine self-registered against the new verifier via its own
     `POST /register` (signed the registration with its own derived key,
     same as the original real-TEE milestone) — real tx
     `f01faf7bc9772ddc56fb91843f731f52a47b58cd1dcb29be4139f9bc8c4482dc`.
     `is_registered`/`get_engine_address` confirmed `true` /
     the expected address directly against the new verifier.
   - `web/src/lib/config.ts` repointed at both new addresses (engine
     address/enclave id unchanged, so nothing else needed updating).

**Proven live end-to-end after the cascade, all in the browser, from a
single connected wallet:** deposited 5 XLM into the new vault; submitted
two SEP-53-signed same-asset orders (5 XLM ↔ 5 XLM, a self-match — chosen
because the wallet held no USDC, and the UI's token pickers otherwise
forbid picking the same asset on both sides, so this was driven through
the app's own `signOrder`/`submitOrder` directly rather than the dropdown
UI); the engine matched and called `settle()` for real — tx
`65604f3034a85d13a388f8369c7c49303014ff928852143d63b16c2660ba2bdd`,
confirmed `successful: true` on Horizon, signed by the engine's own
address. The Orders page's History tab immediately showed this with full
per-wallet detail (pair, gave, received, real ledger tx link, "Attested"
badge) — the partyA/partyB fix, live. `curl` re-confirmed CORS headers
present and an unsigned order rejected with 401 against the *new* verifier
too. The CVM was stopped again afterward (5 XLM left sitting in the new
vault from this test — a withdraw of it hung mid-transaction on testnet
and wasn't retried; harmless idle testnet balance, not real value).

Everything not behind the CVM was also re-verified live this session
while it was running: attestation checks (`Attestations` page, live
`is_registered`/`get_engine_address`), and — against the *original*
vault, before the cascade — a full real deposit-then-withdraw round trip
(1 XLM in, balance 1, 1 XLM out, balance 0, both real signed Soroban
transactions via Freighter).

### Redeploy, 2026-09-19: the engine's code now ships inside the compose file

Everything built since the last cascade (mutex, message v3 with on-chain order
verification, partial fills, fail-closed price guard, Soroswap routing) is live on
the Phala CVM, with a **different deployment mechanism**: `services/matching-engine/make-compose.js` embeds `index.js` + `matcher.js` (base64) in `docker-compose.yml`
on top of the already-published, digest-pinned base image (which only supplies
`node_modules`) — no new image is pushed anywhere. Because RTMR3 covers the whole
compose file, the exact engine code is now part of what the quote measures, and the
file lists each source's sha256 so it can be checked against the repo. Verified that the
entrypoint reproduces both files byte for byte inside the base image.

- `phala deploy --cvm-id … -c docker-compose.yml` (81s). The sealed `ADMIN_KEY`
  survived the update; the engine's derived address is unchanged
  (`GBYCHHAK…YUPZ`, so it isn't scoped to RTMR3, as noted earlier).
- Fresh quote → MRTD/RTMR3 cross-checked against Phala's `tcb_info` (exact match),
  signature verified locally (already low-s) → new verifier `CC6JX4RPXMWCKTWDRQBWAYWRZYQIVR3VZA63PE6J4U6SKXWPKE645KKU`,
  new vault `CCZRUZMSBNWR3IVIK4TFKIYO5ZSSEDYOY267PSNIX3A6H4BX4LKUFGZB` (price guard 500 bps, XLM/USDC/EURC symbols, `set_dex`
  → live Soroswap). The engine registered itself with its own key inside the TEE.
- Proven live through the CVM: a v3-signed order rested, the opposite order crossed it and
  the TEE engine settled on-chain (tx `c52dd9d9…`); an XLM→USDC order that Soroswap's
  testnet pool would fill ~47% below Reflector was correctly *not* routed (guard), and
  kept resting.

**Same day, second pass: switched to a pushed image.** Once Docker Hub was available
(the user pushed it), the CVM moved from embedded code to a plain compose pinned to
`ynsmlkc/attest-matching-engine@sha256:10b17a4bece3c3430eea99d6ee9821b52ed6b7ac8151f253fbcbb6cd8c500474`
(`node make-compose.js --image sha256:10b17a4bece3c3430eea99d6ee9821b52ed6b7ac8151f253fbcbb6cd8c500474`). Before deploying, the image's
`/app/index.js` and `/app/matcher.js` were checked to hash exactly like the repo's
(`59ab52c4…`, `7b075d2a…`). RTMR3 changed again, so: fresh quote (MRTD/RTMR3 matched Phala's
`tcb_info`, signature verified locally) → verifier `CBMKSAL2QDOXVLM5AO5M2L6UWNQI76M5T735EOEXDSPQRQIB7AS2K3SZ`, vault
`CBBD34JHVKXGNGODQQ2FWU2TSCBKP5XW2SPEL6JZKGA5OP3LNFS6ECFY` (same settings), engine re-registered and reconfigured from inside
the TEE; engine address unchanged. Proven live again: a v3-signed order rested, the opposite
order crossed it, and the TEE engine settled it on-chain (tx `1b7a0877…`). The verifier/vault
from the embedded-code pass (`CC6JX4RPXMWCKTWDRQBWAYWRZYQIVR3VZA63PE6J4U6SKXWPKE645KKU` / `CCZRUZMSBNWR3IVIK4TFKIYO5ZSSEDYOY267PSNIX3A6H4BX4LKUFGZB`) and the earlier ones are
orphaned on-chain (no upgrade/pause path — see bug.md #1). Embedded mode is still available
(`node make-compose.js` with no flag) if a registry isn't an option.

### Security review, 2026-09-13: enclave-registration hijack — found and closed

A code review of `attestation-verifier` (not a bug report from outside)
found that `register_verified_enclave` had no protection against
**re-registering an already-registered `enclave_id` with a different
`engine_address`**. Once any quote's `payload`/`signature` is submitted
on-chain once, both are public (visible in that transaction) — the old
check only required the *new* `engine_address`'s auth, never the
*existing* one's, so anyone could replay the same public payload/signature
with their own address and steal control of `SettlementVault.settle()`'s
trust for that enclave (which only checks `engine.require_auth()`, never
the actual depositors' consent).

**Fixed same day:** `register_verified_enclave` now also requires the
*currently-registered* `engine_address` (if any) to authorize the change —
only whoever already holds that key can rotate their own registration.
First-ever registration of a fresh `enclave_id` is unaffected (nothing
existing to protect). Added both a positive test (legitimate owner
rotating their own registration succeeds) and a negative one under precise
auth mocking (`register_verified_enclave_rejects_hijack_without_original_owners_auth`
— an attacker with only their own auth, not the real owner's, panics).
**Also confirmed live on testnet**, not just in unit tests: deployed the
fixed contract (`CAOBEACIPMMI2LYKWHPHIF5X5ALJWX2W2H7QM32XSE5LOGLIUKLRHCWN`),
registered the real matching-engine's real quote normally, then had a
separate, independently-funded identity (`attacker-test`) attempt to
replay that exact same public `payload`/`signature` claiming the
`enclave_id` for itself — rejected before even reaching simulation
(`Missing signing key for account GBYCHHAKPZO2MG552GJRCSFFWPUUFLHBDNB5DVHQQKBXLZBTKHASYUPZ`,
the real operator's address). `get_engine_address` confirmed unchanged
afterward. New `SettlementVault` deployed to match
(`CAPWTJ3RF5TN3CWFQRJ33TRBQW3336QSRLO2IML6PZ5TWKVWNZW3AVZA`),
`web/src/lib/config.ts` repointed at both.

**Known residual gap, deliberately not closed here (documented, not
hidden):** the fix only protects a registration that already exists. The
*very first* registration of a given `enclave_id` has no "existing owner"
to check against yet, so a race is still theoretically possible there:
whoever's `register_verified_enclave` call lands first, for a well-known
`enclave_id` (this project's is a placeholder value, `0x44...44`, public
in `web/src/lib/config.ts`), wins it — regardless of whether they're the
genuine TEE operator. Two sub-cases, different costs:

- **Cheap**: an attacker who has no TEE at all, just sees a *pending*
  registration transaction (the real operator's) and replays its public
  payload/signature with their own address, racing to land first. Closing
  this needs binding `engine_address` into the quote's own Intel-signed
  data — TDX's `REPORT_DATA` field (payload bytes 568..632, right after
  RTMR3) is exactly built for this: the TEE fills it in itself before the
  quote is signed, so a genuine quote could commit to
  `sha256(engine_address)` and the contract could check the two match,
  making the address un-substitutable without invalidating Intel's own
  signature. Not implemented: Soroban's `Address` type is intentionally
  opaque (it has to represent both classic accounts and contract
  addresses uniformly), so there's no SDK-level way to get its raw
  ed25519 bytes back out to hash and compare — actually landing this
  requires switching the engine's identity from `Address`+
  `require_auth()` to a raw `BytesN<32>` pubkey checked with
  `env.crypto().ed25519_verify()` directly, which also means redesigning
  how `SettlementVault::settle` authenticates its engine caller (today
  that's `engine.require_auth()`, which needs a real `Address`) and how
  `services/matching-engine` signs its own transactions — a real
  multi-contract refactor, not a one-line fix. Scope also has to include
  replay/nonce protection for whatever new signing scheme replaces
  Soroban's built-in auth nonce handling (ed25519_verify alone doesn't
  give you that for free — a signed message could otherwise be replayed
  verbatim). Backlogged, not done.
- **Expensive, and out of scope for this hackathon on purpose**: an
  attacker who stands up *real* TDX hardware, runs this project's actual
  published code, and legitimately wins the registration race with a
  genuinely valid, self-consistent quote. `report_data` binding doesn't
  stop this case (their quote is honest end-to-end) — only requiring admin
  auth on every *first* registration would, and that reintroduces a
  permissioned step this project deliberately kept out of `verify_quote`/
  first-time registration. Left for whoever operates this in production to
  decide, same as the Root-CA stretch goal below.

This is exactly the kind of thing to close (or explicitly accept) before
mainnet — noting it here rather than after the fact.

### Not yet done

Full signature-chain-to-Root-CA (stretch goal), `report_data` binding
(see the security review above — now scoped precisely: binds
`engine_address` into the quote so first-registration racing can't
succeed, needs an `Address`→raw-pubkey redesign, replay/nonce handling
included in scope), Confidential Tokens integration.

## Build

```bash
export PATH="$HOME/.cargo/bin:$PATH"  # rustup's cargo must come before Homebrew's
stellar contract build
cargo test --manifest-path contracts/attestation-verifier/Cargo.toml
cargo test --manifest-path contracts/settlement-vault/Cargo.toml
```

## License

MIT
