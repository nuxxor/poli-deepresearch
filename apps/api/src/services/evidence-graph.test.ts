import test from "node:test";
import assert from "node:assert/strict";

import { MarketContextSchema, ProviderResearchJudgmentSchema } from "@polymarket/deep-research-contracts";

import { buildEvidenceGraphArtifacts } from "./evidence-graph.js";

test("buildEvidenceGraphArtifacts treats official direct citations as official-source presence even without extracted docs", () => {
  const market = MarketContextSchema.parse({
    rawMarket: {
      id: "1",
      question: "Will the Carolina Hurricanes win the 2026 NHL Stanley Cup?",
      conditionId: "cond-1",
      slug: "will-the-carolina-hurricanes-win-the-2026-nhl-stanley-cup",
      description: "Sports market."
    },
    canonicalMarket: {
      marketId: "cond-1",
      eventId: "event-1",
      title: "Will the Carolina Hurricanes win the 2026 NHL Stanley Cup?",
      slug: "will-the-carolina-hurricanes-win-the-2026-nhl-stanley-cup",
      description: "Sports market.",
      rulesText: "Resolves according to the official NHL playoff bracket.",
      endTimeUtc: "2026-06-30T00:00:00.000Z",
      category: "sports",
      subcategory: "general",
      tags: [],
      relatedTags: [],
      resolutionArchetype: "winner_of_event",
      officialSourceRequired: true,
      earlyNoAllowed: false,
      priceBlind: true
    },
    tokenIds: []
  });
  const directRun = ProviderResearchJudgmentSchema.parse({
    provider: "direct-official-feed",
    ok: true,
    parseMode: "direct",
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.8,
    reasoning: "Official NHL bracket checked.",
    why: "Official NHL bracket checked.",
    citations: [
      {
        title: "Official NHL bracket",
        url: "https://www.nhl.com/playoffs/2026/bracket",
        snippet: "Official NHL playoff bracket.",
        source: "official"
      }
    ],
    rawAnswer: "Official NHL bracket checked.",
    raw: {
      provider: "direct-official-feed",
      ok: true,
      query: "nhl bracket",
      durationMs: 0,
      resultCount: 1,
      results: [],
      meta: {}
    }
  });

  const artifacts = buildEvidenceGraphArtifacts({
    market,
    directRun,
    final: {
      resolutionStatus: "NOT_YET_RESOLVED",
      resolutionConfidence: 0.3,
      lean: "TOSSUP",
      leanConfidence: 0.2,
      yesCase: {
        headline: "YES",
        bullets: [{ text: "Could still win.", citationUrls: [] }]
      },
      noCase: {
        headline: "NO",
        bullets: [{ text: "Could still lose.", citationUrls: [] }]
      },
      historicalContext: {
        narrative: "No prior used.",
        priors: []
      },
      whatToWatch: [],
      modelTake: "Official bracket is the source of truth.",
      why: "Official bracket checked."
    },
    evidence: []
  });

  assert.equal(artifacts.sourceSummary.officialSourcePresent, true);
});
