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
