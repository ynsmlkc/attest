# Attest — web

The trading UI for Attest's dark pool: live Reflector prices, on-chain
attestation status for the matching-engine's TEE, deposit/withdraw against
`SettlementVault`, and order submission straight to the running
matching-engine CVM. See the repo root `README.md` for how every contract
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
