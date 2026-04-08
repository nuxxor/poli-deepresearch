import test from "node:test";
import assert from "node:assert/strict";

import type { Claim, EvidenceDoc, Opinion, ProviderResearchJudgment } from "@polymarket/deep-research-contracts";

import { applyForecastToOpinion, buildProbabilisticForecast } from "./probabilistic-forecast.js";

const baseOpinion: Opinion = {
  resolutionStatus: "NOT_YET_RESOLVED",
  resolutionConfidence: 0.45,
  lean: "LEAN_YES",
  leanConfidence: 0.62,
  yesCase: {
    headline: "Reasons YES",
    bullets: [{ text: "Company has already announced launch timing.", citationUrls: [] }]
  },
  noCase: {
    headline: "Reasons NO",
    bullets: [{ text: "Launch could still slip.", citationUrls: [] }]
  },
  historicalContext: {
    narrative: "Comparable launches often slip by one quarter.",
    priors: []
  },
  whatToWatch: ["Official launch post"],
  modelTake: "The launch path looks real but not fully de-risked.",
  why: "Current evidence leans yes because official launch language is concrete."
};

const providerJudgments: ProviderResearchJudgment[] = [
  {
    provider: "parallel-chat-core",
    ok: true,
    parseMode: "json",
    opinion: baseOpinion,
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.45,
    reasoning: baseOpinion.modelTake,
    why: baseOpinion.why,
    citations: [],
    rawAnswer: "{}",
    raw: {
      provider: "parallel-chat-core",
      ok: true,
      query: "launch",
      durationMs: 10,
      resultCount: 0,
      results: [],
      meta: {}
    }
  },
  {
    provider: "direct-official-feed",
    ok: true,
    parseMode: "direct",
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.51,
    reasoning: "Official investor page now lists launch day.",
    why: "Direct source confirms launch scheduling.",
    citations: [],
    rawAnswer: "launch day listed",
    raw: {
      provider: "direct-official-feed",
      ok: true,
      query: "launch",
      durationMs: 4,
      resultCount: 0,
      results: [],
      meta: {}
    }
  }
];

const evidence: EvidenceDoc[] = [
  {
    docId: "doc-1",
    url: "https://example.com/launch",
    canonicalUrl: "https://example.com/launch",
    title: "Launch page",
    sourceType: "official",
    observedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    retrievalChannel: "official",
    extractor: "parallel",
    authorityScore: 0.95,
    freshnessScore: 0.8,
    directnessScore: 0.92,
    language: "en",
    contentMarkdown: "Launch is scheduled."
  }
];

const claims: Claim[] = [
  {
    claimId: "claim-1",
    docId: "doc-1",
    claimType: "release_or_launch",
    subject: "Company",
    predicate: "announced",
    object: "launch date",
    polarity: "supports_yes",
    confidence: 0.84
  }
];

test("buildProbabilisticForecast strengthens aligned YES evidence", () => {
  const forecast = buildProbabilisticForecast({
    opinion: baseOpinion,
    providerJudgments,
    claims,
    evidence
  });

  assert.equal(forecast.lean, "LEAN_YES");
  assert.ok(forecast.posteriorYesProbability > 0.65);
  assert.ok(forecast.components.some((component) => component.channel === "claim"));
  assert.ok(forecast.components.some((component) => component.channel === "provider"));

  const revised = applyForecastToOpinion(baseOpinion, forecast);
  assert.equal(revised.lean, forecast.lean);
  assert.equal(revised.leanConfidence, forecast.confidence);
  assert.match(revised.why, /Probabilistic aggregation/);
});
