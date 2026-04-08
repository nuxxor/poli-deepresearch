import test from "node:test";
import assert from "node:assert/strict";

import { MarketContextSchema } from "@polymarket/deep-research-contracts";

import {
  extractOfficialDomainsForMarket,
  extractOfficialUrlsForMarket,
  extractResolutionFocusTopic,
  isOfficialUrlForMarket
} from "./official-sources.js";

const comparatorMarket = MarketContextSchema.parse({
  rawMarket: {
    id: "1",
    question: "Russia-Ukraine Ceasefire before GTA VI?",
    conditionId: "cond-1",
    slug: "russia-ukraine-ceasefire-before-gta-vi-554",
    description:
      "This market resolves YES if a Russia-Ukraine ceasefire happens before GTA VI releases. Rockstar Games and official government sources may be cited in the rules.",
    events: [
      {
        id: "event-1",
        category: "World"
      }
    ]
  },
  canonicalMarket: {
    marketId: "cond-1",
    eventId: "event-1",
    title: "Russia-Ukraine Ceasefire before GTA VI?",
    slug: "russia-ukraine-ceasefire-before-gta-vi-554",
    description:
      "This market resolves YES if a Russia-Ukraine ceasefire happens before GTA VI releases.",
    rulesText:
      "Official sources may include https://rockstargames.com/news for GTA VI release timing and official government or intergovernmental ceasefire announcements.",
    additionalContext: "Rockstar Games is only relevant as the comparator deadline.",
    endTimeUtc: "2026-12-31T00:00:00.000Z",
    category: "world",
    subcategory: "general",
    tags: [],
    relatedTags: [],
    resolutionArchetype: "official_announcement_by_deadline",
    officialSourceRequired: true,
    earlyNoAllowed: false,
    priceBlind: true
  },
  tokenIds: []
});

const sportsMarket = MarketContextSchema.parse({
  rawMarket: {
    id: "2",
    question: "Will the Carolina Hurricanes win the 2026 NHL Stanley Cup?",
    conditionId: "cond-2",
    slug: "will-the-carolina-hurricanes-win-the-2026-nhl-stanley-cup",
    description: "This market resolves YES if the Carolina Hurricanes win the 2026 Stanley Cup Finals.",
    events: [
      {
        id: "event-2",
        category: "Sports"
      }
    ]
  },
  canonicalMarket: {
    marketId: "cond-2",
    eventId: "event-2",
    title: "Will the Carolina Hurricanes win the 2026 NHL Stanley Cup?",
    slug: "will-the-carolina-hurricanes-win-the-2026-nhl-stanley-cup",
    description: "This market resolves YES if the Carolina Hurricanes win the 2026 Stanley Cup Finals.",
    rulesText: "Resolves according to the official NHL playoff bracket and final league result.",
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

test("extractResolutionFocusTopic keeps the leading claim instead of comparator deadline", () => {
  assert.equal(
    extractResolutionFocusTopic("Russia-Ukraine Ceasefire before GTA VI?"),
    "Russia-Ukraine Ceasefire"
  );
});

test("extractOfficialDomainsForMarket filters GTA VI comparator domains for world markets", () => {
  const domains = extractOfficialDomainsForMarket(comparatorMarket);

  assert.ok(domains.includes("president.gov.ua"));
  assert.ok(domains.includes("kremlin.ru"));
  assert.ok(!domains.includes("rockstargames.com"));
  assert.ok(!domains.includes("take2games.com"));
});

test("extractOfficialUrlsForMarket filters GTA VI comparator URLs for world markets", () => {
  const urls = extractOfficialUrlsForMarket(comparatorMarket);

  assert.deepEqual(urls, []);
});

test("extractOfficialDomainsForMarket includes league domains for NHL title-based markets", () => {
  const domains = extractOfficialDomainsForMarket(sportsMarket);

  assert.ok(domains.includes("nhl.com"));
  assert.ok(domains.includes("api-web.nhle.com"));
});

test("isOfficialUrlForMarket recognizes NHL league pages and API hosts", () => {
  assert.equal(isOfficialUrlForMarket("https://www.nhl.com/playoffs/2026/bracket", sportsMarket), true);
  assert.equal(isOfficialUrlForMarket("https://api-web.nhle.com/v1/playoff-bracket/2026", sportsMarket), true);
});
