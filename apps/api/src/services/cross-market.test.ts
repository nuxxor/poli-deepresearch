import test from "node:test";
import assert from "node:assert/strict";

import { blendCrossMarketRelations, rankCrossMarketCandidates } from "./cross-market.js";

test("rankCrossMarketCandidates prefers shared entity and category overlap", () => {
  const ranked = rankCrossMarketCandidates(
    "Will OpenAI release GPT-6 before 2027?",
    "technology",
    "release_or_launch",
    [
      {
        slug: "openai-release-gpt-5-before-2026",
        title: "Will OpenAI release GPT-5 before 2026?",
        category: "technology",
        resolutionArchetype: "release_or_launch"
      },
      {
        slug: "fed-cut-rates-50-bps",
        title: "Will the Fed cut rates by 50 bps?",
        category: "macro",
        resolutionArchetype: "numeric_threshold"
      }
    ]
  );

  assert.equal(ranked[0]?.slug, "openai-release-gpt-5-before-2026");
  assert.ok((ranked[0]?.overlapScore ?? 0) > (ranked[1]?.overlapScore ?? 0));
  assert.match(ranked[0]?.why ?? "", /shared tokens|same category|same resolution archetype/);
});

test("blendCrossMarketRelations enriches live matches with archived thesis data", () => {
  const blended = blendCrossMarketRelations(
    "Will OpenAI release GPT-6 before 2027?",
    "technology",
    "release_or_launch",
    [
      {
        slug: "openai-release-gpt-5-before-2026",
        title: "Will OpenAI release GPT-5 before 2026?",
        category: "technology",
        resolutionArchetype: "release_or_launch"
      }
    ],
    [
      {
        slug: "openai-release-gpt-5-before-2026",
        title: "Will OpenAI release GPT-5 before 2026?",
        category: "technology",
        resolutionArchetype: "release_or_launch",
        lean: "LEAN_YES",
        leanConfidence: 0.71,
        resolutionStatus: "NOT_YET_RESOLVED",
        why: "Archived thesis already mapped the official launch cadence."
      }
    ],
    4
  );

  assert.equal(blended[0]?.slug, "openai-release-gpt-5-before-2026");
  assert.equal(blended[0]?.lean, "LEAN_YES");
  assert.equal(blended[0]?.leanConfidence, 0.71);
  assert.match(blended[0]?.why ?? "", /archived thesis/);
});

test("rankCrossMarketCandidates discounts date-only overlap and generic launch wording", () => {
  const ranked = rankCrossMarketCandidates(
    "Will Airbnb begin publicly trading before Jan 1, 2021?",
    "business",
    "release_or_launch",
    [
      {
        slug: "will-coinbase-begin-publicly-trading-before-jan-1-2021",
        title: "Will Coinbase begin publicly trading before Jan 1, 2021?",
        category: "business",
        resolutionArchetype: "release_or_launch"
      },
      {
        slug: "will-kim-kardashian-and-kanye-west-divorce-before-jan-1-2021",
        title: "Will Kim Kardashian and Kanye West divorce before Jan 1, 2021?",
        category: "legal",
        resolutionArchetype: "legal_outcome"
      }
    ]
  );

  const coinbase = ranked.find((item) => item.slug === "will-coinbase-begin-publicly-trading-before-jan-1-2021");
  const kim = ranked.find((item) => item.slug === "will-kim-kardashian-and-kanye-west-divorce-before-jan-1-2021");

  assert.equal(coinbase?.relation, "same_archetype");
  assert.ok((coinbase?.overlapScore ?? 0) > 0);
  assert.ok((kim?.overlapScore ?? 0) < (coinbase?.overlapScore ?? 0));
  assert.notEqual(kim?.relation, "same_entity");
});
