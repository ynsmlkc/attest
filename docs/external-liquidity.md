# Routing unmatched orders to external liquidity (Soroswap Aggregator)

Status: **vault side implemented and proven live on testnet (2026-09-19);
engine/web routing not built yet.** `SettlementVault.settle_external` swaps a
trader's signed order through the live Soroswap Aggregator; the auth tree was
verified against the real contracts, not assumed (see "Proven live").

## What was verified

Read straight from `soroswap/aggregator` (GitHub, `main`) and queried live on testnet:

- **Aggregator, testnet:** `CC74XDT7UVLUZCELKBIYXFYIX6A6LGPWURJVUXGRPQO745RWX7WEURMA`
  (`public/testnet.contracts.json`). `get_adapters` returns three unpaused adapters:
  Soroswap (protocol 0), Phoenix (1), Aqua (2).
- **Swap entry point:**
  `swap_exact_tokens_for_tokens(token_in, token_out, amount_in, amount_out_min,
  distribution: Vec<DexDistribution>, to, deadline: u64) -> Vec<Vec<i128>>`.
  `DexDistribution { protocol_id: Protocol, path: Vec<Address>, parts: u32, bytes: Option<Vec<BytesN<32>>> }`;
  `Protocol` = Soroswap 0, Phoenix 1, Aqua 2, Comet 3. Every path must start with
  `token_in` and end with `token_out`; each leg must be >= 10 units.
- **Auth (verified):** the aggregator calls `to.require_auth()`, and for the Soroswap
  leg it calls the **router directly** (`get_adapters` protocol 0 = the router itself,
  no adapter contract in between). Two Soroban host rules decide what the vault must
  grant (read from `soroban-env-host` `auth.rs`, then confirmed on testnet):
  1. The aggregator is the vault's direct callee, so its `to.require_auth()` is implicit
     and never advances the invoker-auth tracker. The tree must therefore be **rooted at
     the router call**, not the aggregator call (rooting at the aggregator fails with
     "unauthorized call for a contract earlier in the call stack").
  2. A grant lives only until the vault's *next* sub-call returns. Any other
     cross-contract call (e.g. reading a balance) between `authorize_as_current_contract`
     and the aggregator call silently voids it.

## Liquidity reality on testnet (queried via router `get_reserves`)

| Pair | Reserves (raw, 7 dp) | Implied price |
|---|---|---|
| XLM / Soroswap's USDC `CB3TLW74…` | 132,539,762,257 / 38,532,618,703 | ~0.29 USDC per XLM |
| XLM / **our** USDC `CBIELTK6…` | 39,379,678,612,148 / 4,169,013,119,690 | ~0.106 USDC per XLM |
| XLM / our EURC `CCUUDM43…` | 128,429,433,311 / 2,453,538 | dust (0.25 EURC) |

- Soroswap's own testnet USDC is a **different token** than the one this project trades.
- A pool for our USDC exists, but it prices XLM ~2.7x below the other pool, i.e. far
  off any real oracle. With the Reflector guard on (500 bps), external swaps there
  would be (correctly) rejected. EURC is effectively unroutable.
- So on testnet external routing would demonstrate the *mechanism* only, not sane fills.

## Prerequisites and design

1. **Taker consent first — done (2026-09-19).** `settle()` now verifies each trader's
   signed order on-chain. `settle_external` must reuse `consume_order` so the engine can
   never route more than a trader signed, or below their signed limit price.
2. `settle_external(enclave_id, engine, order, amount_in, amount_out_min,
   distribution, deadline)`:
   - same engine/enclave gate as `settle`;
   - `consume_order(order, give_fill = amount_in, receive_fill = amount_out_min)` — the
     signed limit price becomes the swap's `amount_out_min`, so the engine can't loosen it;
   - debit `token_in` from the party, call the aggregator with `to` = the vault, and
     credit `token_out` by the **measured** balance delta (not the aggregator's return);
   - Reflector guard applied to `amount_in` vs the measured output.
3. **Aggregator address = admin-set storage** (`set_aggregator`), never a caller argument
   (arbitrary-contract-call class of bug).
4. Engine: after matching, an order's unfilled remainder that the trader marked
   "route externally" (needs a flag in the signed text, i.e. a new message version) goes
   through `settle_external`. Quotes come from the aggregator's `get_amounts_out`-style
   views or the Soroswap API.
5. **Privacy trade-off to state plainly:** the external leg is a public on-chain swap;
   dark-pool confidentiality only covers the internally matched part.

## Implemented: `set_dex` + `settle_external`

- `set_dex(aggregator, router)` — admin-only, stored (never a caller argument).
- `settle_external(enclave_id, engine, order, amount_in, amount_out_min, deadline)`:
  engine + enclave gate → `consume_order(order, amount_in, amount_out_min)` (signature,
  size, and signed limit price; the engine may only raise `amount_out_min`) → debit
  `token_in` → grant the tree below → aggregator swap with the vault as `to` → credit the
  **measured** balance delta → Reflector guard on `amount_in` vs the measured output.
  The vault builds the single-hop Soroswap route itself; the engine supplies none.

```
vault --(implicit)--> aggregator.swap_exact_tokens_for_tokens(...)
                        \--> router.swap_exact_tokens_for_tokens(amount_in, 0, path, vault, deadline)  <- granted root
                               \--> token_in.transfer(vault, pair, amount_in)                            <- granted child
```

## Proven live (testnet, scratch deployment — not the app's vault)

- Scratch verifier `CC7I3Y47N6K7XGF7VULEE3EHXUDM3KD6BLUQ6SBWODDBK2AWHIZTK34T`
  (Automata test-vector quote, engine = `attest-dev`), scratch vault
  `CBXV43YTCJADQ63UUWM2STKKVO6T6LP7EUIY7CFV45EK2DVUFOFFAH6J` (`set_dex` → live
  aggregator + router, price guard off).
- A SEP-53-signed order (5 XLM for >= 0.4 USDC) went through the **live aggregator →
  Soroswap router → pair**: 5 XLM in, **0.5277494 USDC** out, credited to the trader's
  vault balance; tx `3ec9ae99ab1f0ec90cedd952675888207c44aadb615a53205baa0e209e352438`.
- Replaying the same order was rejected with `OrderOverfilled` (#12).
- 5 new contract tests (23 total) use stand-in router/aggregator contracts; the test
  host enforces contract-address auth, so the tree shape is checked there too (three
  wrong shapes failed before the right one passed).

## Engine + web routing (message v3) — built, not deployed

- **No per-order switch.** Signed order text is now v3: v2 plus a fixed last line,
  `routing:pool first, then Soroswap at your limit or better`. Signing it is the
  trader's consent; the vault verifies the same text on-chain, so an order signed
  without it is rejected. The web UI has no toggle, only a one-line notice under the
  order form.
- **Engine.** After the pool has nothing left to match, the engine tries to route the
  incoming order's *whole remainder* through `settle_external` with `amount_out_min` =
  the signed limit price (`minOutFor`, rounded up). If the market can't deliver that,
  the simulation fails, nothing is sent and the order keeps resting. Resting orders are
  retried by a sweep every 60s (per-order 60s backoff). Runtime kill switch:
  `POST /configure {"externalRouting": false}` (or env `EXTERNAL_ROUTING=off`).
- **Records.** External fills appear in `/matches` with `venue: "soroswap"`,
  `orderBId: null`, and `giveAmountB` = what the vault actually credited (it is
  `settle_external`'s return value). The UI shows them as `#id ↔ Soroswap`.
- **Re-proven live** on a second scratch vault
  (`CCC3RML6EEVGWCOWQRJRFWW3EJ3DR34DR5UHQVVXWZEAUDK4JFPKAMCH`) with a v3 order signed the
  way the client does: 30 XLM → 3.16649 USDC, `settle_external` returned `3166490`,
  tx `b96cc26f02fd35c591bcf4cd2b39742c7498f6eb353456d81a0f6dae100e5db1`.
- Not done: trying smaller sizes when the whole remainder can't clear the limit, and
  end-to-end engine → vault on testnet (the engine was exercised with stubbed
  dependencies; it needs the redeploy to run for real).

## Still to do

1. **Deploy.** Needs the fresh-vault cascade anyway; `set_dex` + `set_reflector_symbol`
   for each token right after `initialize`.
2. **Pricing on testnet** stays the problem described above; for a demo either loosen the
   guard or use Soroswap's own testnet USDC (`CB3TLW74…`).
