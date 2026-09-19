"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeFill, findFill, applyFill, minOutFor, externalCandidates } = require("./matcher");

let id = 0;
const order = (give, giveAmount, want, wantAmount) => ({
  id: ++id, giveToken: give, giveAmount, wantToken: want, wantAmount, remaining: giveAmount,
});

test("exact opposite orders fill completely (old behavior preserved)", () => {
  const a = order("X", 100, "Y", 200);
  const b = order("Y", 200, "X", 100);
  const f = computeFill(a, b);
  assert.deepEqual([f.amountMaker, f.amountTaker], [100n, 200n]);
  assert.equal(applyFill(f).length, 2);
});

test("non-crossing prices do not match", () => {
  const a = order("X", 100, "Y", 200); // wants 2 Y per X
  const b = order("Y", 150, "X", 100); // offers only 1.5 Y per X
  assert.equal(computeFill(a, b), null);
});

test("partial fill leaves the larger order resting with a remainder", () => {
  const maker = order("X", 100, "Y", 200);
  const taker = order("Y", 60, "X", 30); // gives 60 Y for 30 X at same price
  const f = computeFill(maker, taker);
  assert.deepEqual([f.amountMaker, f.amountTaker], [30n, 60n]);
  const done = applyFill(f);
  assert.deepEqual(done, [taker]);
  assert.equal(maker.remaining, 70);
});

test("trade executes at the maker's price; taker gets the improvement", () => {
  const maker = order("X", 100, "Y", 200); // wants >= 2 Y per X
  const taker = order("Y", 300, "X", 100); // willing to pay 3 Y per X
  const f = computeFill(maker, taker);
  assert.deepEqual([f.amountMaker, f.amountTaker], [100n, 200n]);
});

test("taker with more size than the maker only consumes the maker's size", () => {
  const maker = order("X", 50, "Y", 100);
  const taker = order("Y", 400, "X", 200);
  const f = computeFill(maker, taker);
  assert.deepEqual([f.amountMaker, f.amountTaker], [50n, 100n]);
});

test("maker proceeds round up so its limit is never violated", () => {
  const maker = order("X", 3, "Y", 10); // 3.33.. Y per X
  const taker = order("Y", 10, "X", 3);
  const f = computeFill(maker, taker);
  // maker receives at least amountMaker * 10/3
  assert.ok(f.amountTaker * 3n >= f.amountMaker * 10n);
});

test("same-token self-match only fills equal amounts", () => {
  const a = order("X", 5, "X", 5);
  const b = order("X", 5, "X", 5);
  const f = computeFill(a, b);
  assert.deepEqual([f.amountMaker, f.amountTaker], [5n, 5n]);
  const c = order("X", 5, "X", 3);
  const d = order("X", 3, "X", 5);
  assert.equal(computeFill(c, d), null);
});

test("price priority: taker hits the best-priced resting maker first", () => {
  const worse = order("X", 100, "Y", 250); // asks 2.5 Y per X
  const better = order("X", 100, "Y", 200); // asks 2.0 Y per X
  const taker = order("Y", 300, "X", 100);
  const f = findFill([worse, better, taker]);
  assert.equal(f.maker, better);
  assert.equal(f.taker, taker);
});

test("time priority breaks price ties", () => {
  const first = order("X", 100, "Y", 200);
  const second = order("X", 100, "Y", 200);
  const taker = order("Y", 200, "X", 100);
  assert.equal(findFill([first, second, taker]).maker, first);
});

test("blocked pairs are skipped so they cannot jam the book", () => {
  const m1 = order("X", 100, "Y", 200);
  const m2 = order("X", 100, "Y", 210);
  const taker = order("Y", 300, "X", 100);
  const f = findFill([m1, m2, taker], (m) => m === m1);
  assert.equal(f.maker, m2);
});

test("a book that keeps matching drains to empty via repeated fills", () => {
  const book = [order("X", 100, "Y", 200), order("Y", 50, "X", 25), order("Y", 150, "X", 75)];
  let fills = 0;
  for (let f = findFill(book); f; f = findFill(book)) {
    for (const done of applyFill(f)) book.splice(book.indexOf(done), 1);
    fills++;
  }
  assert.equal(fills, 2);
  assert.equal(book.length, 0);
});

test("minOutFor rounds up so an external fill is never below the signed limit", () => {
  const o = order("X", 3, "Y", 10); // wants >= 3.33.. Y per X
  assert.equal(minOutFor(o, 3), 10n);
  assert.equal(minOutFor(o, 1), 4n); // ceil(3.33)
  // the vault's own check: out * give >= in * want
  const out = minOutFor(o, 2);
  assert.ok(out * 3n >= 2n * 10n);
});

test("externalCandidates skips filled and blocked orders", () => {
  const a = order("X", 10, "Y", 20);
  const b = order("X", 10, "Y", 20);
  const c = order("X", 10, "Y", 20);
  b.remaining = 0;
  assert.deepEqual(externalCandidates([a, b, c], (o) => o === c), [a]);
});
