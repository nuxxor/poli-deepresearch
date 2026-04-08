import test from "node:test";
import assert from "node:assert/strict";

import type { Claim, EvidenceDoc, MarketContext, Opinion, ResolutionContract } from "@polymarket/deep-research-contracts";

import { deriveDecisiveEvidenceStatus, reconcileOpinionAgainstEvidence } from "./evidence-semantics.js";

function makeMarket(overrides: Partial<MarketContext["canonicalMarket"]> = {}): MarketContext {
  return {
    rawMarket: {
      id: "1",
      question: "Will Project Atlas launch before Jan 1, 2027?",
      conditionId: "cond-1",
      slug: "project-atlas-launch-before-2027",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.45", "0.55"],
      clobTokenIds: ["yes-1", "no-1"]
    },
    canonicalMarket: {
      marketId: "1",
      eventId: "event-1",
      title: "Will Project Atlas launch before Jan 1, 2027?",
      slug: "project-atlas-launch-before-2027",
      description: "Test description",
      rulesText: "Resolves according to official company release channels.",
      endTimeUtc: "2026-12-31T00:00:00.000Z",
      category: "technology",
      subcategory: "general",
      tags: [],
      relatedTags: [],
      resolutionArchetype: "release_or_launch",
      officialSourceRequired: true,
      earlyNoAllowed: false,
      priceBlind: true,
      ...overrides
    },
    tokenIds: ["yes-1", "no-1"]
  };
}

function makeOpinion(overrides: Partial<Opinion> = {}): Opinion {
  return {
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.52,
    lean: "LEAN_YES",
    leanConfidence: 0.78,
    yesCase: {
      headline: "YES case",
      bullets: [{ text: "Signals point to launch.", citationUrls: [] }]
    },
    noCase: {
      headline: "NO case",
      bullets: [{ text: "Delay risk remains.", citationUrls: [] }]
    },
    historicalContext: {
      narrative: "Comparable launches slip.",
      priors: []
    },
    whatToWatch: ["Official newsroom post"],
    modelTake: "The draft view leans yes.",
    why: "The draft view leans yes.",
    ...overrides
  };
}

function makeResolutionContract(overrides: Partial<ResolutionContract> = {}): ResolutionContract {
  return {
    subject: "Project Atlas",
    eventLabel: "Project Atlas launch before Jan 1, 2027",
    resolutionArchetype: "release_or_launch",
    comparator: "occurs",
    authorityKinds: ["company_ir", "official_statement"],
    officialSourceRequired: true,
    earlyNoAllowed: false,
    decisiveYesRule: "YES requires an official launch announcement from the company before the deadline.",
    decisiveNoRule: "NO requires the deadline to pass without an official launch announcement.",
    notes: [],
    ...overrides
  };
}

test("deriveDecisiveEvidenceStatus treats official unresolved claims as official_inconclusive", () => {
  const evidence: EvidenceDoc[] = [
    {
      docId: "doc-1",
      url: "https://company.example.com/news",
      canonicalUrl: "https://company.example.com/news",
      title: "Official note",
      sourceType: "official",
      observedAt: "2026-04-08T00:00:00.000Z",
      fetchedAt: "2026-04-08T00:00:00.000Z",
      retrievalChannel: "official",
      extractor: "parallel",
      authorityScore: 0.94,
      freshnessScore: 0.82,
      directnessScore: 0.86,
      contentMarkdown: "The company said it is preparing for launch."
    }
  ];
  const claims: Claim[] = [
    {
      claimId: "claim-1",
      docId: "doc-1",
      claimType: "release_or_launch",
      subject: "Project Atlas",
      predicate: "was officially reported as released or launched",
      object: "Preparing for launch",
      polarity: "supports_yes",
      confidence: 0.74,
      origin: "heuristic_official"
    }
  ];

  const status = deriveDecisiveEvidenceStatus({
    final: makeOpinion(),
    evidence,
    claims,
    sourceSummary: {
      officialSourcePresent: true,
      contradictionSourcePresent: false,
      averageScore: 0.82,
      countsBySourceType: { official: 1 },
      topSources: []
    }
  });

  assert.equal(status, "official_inconclusive");
});

test("deriveDecisiveEvidenceStatus requires contract-aligned official claims for decisive_yes", () => {
  const evidence: EvidenceDoc[] = [
    {
      docId: "doc-1",
      url: "https://company.example.com/news/atlas-update",
      canonicalUrl: "https://company.example.com/news/atlas-update",
      title: "Project Atlas preview update",
      sourceType: "official",
      observedAt: "2026-04-08T00:00:00.000Z",
      fetchedAt: "2026-04-08T00:00:00.000Z",
      retrievalChannel: "official",
      extractor: "parallel",
      authorityScore: 0.96,
      freshnessScore: 0.84,
      directnessScore: 0.9,
      contentMarkdown: "The company said Project Atlas is preparing for launch and is now available to customers."
    }
  ];
  const claims: Claim[] = [
    {
      claimId: "claim-1",
      docId: "doc-1",
      claimType: "release_or_launch",
      subject: "Project Atlas",
      predicate: "was officially reported as released or launched",
      object: "Project Atlas is now available to customers.",
      polarity: "supports_yes",
      confidence: 0.9,
      origin: "heuristic_official"
    }
  ];

  const status = deriveDecisiveEvidenceStatus({
    final: makeOpinion({ resolutionStatus: "RESOLVED_YES" }),
    evidence,
    claims,
    sourceSummary: {
      officialSourcePresent: true,
      contradictionSourcePresent: false,
      averageScore: 0.88,
      countsBySourceType: { official: 1 },
      topSources: []
    },
    resolutionContract: makeResolutionContract()
  });

  assert.equal(status, "decisive_yes");
});

test("deriveDecisiveEvidenceStatus does not treat misaligned official threshold evidence as decisive", () => {
  const evidence: EvidenceDoc[] = [
    {
      docId: "doc-1",
      url: "https://exchange.example.com/markets/btc",
      canonicalUrl: "https://exchange.example.com/markets/btc",
      title: "Bitcoin closes at $95,000",
      sourceType: "official",
      observedAt: "2026-04-08T00:00:00.000Z",
      fetchedAt: "2026-04-08T00:00:00.000Z",
      retrievalChannel: "official",
      extractor: "parallel",
      authorityScore: 0.98,
      freshnessScore: 0.86,
      directnessScore: 0.94,
      contentMarkdown: "Exchange close shows Bitcoin at 95,000 USD for the session."
    }
  ];
  const claims: Claim[] = [
    {
      claimId: "claim-1",
      docId: "doc-1",
      claimType: "numeric_threshold",
      subject: "Bitcoin",
      predicate: "was officially reported as meeting the threshold",
      object: "BTC reached 95,000 USD.",
      polarity: "supports_yes",
      confidence: 0.92,
      origin: "heuristic_official"
    }
  ];

  const status = deriveDecisiveEvidenceStatus({
    final: makeOpinion({ resolutionStatus: "RESOLVED_YES" }),
    evidence,
    claims,
    sourceSummary: {
      officialSourcePresent: true,
      contradictionSourcePresent: false,
      averageScore: 0.9,
      countsBySourceType: { official: 1 },
      topSources: []
    },
    resolutionContract: makeResolutionContract({
      subject: "Bitcoin",
      eventLabel: "Bitcoin hits 100k by Jan 7, 2025",
      resolutionArchetype: "numeric_threshold",
      comparator: "greater_than_or_equal",
      metricName: "Bitcoin price",
      thresholdValue: 100_000,
      thresholdUnit: "USD",
      authorityKinds: ["exchange_data"],
      decisiveYesRule: "YES requires Bitcoin to trade at or above 100,000 USD before the deadline.",
      decisiveNoRule: "NO requires the deadline to pass without Bitcoin trading at or above 100,000 USD."
    })
  });

  assert.equal(status, "official_inconclusive");
});

test("reconcileOpinionAgainstEvidence softens official-required drafts without decisive evidence", () => {
  const opinion = makeOpinion();
  const reconciled = reconcileOpinionAgainstEvidence({
    market: makeMarket(),
    opinion,
    evidence: [],
    claims: [],
    sourceSummary: {
      officialSourcePresent: false,
      contradictionSourcePresent: false,
      averageScore: 0,
      countsBySourceType: {},
      topSources: []
    }
  });

  assert.equal(reconciled.opinion.lean, "TOSSUP");
  assert.ok(reconciled.opinion.leanConfidence <= 0.52);
  assert.ok(reconciled.notes.includes("evidence_reconcile_official_missing"));
});
