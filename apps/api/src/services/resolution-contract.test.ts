import test from "node:test";
import assert from "node:assert/strict";

import type { MarketContext } from "@polymarket/deep-research-contracts";

import { resolveAppliedPolicy } from "./policies.js";
import { buildResolutionContract } from "./resolution-contract.js";

function makeMarketContext(
  overrides: Partial<MarketContext["canonicalMarket"]>
): MarketContext {
  return {
    rawMarket: {
      id: "1",
      question: overrides.title ?? "Test market?",
      conditionId: "cond-1",
      slug: overrides.slug ?? "test-market",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.42", "0.58"],
      clobTokenIds: ["yes-1", "no-1"]
    },
    canonicalMarket: {
      marketId: "1",
      eventId: "event-1",
      title: overrides.title ?? "Test market?",
      slug: overrides.slug ?? "test-market",
      description: overrides.description ?? "Test description",
      rulesText: overrides.rulesText ?? "Resolves according to the official source.",
      additionalContext: overrides.additionalContext,
      endTimeUtc: overrides.endTimeUtc ?? "2026-12-31T00:00:00.000Z",
      resolutionSourceText: overrides.resolutionSourceText,
      category: overrides.category ?? "world",
      subcategory: overrides.subcategory ?? "general",
      tags: overrides.tags ?? [],
      relatedTags: overrides.relatedTags ?? [],
      resolutionArchetype: overrides.resolutionArchetype ?? "official_announcement_by_deadline",
      officialSourceRequired: overrides.officialSourceRequired ?? true,
      earlyNoAllowed: overrides.earlyNoAllowed ?? false,
      priceBlind: true
    },
    tokenIds: ["yes-1", "no-1"]
  };
}

test("buildResolutionContract keeps the primary geopolitical claim for comparator markets", () => {
  const market = makeMarketContext({
    title: "Will Russia-Ukraine ceasefire happen before GTA VI?",
    category: "world",
    resolutionArchetype: "official_announcement_by_deadline",
    rulesText: "This market resolves YES if an official ceasefire agreement is confirmed before the deadline."
  });

  const contract = buildResolutionContract(market, resolveAppliedPolicy(market));

  assert.equal(contract.subject, "Russia-Ukraine ceasefire happen");
  assert.equal(contract.comparator, "official_confirmation");
  assert.ok(contract.authorityKinds.includes("government"));
  assert.ok(contract.authorityKinds.includes("official_statement"));
});

test("buildResolutionContract extracts threshold semantics for numeric markets", () => {
  const market = makeMarketContext({
    title: "Will CPI be above 3.0% in June 2026?",
    category: "macro",
    resolutionArchetype: "numeric_threshold",
    rulesText: "Resolves YES if the official CPI release prints above 3.0 percent for June 2026."
  });

  const contract = buildResolutionContract(market, resolveAppliedPolicy(market));

  assert.equal(contract.comparator, "greater_than");
  assert.equal(contract.thresholdValue, 3);
  assert.equal(contract.thresholdUnit, "%");
  assert.ok(contract.authorityKinds.includes("economic_release"));
  assert.match(contract.metricName ?? "", /CPI/i);
});

test("buildResolutionContract parses shorthand numeric thresholds like 100k", () => {
  const market = makeMarketContext({
    title: "Will Bitcoin hit 100k by July 1, 2026?",
    category: "crypto",
    resolutionArchetype: "numeric_threshold",
    rulesText: "Resolves YES if BTC trades at or above 100k before the deadline."
  });

  const contract = buildResolutionContract(market, resolveAppliedPolicy(market));

  assert.equal(contract.comparator, "greater_than_or_equal");
  assert.equal(contract.thresholdValue, 100_000);
  assert.equal(contract.thresholdUnit, undefined);
});
