# Running Attest locally against testnet (no TEE)

Use this to develop and demo the whole flow without a Phala CVM or a container
registry. Contracts and prices are real testnet; the **only** thing missing is
attestation: the engine key is an ordinary key on your machine, exactly what the
TEE deployment exists to avoid. Never present this as TEE-protected.

## What runs where
- `services/matching-engine/dev.js` — the real engine (`index.js`) with
  `DstackClient.getKey()` replaced by `DEV_ENGINE_SECRET`. Not in the Docker image.
- Contracts on testnet: a verifier initialized with Automata's public test-vector
  quote, and a `SettlementVault` pointing at it (+ the live Soroswap Aggregator/router
  via `set_dex`). The engine registers itself with its own key through `/register`.
- `web` (`npx vite`) reads `web/.env.local` (git-ignored, see `web/.env.example`) to
  point at the local engine and those contracts.

## Steps
1. `stellar keys generate attest-engine-local --network testnet --fund`
2. Start the engine:
   `DEV_ENGINE_SECRET=$(stellar keys show attest-engine-local) ADMIN_KEY=<random> PORT=8787 node dev.js`
3. Verifier + vault (once): deploy `attestation_verifier.wasm`, `initialize` it with the
   test-vector MRTD/RTMR3/Intel key (constants at the top of
   `contracts/settlement-vault/src/test.rs`); deploy `settlement_vault.wasm`,
   `initialize` it, then `set_dex` (aggregator `CC74XDT7…`, router `CCJUD55A…`) and
   `set_reflector_symbol` per token if the price guard is on (`max_deviation_bps > 0`).
4. `POST /register` (admin key) with the test-vector quote and an enclave id, then
   `POST /configure` with the vault id and that enclave id.
5. Each trader: `set_order_key` once, `deposit`, then submit v3-signed orders
   (the web app does all of this through Freighter).

## Verified this way (2026-09-19, testnet)
Real engine → real vault, all on-chain: internal match, partial fill (remainder keeps
resting), and automatic Soroswap routing of an unmatched order (5 XLM → 5.277420 USDC,
reported back in `/matches`).
