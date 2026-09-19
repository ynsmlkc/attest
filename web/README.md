# Attest — web

The trading UI for Attest's dark pool: live Reflector prices, on-chain
attestation status for the matching-engine's TEE, deposit/withdraw against
`SettlementVault`, order submission straight to the running matching-engine
CVM, and (via the Anchor tab) a real SEP-6 TRY↔USDC on/off-ramp against a
live sandbox anchor. See the repo root `README.md` for how every contract
and service this talks to was built and proven.

## Run locally

```bash
npm install
npm run dev
```

Requires the [Freighter](https://www.freighter.app/) browser extension,
set to Testnet, to connect a wallet and sign deposit/withdraw/order
transactions.

Order submission (`New Order` → `Submit Order`) needs the matching-engine
CVM running — it's stopped between demos to avoid idle Phala Cloud cost.
Restart it with `phala cvms start --cvm-id <id>` (see repo root README) and
wait for `status: running` before submitting orders; otherwise deposits,
withdrawals, and the attestation/price panels all work against Soroban
directly regardless of the CVM's state.

## Config

`src/lib/config.ts` holds every deployed contract address, the matching
engine's URL, and the two tradable assets (real testnet XLM and Circle's
real testnet USDC — not synthetic demo tokens). Update it if any of those
are redeployed.

## Design

Visual design (`src/components/terminal/`) came from a Claude Design
project (graphite + signal-amber trading-terminal look, Instrument Sans +
IBM Plex Mono), imported and wired to the real app logic rather than
built as a static mockup:

- **Token icons** (`public/tokens/`): real XLM and USDC logos from Trust
  Wallet's public `assets` repo, not placeholder monograms.
- **Price chart**: real candles only. `src/lib/priceHistory.ts` builds a
  ~22-hour candlestick series from two genuine Reflector oracle calls —
  `prices(asset, 20)` for the most recent samples at native 5-minute
  resolution (20 is Reflector's actual per-call ceiling on this pool,
  confirmed empirically: 21+ silently returns no data), plus
  `price(asset, timestamp)` at hourly anchors further back (works live up
  to ~20-21h; the pool's `history_retention_period()` is 86400s). Points
  are bucketed into real hourly OHLC — open/close are the first/last real
  sample in each hour, high/low are the real min/max observed, never
  interpolated or invented. Timeframes beyond 24H show an honest "no data"
  message instead of synthetic candles, since this oracle simply doesn't
  retain that far back.

## Anchor screen

The **Anchor** tab (`src/components/terminal/AnchorPanel.tsx`,
`src/lib/anchor.ts`) is a browser port of `scripts/sep6_onramp_demo.py` /
`sep6_offramp_demo.py` — same live sandbox anchor
(`tr-mock-anchor.fly.dev`), same SEP-10/SEP-6 calls, driven from Freighter
instead of a local secret key:

- **SEP-10 auth**: fetches the challenge, signs it via Freighter
  (`signTransaction`), posts it back for a JWT.
- **Deposit**: `GET /sep6/deposit` returns real bank instructions (IBAN,
  bank name, reference code) — the "Simulate bank transfer" button hits the
  anchor's own sandbox trigger (`POST /sep6/tx/{id}/simulate-bank-transfer`,
  same as the Python script — not the anchor's separate `/v1` API), then
  polls `GET /sep6/transaction` every 3s for real status. Once `completed`,
  a "Deposit into vault" button calls `SettlementVault.deposit` with the
  anchor's real `amount_out`.
- **Withdraw**: `GET /sep6/withdraw` returns the anchor's real treasury
  account + required memo; "Send payment" builds, signs (Freighter), and
  submits a real classic-asset USDC payment with that memo directly via
  `stellar-sdk` (ported from the Python script, since `stellar tx new
  payment` has no memo flag).
- **Quote**: the "≈ X USDC/TRY" line is a live, unauthenticated SEP-38
  `GET /sep38/price` call — not a hardcoded rate.
- **Limits**: the sidebar's per-transaction min/max/fee come from a live
  `GET /sep6/info` call — this anchor doesn't track or expose 24h usage, so
  there's no usage-progress bar here (a fabricated one would misrepresent
  what the anchor actually reports).
- **Recent transfers**: `GET /sep6/transactions`, once authenticated.
- **`pending_trust` handling**: if the receiving account has no USDC
  trustline yet, the anchor's real status for that is `pending_trust`
  (confirmed live against the sandbox) — the UI surfaces this explicitly
  rather than treating every non-terminal status the same way.

## Order signing (SEP-0053)

`New Order` on the Trade page now signs the order before submitting it —
`src/lib/orderSigning.ts` builds a canonical string (`Attest order v1\n...`)
and signs it via Freighter's `signMessage()`. This closes a real gap: the
matching-engine used to accept a bare `{party, ...}` JSON body with no
proof the caller actually controlled that address. Freighter's
`signMessage()` was verified live in a browser console — signed message,
independently hashed with `SHA256("Stellar Signed Message:\n" + message)`,
verified against `Keypair.verify()` — to confirm it really implements
SEP-53 (prefix + SHA-256 + raw 64-byte ed25519) before trusting it for
this. `services/matching-engine/index.js` rebuilds the identical canonical
string server-side and verifies independently; SEP-53 itself defines no
replay protection, so a `ts` field and a short (120s) seen-signatures
window were added on top. **Not yet enforced by the currently-deployed
CVM** — the image needs rebuilding and redeploying for this to take
effect; until then, order submission still works (the client always
signs), it's just not yet checked server-side.

## Orders screen

`src/components/terminal/OrdersPanel.tsx` — a per-wallet view over the same
matching-engine the Trade page's order panel and activity feed use
(`src/lib/matchingEngine.ts`), not a separate data source:

- **Open tab**: `GET /orders` already returns each resting order's `party`,
  so this is filtered client-side to the connected wallet — genuinely
  "yours only," not the whole book. Cancel is shown but disabled with an
  honest tooltip, since the matching-engine has no cancel endpoint.
- **History tab**: the matching-engine's match records only ever stored
  `orderAId`/`orderBId`/`txHash`/`at` — no party or token info — so there
  was no way to honestly show "your settled trades" at all. Fixed at the
  source: `services/matching-engine/index.js`'s match record now also
  carries `partyA`/`partyB` and each side's give-token/amount. The frontend
  detects which shape it's talking to (`partyA !== undefined`) and either
  shows a real, filtered, full-detail history, or — against an
  not-yet-redeployed engine — the same reduced global feed as the Trade
  page's activity table, with a visible note explaining why it isn't
  filtered. Nothing is invented either way.

## Attestations screen

`src/components/terminal/AttestationsPanel.tsx` reuses the exact same
on-chain calls as the Trade page's `AttestationCard`
(`is_registered`/`get_engine_address` on `AttestationVerifier`) — same
live result, page-level instead of sidebar-sized. It intentionally does
**not** reproduce the original design's per-instance MRTD/RTMR3 hex values
or "quote age / renews every 60s" — this project's contracts don't expose
getters for the stored measurement bytes, and attestation is checked once
at registration, not on a timer, so a fabricated countdown would be a lie.
The page shows exactly what's real (enclave ID, live status, engine
address, verifier contract) plus the same MRTD-vs-RTMR3 explanation used
throughout this project's docs, and says outright that this app only knows
about one enclave — there's no on-chain index to enumerate more.
