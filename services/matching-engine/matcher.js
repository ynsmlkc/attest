"use strict";

/**
 * Pure order-matching logic, kept free of the Stellar/dstack imports in
 * index.js so it can be unit-tested with plain `node --test`.
 *
 * An order is `{ id, giveToken, giveAmount, wantToken, wantAmount,
 * remaining }`: it offers up to `remaining` of `giveToken` (originally
 * `giveAmount`) and insists on at least `wantAmount / giveAmount` of
 * `wantToken` per unit given -- that ratio is its limit price and never
 * changes across partial fills. All arithmetic is BigInt so a fill is exact
 * integer stroops (settle() takes i128 amounts).
 *
 * Matching is price-time priority: each order, oldest first, is tried as a
 * taker against strictly older resting orders (makers). A trade executes at
 * the MAKER's limit price, so the taker gets any price improvement -- the
 * usual resting-order convention.
 */

const ceilDiv = (a, b) => (a + b - 1n) / b;

function oppositeTokens(a, b) {
  return a.giveToken === b.wantToken && b.giveToken === a.wantToken;
}

/**
 * The largest fill between resting `maker` and incoming `taker` at the
 * maker's price, or null if the two don't cross / nothing fits.
 * `amountMaker` is what the maker gives, `amountTaker` what the taker gives.
 */
function computeFill(maker, taker) {
  if (!oppositeTokens(maker, taker)) return null;
  const mGive = BigInt(maker.giveAmount);
  const mWant = BigInt(maker.wantAmount);
  const tGive = BigInt(taker.giveAmount);
  const tWant = BigInt(taker.wantAmount);
  const mRem = BigInt(maker.remaining);
  const tRem = BigInt(taker.remaining);
  if (mRem <= 0n || tRem <= 0n) return null;

  // Limit prices cross: taker offers tGive/tWant of the maker's wanted
  // token per unit of the maker's given token; maker needs mWant/mGive.
  if (tGive * mGive < mWant * tWant) return null;

  // Cap by what the taker can pay at the maker's price.
  let x = mRem;
  const xCap = (tRem * mGive) / mWant;
  if (xCap < x) x = xCap;
  if (x <= 0n) return null;

  // Round the maker's proceeds UP so it never receives less than its limit.
  const y = ceilDiv(x * mWant, mGive);
  if (y > tRem) return null;
  // ...and re-check the taker's own limit after that rounding.
  if (x * tGive < y * tWant) return null;
  // settle() only allows a same-token trade when both sides are equal.
  if (maker.giveToken === maker.wantToken && x !== y) return null;

  return { maker, taker, amountMaker: x, amountTaker: y };
}

/**
 * Next executable fill in `orders` (assumed in ascending id / arrival
 * order), or null. `isBlocked(maker, taker)` lets the caller skip pairs that
 * recently failed on-chain so one bad pair can't jam the whole book.
 */
function findFill(orders, isBlocked = () => false) {
  for (let t = 0; t < orders.length; t++) {
    const taker = orders[t];
    let best = null;
    for (let m = 0; m < t; m++) {
      const maker = orders[m];
      if (isBlocked(maker, taker)) continue;
      const fill = computeFill(maker, taker);
      if (!fill) continue;
      // Best price for the taker = most maker-token received per unit paid,
      // i.e. the maker with the highest give/want; earliest wins ties.
      if (
        !best ||
        BigInt(maker.giveAmount) * BigInt(best.maker.wantAmount) >
          BigInt(best.maker.giveAmount) * BigInt(maker.wantAmount)
      ) {
        best = fill;
      }
    }
    if (best) return best;
  }
  return null;
}

/** Deducts a fill from both orders; returns the orders that are now empty. */
function applyFill(fill) {
  fill.maker.remaining = Number(BigInt(fill.maker.remaining) - fill.amountMaker);
  fill.taker.remaining = Number(BigInt(fill.taker.remaining) - fill.amountTaker);
  return [fill.maker, fill.taker].filter((o) => o.remaining <= 0);
}

/**
 * Smallest output the trader's signed limit price allows for selling `amountIn`
 * (in giveToken units) -- what the engine passes as `amount_out_min` when it
 * routes an order's remainder externally. Rounded UP so the fill is never
 * worse than the limit (the vault re-checks this on-chain). BigInt result.
 */
function minOutFor(order, amountIn) {
  const give = BigInt(order.giveAmount);
  const want = BigInt(order.wantAmount);
  return ceilDiv(BigInt(amountIn) * want, give);
}

/** Orders that still have something left to route externally, oldest first. */
function externalCandidates(orders, isBlocked = () => false) {
  return orders.filter((o) => o.remaining > 0 && !isBlocked(o));
}

module.exports = { computeFill, findFill, applyFill, minOutFor, externalCandidates };
