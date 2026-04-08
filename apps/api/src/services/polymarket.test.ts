import test from "node:test";
import assert from "node:assert/strict";

import { buildMarketLookupAttempts, inferCategory, inferResolutionArchetype } from "./polymarket.js";

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

test("inferCategory recognizes UFC markets as sports", () => {
  const category = inferCategory(
    "Will Khabib win his UFC 254 fight?",
    "This market resolves to Yes if Khabib wins the UFC 254 main event.",
    "Entertainment"
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

test("inferResolutionArchetype maps charge-filed markets to legal outcomes", () => {
  const archetype = inferResolutionArchetype(
    "Will there be a federal charge filed against Hunter Biden before 2021?",
    "This market resolves based on whether a federal criminal charge is officially filed before the deadline."
  );

  assert.equal(archetype, "legal_outcome");
});

test("inferResolutionArchetype maps win-by-points markets to numeric thresholds", () => {
  const archetype = inferResolutionArchetype(
    "Will Trump win Florida by 8 points?",
    "This market resolves to Yes if Trump wins Florida by at least 8 percentage points."
  );

  assert.equal(archetype, "numeric_threshold");
});

test("buildMarketLookupAttempts retries closed markets after the open lookup", () => {
  const attempts = buildMarketLookupAttempts({ slug: "historical-market", limit: "1" });

  assert.deepEqual(attempts, [
    { slug: "historical-market", limit: "1" },
    { slug: "historical-market", limit: "1", closed: "true" }
  ]);
});
