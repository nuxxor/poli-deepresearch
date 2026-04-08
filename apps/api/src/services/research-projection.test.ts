import test from "node:test";
import assert from "node:assert/strict";

import type { Claim, MarketContext, MarketResearchResponse, Opinion, ProviderResearchJudgment } from "@polymarket/deep-research-contracts";

import { resolveAppliedPolicy } from "./policies.js";
import { buildResearchProductResponse, buildResearchGuardrails, withResearchPresentation } from "./research-projection.js";

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
      outcomePrices: ["0.41", "0.59"],
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
      category: overrides.category ?? "business",
      subcategory: overrides.subcategory ?? "general",
      tags: overrides.tags ?? [],
      relatedTags: overrides.relatedTags ?? [],
      resolutionArchetype: overrides.resolutionArchetype ?? "release_or_launch",
      officialSourceRequired: overrides.officialSourceRequired ?? true,
      earlyNoAllowed: overrides.earlyNoAllowed ?? false,
      priceBlind: true
    },
    tokenIds: ["yes-1", "no-1"]
  };
}

function makeOpinion(overrides: Partial<Opinion> = {}): Opinion {
  return {
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.34,
    lean: "LEAN_YES",
    leanConfidence: 0.76,
    yesCase: {
      headline: "YES case",
      bullets: [{ text: "Signal points to launch.", citationUrls: [] }]
    },
    noCase: {
      headline: "NO case",
      bullets: [{ text: "Delay risk remains.", citationUrls: [] }]
    },
    historicalContext: {
      narrative: "Comparable launches often slip.",
      priors: []
    },
    whatToWatch: ["Official newsroom post"],
    modelTake: "The setup leans yes but needs official confirmation.",
    why: "Evidence leans yes, but the official confirmation is still missing.",
    ...overrides
  };
}

function makeResponse(): MarketResearchResponse {
  const market = makeMarketContext({
    title: "Will Project Atlas launch before Jan 1, 2027?",
    slug: "project-atlas-launch-before-2027",
    category: "technology",
    resolutionArchetype: "release_or_launch"
  });

  return {
    generatedAt: "2026-04-08T00:00:00.000Z",
    run: {
      runId: "run-1",
      runType: "deep_refresh",
      createdAt: "2026-04-08T00:00:00.000Z"
    },
    market,
    appliedPolicy: resolveAppliedPolicy(market),
    cache: {
      hit: false,
      key: "cache-key",
      savedAt: "2026-04-08T00:00:00.000Z",
      expiresAt: "2026-04-08T00:05:00.000Z"
    },
    strategy: {
      finalMode: "local_floor",
      ranParallel: false,
      ranXai: false,
      ranDirect: false,
      ranLocalOpinion: true,
      notes: ["local_only_path"]
    },
    localOpinionRun: {
      provider: "ollama-local-opinion",
      ok: true,
      parseMode: "json",
      opinion: makeOpinion(),
      resolutionStatus: "NOT_YET_RESOLVED",
      resolutionConfidence: 0.34,
      reasoning: "Local synthesis",
      why: "Local synthesis",
      citations: [],
      rawAnswer: "{}",
      raw: {
        provider: "ollama-local-opinion",
        ok: true,
        query: "atlas launch",
        durationMs: 14,
        resultCount: 0,
        results: [],
        meta: {}
      }
    },
    final: makeOpinion(),
    citations: [
      {
        title: "Unofficial teaser",
        url: "https://example.com/teaser",
        snippet: "Teaser coverage"
      }
    ],
    evidence: [
      {
        docId: "doc-1",
        url: "https://example.com/teaser",
        canonicalUrl: "https://example.com/teaser",
        title: "Unofficial teaser",
        sourceType: "major_media",
        observedAt: "2026-04-08T00:00:00.000Z",
        fetchedAt: "2026-04-08T00:00:00.000Z",
        retrievalChannel: "brave",
        extractor: "parallel",
        authorityScore: 0.48,
        freshnessScore: 0.71,
        directnessScore: 0.44,
        contentMarkdown: "Rumors continue."
      }
    ],
    claims: [],
    forecastClaims: [],
    sourceSummary: {
      officialSourcePresent: false,
      contradictionSourcePresent: false,
      averageScore: 0.54,
      countsBySourceType: {
        major_media: 1
      },
      topSources: [
        {
          docId: "doc-1",
          canonicalUrl: "https://example.com/teaser",
          title: "Unofficial teaser",
          sourceType: "major_media",
          score: 0.54,
          authorityScore: 0.48,
          freshnessScore: 0.71,
          directnessScore: 0.44,
          stance: "neutral",
          citedByProviders: [],
          isOfficial: false
        }
      ]
    },
    evidenceGraph: {
      nodes: [],
      edges: []
    },
    probabilisticForecast: {
      priorYesProbability: 0.5,
      posteriorYesProbability: 0.74,
      calibratedYesProbability: 0.73,
      calibratedNoProbability: 0.27,
      lean: "LEAN_YES",
      confidence: 0.78,
      notes: ["providers=0"],
      components: []
    },
    adversarialReview: {
      status: "applied",
      changedOpinion: false,
      notes: ["opinion_confirmed"]
    },
    calibrationSummary: {
      status: "insufficient",
      sampleSize: 0,
      bucketAccuracy: 0.5,
      adjustment: 0,
      notes: ["no_labeled_history"]
    },
    costs: {
      parallelUsd: 0,
      xaiUsd: 0,
      directUsd: 0,
      extractionUsd: 0,
      signalsUsd: 0,
      totalUsd: 0
    },
    latencies: {
      parallelMs: 0,
      xaiMs: 0,
      directMs: 0,
      extractionMs: 0,
      signalsMs: 0,
      totalMs: 25
    }
  };
}

function makeDirectRun(overrides: Partial<ProviderResearchJudgment> = {}): ProviderResearchJudgment {
  return {
    provider: "direct-official-feed",
    ok: true,
    parseMode: "direct",
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.61,
    reasoning: "Official source checked directly.",
    why: "Official source checked directly.",
    citations: [],
    rawAnswer: "direct result",
    raw: {
      provider: "direct-official-feed",
      ok: true,
      query: "atlas launch",
      durationMs: 5,
      resultCount: 0,
      results: [],
      meta: {}
    },
    ...overrides
  };
}

test("buildResearchGuardrails abstains when an official-source market is local-only and under-evidenced", () => {
  const response = makeResponse();

  const guardrails = buildResearchGuardrails(response);

  assert.equal(guardrails.runMode, "local_only");
  assert.equal(guardrails.degraded, true);
  assert.equal(guardrails.actionability, "abstain");
  assert.ok(guardrails.reasons.includes("local_only_mode"));
  assert.ok(guardrails.reasons.includes("official_source_missing"));
  assert.equal(guardrails.decisiveEvidenceStatus, "secondary_only");
  assert.equal(guardrails.confidenceCapApplied, 0.55);
});

test("withResearchPresentation applies guardrails and produces a narrower product projection", () => {
  const response = makeResponse();

  const enriched = withResearchPresentation(response);
  const product = buildResearchProductResponse(enriched);

  assert.equal(enriched.researchView?.lean, "LEAN_YES");
  assert.equal(enriched.guardrails?.actionability, "abstain");
  assert.ok((enriched.researchView?.leanConfidence ?? 0) <= 0.55);
  assert.equal(product.market.title, response.market.canonicalMarket.title);
  assert.equal(product.guardrails.actionability, "abstain");
  assert.equal(product.narrative.watchItems[0], "Official newsroom post");
  assert.equal("strategy" in product, false);
});

test("buildResearchGuardrails treats official unresolved claims as official_inconclusive", () => {
  const response = makeResponse();
  response.strategy = {
    finalMode: "dual_synthesized",
    ranParallel: true,
    ranXai: false,
    ranDirect: true,
    ranLocalOpinion: false,
    notes: []
  };
  response.evidence = [
    {
      docId: "doc-official",
      url: "https://company.example.com/newsroom/atlas",
      canonicalUrl: "https://company.example.com/newsroom/atlas",
      title: "Official newsroom update",
      sourceType: "official",
      observedAt: "2026-04-08T00:00:00.000Z",
      fetchedAt: "2026-04-08T00:00:00.000Z",
      retrievalChannel: "official",
      extractor: "parallel",
      authorityScore: 0.95,
      freshnessScore: 0.8,
      directnessScore: 0.88,
      contentMarkdown: "The company continues preparing for launch."
    }
  ];
  response.sourceSummary = {
    ...response.sourceSummary!,
    officialSourcePresent: true
  };
  const claims: Claim[] = [
    {
      claimId: "claim-official",
      docId: "doc-official",
      claimType: "release_or_launch",
      subject: "Project Atlas",
      predicate: "was officially reported as released or launched",
      object: "The company continues preparing for launch.",
      polarity: "supports_yes",
      confidence: 0.72,
      origin: "heuristic_official"
    }
  ];
  response.claims = claims;
  response.forecastClaims = claims;

  const guardrails = buildResearchGuardrails(response);

  assert.equal(guardrails.decisiveEvidenceStatus, "official_inconclusive");
  assert.equal(guardrails.actionability, "monitor");
  assert.ok(guardrails.reasons.includes("official_evidence_inconclusive"));
});

test("buildResearchGuardrails marks direct resolved official checks as decisive", () => {
  const response = makeResponse();
  response.directRun = makeDirectRun({
    resolutionStatus: "RESOLVED_YES",
    resolutionConfidence: 0.97
  });
  response.final = makeOpinion({
    resolutionStatus: "RESOLVED_YES",
    resolutionConfidence: 0.97,
    lean: "STRONG_YES",
    leanConfidence: 0.93,
    why: "Official source confirms the outcome."
  });
  response.sourceSummary = {
    ...response.sourceSummary!,
    officialSourcePresent: true
  };

  const guardrails = buildResearchGuardrails(response);

  assert.equal(guardrails.decisiveEvidenceStatus, "decisive_yes");
  assert.equal(guardrails.actionability, "high_conviction");
});

test("buildResearchGuardrails keeps resolved local-only outputs cautious without decisive evidence", () => {
  const response = makeResponse();
  response.final = makeOpinion({
    resolutionStatus: "RESOLVED_YES",
    resolutionConfidence: 0.91,
    lean: "STRONG_YES",
    leanConfidence: 0.91,
    why: "Model thinks the event happened."
  });
  response.sourceSummary = {
    ...response.sourceSummary!,
    officialSourcePresent: false
  };

  const guardrails = buildResearchGuardrails(response);

  assert.equal(guardrails.actionability, "abstain");
  assert.ok(guardrails.reasons.includes("official_source_missing"));
});
