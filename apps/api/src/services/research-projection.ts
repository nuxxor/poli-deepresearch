import {
  MarketOddsSchema,
  MarketResearchResponseSchema,
  ProductMarketSummarySchema,
  ResearchGuardrailsSchema,
  ResearchNarrativeSchema,
  ResearchProductResponseSchema,
  ResearchViewSchema,
  type MarketContext,
  type MarketOdds,
  type MarketResearchResponse,
  type ResearchGuardrails,
  type ResearchProductResponse,
  type ResearchView,
  type DecisiveEvidenceStatus
} from "@polymarket/deep-research-contracts";

import { probabilityToLean } from "./probabilistic-forecast.js";
import { buildResolutionContract } from "./resolution-contract.js";

export function withResearchPresentation(response: MarketResearchResponse): MarketResearchResponse {
  const marketOdds = response.marketOdds ?? buildMarketOdds(response.market);
  const resolutionContract =
    response.resolutionContract ?? buildResolutionContract(response.market, response.appliedPolicy);
  const guardrails = response.guardrails ?? buildResearchGuardrails(response);
  const researchView = response.researchView ?? buildResearchView(response, marketOdds, guardrails);

  return MarketResearchResponseSchema.parse({
    ...response,
    marketOdds,
    resolutionContract,
    guardrails,
    researchView
  });
}

export function buildResearchProductResponse(response: MarketResearchResponse): ResearchProductResponse {
  const enriched = withResearchPresentation(response);

  return ResearchProductResponseSchema.parse({
    generatedAt: enriched.generatedAt,
    run: enriched.run,
    market: ProductMarketSummarySchema.parse({
      marketId: enriched.market.canonicalMarket.marketId,
      slug: enriched.market.canonicalMarket.slug,
      title: enriched.market.canonicalMarket.title,
      category: enriched.market.canonicalMarket.category,
      resolutionArchetype: enriched.market.canonicalMarket.resolutionArchetype,
      endTimeUtc: enriched.market.canonicalMarket.endTimeUtc,
      officialSourceRequired: enriched.market.canonicalMarket.officialSourceRequired,
      earlyNoAllowed: enriched.market.canonicalMarket.earlyNoAllowed
    }),
    resolutionContract: enriched.resolutionContract,
    final: enriched.final,
    marketOdds: enriched.marketOdds,
    guardrails: enriched.guardrails,
    researchView: enriched.researchView,
    narrative: buildResearchNarrative(enriched),
    topSources: (enriched.sourceSummary?.topSources ?? []).slice(0, 5),
    citations: enriched.citations.slice(0, 5),
    crossMarketContext: enriched.crossMarketContext,
    adversarialReview: enriched.adversarialReview,
    probabilisticForecast: enriched.probabilisticForecast,
    calibrationSummary: enriched.calibrationSummary
  });
}

export function buildResearchGuardrails(response: MarketResearchResponse): ResearchGuardrails {
  const reasons = new Set<string>();
  const runMode = inferRunMode(response);
  const decisiveEvidenceStatus = response.decisiveEvidenceStatus ?? deriveDecisiveEvidenceStatus(response);

  if (runMode === "local_only") {
    reasons.add("local_only_mode");
  }
  if (response.market.canonicalMarket.officialSourceRequired && !response.sourceSummary?.officialSourcePresent) {
    reasons.add("official_source_missing");
  }
  if ((response.evidence?.length ?? 0) < 2) {
    reasons.add("low_evidence_count");
  }
  if (response.sourceSummary?.contradictionSourcePresent) {
    reasons.add("contradictory_evidence_present");
  }
  if (response.calibrationSummary?.status === "insufficient") {
    reasons.add("calibration_insufficient");
  }
  if (response.calibrationSummary?.status === "weak_empirical") {
    reasons.add("calibration_weak_empirical");
  }
  if (response.adversarialReview?.status === "failed") {
    reasons.add("adversarial_review_failed");
  }
  if (response.claimExtractionStatus === "failed") {
    reasons.add("claim_extraction_failed");
  }
  if (decisiveEvidenceStatus === "secondary_only") {
    reasons.add("secondary_sources_only");
  }
  if (decisiveEvidenceStatus === "official_inconclusive") {
    reasons.add("official_evidence_inconclusive");
  }
  if (decisiveEvidenceStatus === "conflicting") {
    reasons.add("decisive_evidence_conflicting");
  }

  let confidenceCapApplied: number | undefined;
  confidenceCapApplied = applyConfidenceCap(confidenceCapApplied, runMode === "local_only" ? 0.58 : undefined);
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("official_source_missing") ? 0.55 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("low_evidence_count") ? 0.6 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("contradictory_evidence_present") ? 0.57 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("adversarial_review_failed") ? 0.62 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("calibration_insufficient") ? 0.68 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("calibration_weak_empirical") ? 0.66 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("official_evidence_inconclusive") ? 0.64 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("secondary_sources_only") ? 0.55 : undefined
  );
  confidenceCapApplied = applyConfidenceCap(
    confidenceCapApplied,
    reasons.has("decisive_evidence_conflicting") ? 0.53 : undefined
  );

  const currentConfidence = response.probabilisticForecast?.confidence ?? response.final.leanConfidence;
  const effectiveConfidence = confidenceCapApplied == null
    ? currentConfidence
    : Math.min(currentConfidence, confidenceCapApplied);

  const actionability =
    response.final.resolutionStatus !== "NOT_YET_RESOLVED"
      ? "high_conviction"
      : response.market.canonicalMarket.officialSourceRequired &&
          (decisiveEvidenceStatus === "secondary_only" || decisiveEvidenceStatus === "none")
        ? "abstain"
        : reasons.has("official_source_missing") || reasons.has("local_only_mode")
        ? "abstain"
        : decisiveEvidenceStatus === "conflicting" || decisiveEvidenceStatus === "official_inconclusive"
          ? "monitor"
        : effectiveConfidence >= 0.72 && !reasons.has("contradictory_evidence_present")
          ? "high_conviction"
          : reasons.size >= 3
            ? "abstain"
            : "monitor";

  return ResearchGuardrailsSchema.parse({
    runMode,
    degraded: reasons.size > 0,
    reasons: [...reasons],
    actionability,
    confidenceCapApplied,
    decisiveEvidenceStatus,
    claimExtractionStatus: response.claimExtractionStatus
  });
}

export function buildMarketOdds(market: MarketContext): MarketOdds {
  const outcomes = parseStringArray(market.rawMarket.outcomes);
  const prices = parseNumberArray(market.rawMarket.outcomePrices);

  let yesProbability: number | undefined;
  let noProbability: number | undefined;

  outcomes.forEach((outcome, index) => {
    const price = prices[index];
    if (price == null) {
      return;
    }

    if (/^yes$/i.test(outcome)) {
      yesProbability = clamp01(price);
    }

    if (/^no$/i.test(outcome)) {
      noProbability = clamp01(price);
    }
  });

  if (yesProbability == null && noProbability == null && prices.length >= 2) {
    const first = prices[0];
    const second = prices[1];
    if (first != null && second != null) {
      yesProbability = clamp01(first);
      noProbability = clamp01(second);
    }
  } else if (yesProbability != null && noProbability == null) {
    noProbability = clamp01(1 - yesProbability);
  } else if (noProbability != null && yesProbability == null) {
    yesProbability = clamp01(1 - noProbability);
  }

  return MarketOddsSchema.parse({
    source: "polymarket",
    yesProbability,
    noProbability
  });
}

export function buildResearchView(
  response: MarketResearchResponse,
  marketOdds: MarketOdds,
  guardrails: ResearchGuardrails
): ResearchView {
  const opinion = response.final;
  const probabilisticForecast = response.probabilisticForecast;
  const probabilitySource = probabilisticForecast
    ? response.calibrationSummary?.status === "empirical" || response.calibrationSummary?.status === "weak_empirical"
      ? "calibrated_forecast"
      : "probabilistic_forecast"
    : "opinion";

  const rawSystemYesProbability = probabilisticForecast
    ? probabilisticForecast.calibratedYesProbability
    : leanToProbability(opinion.lean, opinion.leanConfidence);
  const systemYesProbability = guardrails.confidenceCapApplied == null
    ? rawSystemYesProbability
    : capProbability(rawSystemYesProbability, guardrails.confidenceCapApplied);
  const systemNoProbability = clampProbability(1 - systemYesProbability);
  const confidenceValue = guardrails.confidenceCapApplied == null
    ? probabilisticForecast?.confidence ?? opinion.leanConfidence
    : Math.min(probabilisticForecast?.confidence ?? opinion.leanConfidence, guardrails.confidenceCapApplied);

  const confidenceLabel: ResearchView["confidenceLabel"] =
    confidenceValue >= 0.75 ? "high" : confidenceValue >= 0.5 ? "medium" : "low";

  const marketYesProbability = marketOdds.yesProbability;
  const marketNoProbability = marketOdds.noProbability;
  const yesEdge = marketYesProbability != null ? roundDelta(systemYesProbability - marketYesProbability) : undefined;
  const noEdge = marketNoProbability != null ? roundDelta(systemNoProbability - marketNoProbability) : undefined;

  const rationale = [
    opinion.why,
    response.calibrationSummary?.status &&
    response.calibrationSummary.status !== "insufficient" &&
    response.calibrationSummary.status !== "fallback"
      ? `Calibration ${response.calibrationSummary.status} using ${response.calibrationSummary.sampleSize} labeled cases.`
      : null,
    guardrails.degraded
      ? `Guardrails: ${guardrails.actionability}. Reasons: ${guardrails.reasons.join(", ")}.`
      : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return ResearchViewSchema.parse({
    probabilitySource,
    lean: response.final.resolutionStatus === "NOT_YET_RESOLVED" ? probabilityToLean(systemYesProbability) : opinion.lean,
    leanConfidence: roundProbability(confidenceValue),
    confidenceLabel,
    systemYesProbability: roundProbability(systemYesProbability),
    systemNoProbability: roundProbability(systemNoProbability),
    marketYesProbability: marketYesProbability == null ? undefined : roundProbability(marketYesProbability),
    marketNoProbability: marketNoProbability == null ? undefined : roundProbability(marketNoProbability),
    yesEdge,
    noEdge,
    rationale
  });
}

function buildResearchNarrative(response: MarketResearchResponse) {
  const fallbackHeadline = response.final.lean === "TOSSUP" ? "Resolution remains open." : `${response.final.lean} research view`;
  const fallbackSummary = response.final.modelTake || response.final.why;

  return ResearchNarrativeSchema.parse({
    headline: response.offlineSummary?.headline ?? fallbackHeadline,
    summary: response.offlineSummary?.summary ?? fallbackSummary,
    watchItems: (response.offlineSummary?.watchItems ?? response.final.whatToWatch ?? []).slice(0, 10),
    nextCheckAt: response.final.nextCheckAt
  });
}

function inferRunMode(response: MarketResearchResponse): ResearchGuardrails["runMode"] {
  const { ranParallel, ranXai, ranDirect, ranLocalOpinion } = response.strategy;
  const ranPaid = ranParallel || ranXai;

  if (ranDirect && !ranPaid && !ranLocalOpinion) {
    return "direct_only";
  }
  if (!ranPaid && ranLocalOpinion) {
    return "local_only";
  }
  if (ranPaid && (ranDirect || ranLocalOpinion)) {
    return "hybrid";
  }
  if (ranPaid) {
    return "full_stack";
  }
  return "degraded";
}

export function deriveDecisiveEvidenceStatus(response: MarketResearchResponse): DecisiveEvidenceStatus {
  if (response.sourceSummary?.contradictionSourcePresent) {
    return "conflicting";
  }

  const hasOfficialSource = response.sourceSummary?.officialSourcePresent ?? false;
  if (response.final.resolutionStatus === "RESOLVED_YES" && hasOfficialSource) {
    return "decisive_yes";
  }
  if (response.final.resolutionStatus === "RESOLVED_NO" && hasOfficialSource) {
    return "decisive_no";
  }
  if (hasOfficialSource) {
    return "official_inconclusive";
  }
  if ((response.evidence?.length ?? 0) > 0 || (response.citations?.length ?? 0) > 0) {
    return "secondary_only";
  }
  return "none";
}

function applyConfidenceCap(current: number | undefined, next: number | undefined): number | undefined {
  if (next == null) {
    return current;
  }
  return current == null ? next : Math.min(current, next);
}

function capProbability(probability: number, maxConfidence: number): number {
  const direction = probability >= 0.5 ? 1 : -1;
  const directionalConfidence = Math.abs(probability - 0.5) * 2;
  const capped = Math.min(directionalConfidence, maxConfidence);
  return clampProbability(0.5 + direction * capped * 0.5);
}

function leanToProbability(lean: MarketResearchResponse["final"]["lean"], leanConfidence: number): number {
  if (lean === "TOSSUP") {
    return 0.5;
  }

  const base = {
    STRONG_NO: 0.08,
    LEAN_NO: 0.32,
    TOSSUP: 0.5,
    LEAN_YES: 0.68,
    STRONG_YES: 0.92
  } as const;

  const baseProb = base[lean];
  const direction = baseProb > 0.5 ? 1 : -1;
  const distance = Math.abs(baseProb - 0.5);
  return clampProbability(0.5 + direction * distance * (0.5 + 0.5 * leanConfidence));
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: unknown): number[] {
  return parseStringArray(value)
    .map((item) => Number.parseFloat(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => clamp01(item));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

function roundProbability(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundDelta(value: number): number {
  return Math.round(value * 1000) / 1000;
}
