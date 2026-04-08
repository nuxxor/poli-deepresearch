import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMarketLookupAttempts,
  buildRelatedSearchQueries,
  inferCategory,
  isRelatedCandidateRelevant,
  shouldKeepRelatedCandidate
} from "./polymarket.js";

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

test("buildRelatedSearchQueries prefers a multi-token phrase before single tokens", () => {
  assert.deepEqual(buildRelatedSearchQueries("Will OpenAI release GPT-6 before 2027?"), [
    "openai gpt",
    "openai",
    "gpt"
  ]);
});

test("isRelatedCandidateRelevant rejects generic search matches with no real entity overlap", () => {
  assert.equal(
    isRelatedCandidateRelevant(
      "Will Airbnb begin publicly trading before Jan 1, 2021?",
      "Will Kim Kardashian and Kanye West divorce before Jan 1, 2021?"
    ),
    false
  );
});

test("isRelatedCandidateRelevant keeps candidates that share a strong entity token", () => {
  assert.equal(
    isRelatedCandidateRelevant(
      "Will OpenAI release GPT-6 before 2027?",
      "Will OpenAI release GPT-5 before 2026?"
    ),
    true
  );
});

test("shouldKeepRelatedCandidate rejects same-event markets with no semantic overlap", () => {
  assert.equal(
    shouldKeepRelatedCandidate({
      currentTitle: "Russia-Ukraine Ceasefire before GTA VI?",
      currentCategory: "world",
      currentArchetype: "official_announcement_by_deadline",
      candidateTitle: "New Rihanna Album before GTA VI?",
      candidateCategory: "entertainment",
      candidateArchetype: "release_or_launch",
      sameEvent: true
    }),
    false
  );
});

test("shouldKeepRelatedCandidate keeps same-event markets that match category/archetype", () => {
  assert.equal(
    shouldKeepRelatedCandidate({
      currentTitle: "Russia-Ukraine Ceasefire before GTA VI?",
      currentCategory: "world",
      currentArchetype: "official_announcement_by_deadline",
      candidateTitle: "Will China invades Taiwan before GTA VI?",
      candidateCategory: "world",
      candidateArchetype: "official_announcement_by_deadline",
      sameEvent: true
    }),
    true
  );
});
