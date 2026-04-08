import test from "node:test";
import assert from "node:assert/strict";

import { buildMarketLookupAttempts, inferCategory } from "./polymarket.js";

test("inferCategory does not misclassify Coinbase listing markets as sports", () => {
  const category = inferCategory(
    "Will Coinbase begin publicly trading before Jan 1, 2021?",
    "This market resolves to Yes if Coinbase starts publicly trading on NASDAQ or NYSE before January 1st 2021.",
    "Crypto"
  );

  assert.equal(category, "business");
});

test("inferCategory still recognizes obvious sports markets", () => {
  const category = inferCategory(
    "Will the Warriors win the championship?",
    "This market resolves to Yes if the Warriors win the NBA Finals.",
    "Sports"
  );

  assert.equal(category, "sports");
});

test("inferCategory normalizes common fallback aliases", () => {
  const category = inferCategory(
    "Will Project Atlas ship this quarter?",
    "Resolution depends on whether the team announces a launch this quarter.",
    "Tech"
  );

  assert.equal(category, "technology");
});

test("buildMarketLookupAttempts retries closed markets for historical slug lookups", () => {
  assert.deepEqual(buildMarketLookupAttempts({ slug: "example-market", limit: "1" }), [
    { slug: "example-market", limit: "1" },
    { slug: "example-market", limit: "1", closed: "true" }
  ]);
});

test("buildMarketLookupAttempts does not duplicate explicit closed lookups", () => {
  assert.deepEqual(buildMarketLookupAttempts({ slug: "example-market", limit: "1", closed: "true" }), [
    { slug: "example-market", limit: "1", closed: "true" }
  ]);
});
