import test from "node:test";
import assert from "node:assert/strict";

import { MarketContextSchema } from "@polymarket/deep-research-contracts";

import { tryResolveDirectOfficialMarket } from "./direct-resolver.js";

test("tryResolveDirectOfficialMarket resolves closed binary Polymarket markets from settled outcome prices", async () => {
  const market = MarketContextSchema.parse({
    rawMarket: {
      id: "1",
      question: "Will Bitcoin hit $100k by tomorrow?",
      conditionId: "cond-1",
      slug: "will-bitcoin-hit-100k-by-tomorrow",
      description: "Binary market.",
      outcomes: ["Yes", "No"],
      outcomePrices: ["1", "0"],
      closed: true,
      active: true
    },
    canonicalMarket: {
      marketId: "cond-1",
      eventId: "event-1",
      title: "Will Bitcoin hit $100k by tomorrow?",
      slug: "will-bitcoin-hit-100k-by-tomorrow",
      description: "Binary market.",
      rulesText: "Resolves YES if Bitcoin hits 100k before the deadline.",
      endTimeUtc: "2025-01-07T00:00:00.000Z",
      category: "crypto",
      subcategory: "general",
      tags: [],
      relatedTags: [],
      resolutionArchetype: "numeric_threshold",
      officialSourceRequired: true,
      earlyNoAllowed: false,
      priceBlind: true
    },
    tokenIds: []
  });

  const resolution = await tryResolveDirectOfficialMarket(market);

  assert.ok(resolution);
  assert.equal(resolution.primary.resolutionStatus, "RESOLVED_YES");
  assert.equal(resolution.primary.parseMode, "direct");
  assert.match(resolution.primary.why ?? "", /closed and .* settles?/i);
});
