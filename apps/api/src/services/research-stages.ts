import { createHash } from "node:crypto";

import { z } from "zod";
import {
  ClaimSchema,
  LocalPlannerSchema,
  MarketSignalsSummarySchema,
  type Claim,
  type ClaimExtractionStatus,
  type EvidenceDoc,
  type LocalPlanner,
  type MarketContext,
  type ProviderSearchResultItem,
  type ResearchFinalMode,
  type SearchQueryPlan
} from "@polymarket/deep-research-contracts";

import { buildLocalPlanner, extractClaimsWithLocalModel } from "./local-lane.js";
import { buildSearchQueryPlan } from "./queries.js";
import { clipText } from "./providers/shared.js";

export async function buildPlannerForMarket(market: MarketContext): Promise<LocalPlanner> {
  if (!shouldUseLocalPlanner(market)) {
    return buildDeterministicLocalPlanner(market, ["local_planner_skipped"]);
  }

  return buildLocalPlanner(market).catch(() => buildDeterministicLocalPlanner(market, ["local_planner_failed"]));
}

export function pickExtractionCandidates(
  citations: ProviderSearchResultItem[],
  market: MarketContext,
  finalMode: ResearchFinalMode,
  startedAt: number
): ProviderSearchResultItem[] {
  if (finalMode === "failed") {
    return [];
  }

  const elapsedMs = Date.now() - startedAt;
  const { category } = market.canonicalMarket;

  if (finalMode === "direct_only" || finalMode === "local_floor") {
    return citations.slice(0, 2);
  }

  if ((category === "world" || category === "politics" || category === "entertainment") && elapsedMs > 20_000) {
    return citations.slice(0, 2);
  }

  return citations;
}

export async function extractClaimArtifacts(
  market: MarketContext,
  finalMode: ResearchFinalMode,
  startedAt: number,
  docs: EvidenceDoc[]
): Promise<{ claims: Claim[]; status?: ClaimExtractionStatus }> {
  if (docs.length === 0) {
    return { claims: [] };
  }

  const canAttemptLocal = shouldAttemptLocalClaimExtraction(finalMode);
  const skipReason = canAttemptLocal ? localClaimExtractionSkipReason(market, startedAt, docs) : null;
  if (canAttemptLocal && !skipReason) {
    const localClaims = await extractClaimsWithLocalModel(market, docs).catch(() => null);
    if (localClaims && localClaims.length > 0) {
      return { claims: localClaims, status: "extracted" };
    }
  }

  const heuristicClaims = extractDeterministicClaimsFromOfficialDocs(market, docs);
  if (heuristicClaims.length > 0) {
    return { claims: heuristicClaims, status: "heuristic" };
  }

  if (skipReason) {
    return { claims: [], status: skipReason };
  }

  return { claims: [], status: "failed" };
}

export function shouldRunOfflineSummary(
  market: MarketContext,
  finalMode: ResearchFinalMode,
  startedAt: number,
  claimCount: number,
  citationCount: number
): boolean {
  if (claimCount === 0 && citationCount === 0) {
    return false;
  }

  if (finalMode === "failed") {
    return false;
  }

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 32_000) {
    return false;
  }

  return true;
}

export async function awaitSignalsWithBudget(
  promise: Promise<z.infer<typeof MarketSignalsSummarySchema>>,
  market: MarketContext,
  startedAt: number,
  queryPlan: SearchQueryPlan
): Promise<z.infer<typeof MarketSignalsSummarySchema>> {
  const elapsedMs = Date.now() - startedAt;
  const remainingBudgetMs = Math.max(500, 5000 - Math.min(elapsedMs, 4500));

  try {
    return await Promise.race([
      promise,
      new Promise<z.infer<typeof MarketSignalsSummarySchema>>((resolve) => {
        setTimeout(
          () => resolve(buildEmptySignalsSummary(market, queryPlan, new Error("signals_timeout"))),
          remainingBudgetMs
        );
      })
    ]);
  } catch {
    return buildEmptySignalsSummary(market, queryPlan, new Error("signals_failed"));
  }
}

export function buildEmptySignalsSummary(
  market: MarketContext,
  queryPlan: SearchQueryPlan,
  error: unknown
) {
  return MarketSignalsSummarySchema.parse({
    generatedAt: new Date().toISOString(),
    cacheHit: false,
    topic: queryPlan.topic,
    socialQuery: queryPlan.socialQuery,
    newsQuery: queryPlan.webQuery,
    totalItems: 0,
    estimatedCostUsd: 0,
    totalMs: 0,
    twitter: {
      ok: false,
      resultCount: 0,
      durationMs: 0,
      error: error instanceof Error ? error.message : "signals_failed"
    },
    gdelt: {
      ok: false,
      resultCount: 0,
      durationMs: 0,
      error: error instanceof Error ? error.message : "signals_failed"
    },
    items: []
  });
}

function buildDeterministicLocalPlanner(
  market: MarketContext,
  notes: string[]
): LocalPlanner {
  return LocalPlannerSchema.parse({
    source: "deterministic",
    queryPlan: buildSearchQueryPlan(market),
    notes
  });
}

function shouldUseLocalPlanner(market: MarketContext): boolean {
  const { category } = market.canonicalMarket;
  return category === "business" || category === "technology" || category === "crypto";
}

function shouldAttemptLocalClaimExtraction(finalMode: ResearchFinalMode): boolean {
  return finalMode !== "failed" && finalMode !== "local_floor" && finalMode !== "direct_only";
}

function localClaimExtractionSkipReason(
  market: MarketContext,
  startedAt: number,
  docs: { length: number }
): Extract<ClaimExtractionStatus, "skipped_budget" | "skipped_category"> | null {
  if (docs.length === 0) {
    return null;
  }

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 28_000) {
    return "skipped_budget";
  }

  const { category } = market.canonicalMarket;
  return category === "world" || category === "politics" ? "skipped_category" : null;
}

function extractDeterministicClaimsFromOfficialDocs(market: MarketContext, docs: EvidenceDoc[]): Claim[] {
  const subject = market.canonicalMarket.title.replace(/\?+$/, "").trim();
  const officialDocs = docs
    .filter((doc) => doc.sourceType === "official")
    .sort((left, right) => {
      const leftScore = left.authorityScore + left.directnessScore + left.freshnessScore;
      const rightScore = right.authorityScore + right.directnessScore + right.freshnessScore;
      return rightScore - leftScore;
    })
    .slice(0, 4);

  return officialDocs
    .map((doc) => {
      const polarity = inferDeterministicClaimPolarity(market, doc);
      if (!polarity) {
        return null;
      }

      const object = (clipText(firstSentence(doc.contentMarkdown) ?? doc.title ?? doc.canonicalUrl, 180) ?? doc.canonicalUrl).trim();
      const digest = createHash("sha1")
        .update([market.canonicalMarket.marketId, doc.docId, polarity, object].join("|"))
        .digest("hex")
        .slice(0, 12);

      return ClaimSchema.parse({
        claimId: `claim:${digest}`,
        docId: doc.docId,
        claimType: market.canonicalMarket.resolutionArchetype,
        subject,
        predicate: heuristicClaimPredicate(market, polarity),
        object,
        eventTime: doc.publishedAt,
        polarity,
        confidence: clampProbability(doc.authorityScore * 0.45 + doc.directnessScore * 0.35 + doc.freshnessScore * 0.2),
        origin: "heuristic_official"
      });
    })
    .filter((claim): claim is Claim => Boolean(claim));
}

function inferDeterministicClaimPolarity(
  market: MarketContext,
  doc: EvidenceDoc
): Claim["polarity"] | null {
  const text = `${doc.title ?? ""}\n${doc.contentMarkdown}`.toLowerCase();
  const matchesAny = (patterns: readonly RegExp[]) => patterns.some((pattern) => pattern.test(text));
  const archetype = market.canonicalMarket.resolutionArchetype;

  const positivePatterns = {
    appointment_or_resignation: [/\bappointed\b/, /\bresigned\b/, /\bstepped down\b/, /\bremoved from office\b/],
    release_or_launch: [/\breleased\b/, /\blaunch(ed)?\b/, /\bavailable now\b/, /\bpublicly trading\b/, /\blisted on\b/],
    winner_of_event: [/\bwon\b/, /\bchampion\b/, /\bclinched\b/, /\bdeclared winner\b/],
    legal_outcome: [/\bconvicted\b/, /\bsentenced\b/, /\bruled in favor\b/, /\bjudgment entered\b/],
    official_announcement_by_deadline: [/\bannounced\b/, /\bconfirmed\b/, /\bagreed\b/, /\bsigned\b/, /\bdeclared\b/],
    numeric_threshold: [/\babove\b/, /\bover\b/, /\bat least\b/, /\breached\b/, /\bhit\b/],
    negative_occurrence_by_deadline: [/\bcancelled\b/, /\bterminated\b/, /\bwill not\b/, /\bwon't\b/, /\bnot happening\b/]
  } as const;
  const negativePatterns = {
    appointment_or_resignation: [/\bwill remain\b/, /\bnot resign\b/, /\bdenied resignation\b/],
    release_or_launch: [/\bdelayed\b/, /\bpostponed\b/, /\bcancelled\b/, /\bnot launching\b/, /\bwill not launch\b/],
    winner_of_event: [/\blost\b/, /\beliminated\b/, /\bdefeated\b/, /\brunner-up\b/],
    legal_outcome: [/\bacquitted\b/, /\bdismissed\b/, /\bdenied\b/, /\bcase dropped\b/],
    official_announcement_by_deadline: [/\bdenied\b/, /\bnot announced\b/, /\bno plans\b/, /\bwill not\b/],
    numeric_threshold: [/\bbelow\b/, /\bunder\b/, /\bmissed\b/, /\bfailed to reach\b/],
    negative_occurrence_by_deadline: [/\blaunched\b/, /\breleased\b/, /\bbegan trading\b/, /\blisted\b/, /\boccurred\b/]
  } as const;

  const positive = matchesAny(
    positivePatterns[archetype as keyof typeof positivePatterns] ?? positivePatterns.official_announcement_by_deadline
  );
  const negative = matchesAny(
    negativePatterns[archetype as keyof typeof negativePatterns] ?? negativePatterns.official_announcement_by_deadline
  );

  if (positive && negative) {
    return "contradictory";
  }
  if (positive) {
    return "supports_yes";
  }
  if (negative) {
    return "supports_no";
  }
  return null;
}

function heuristicClaimPredicate(market: MarketContext, polarity: Claim["polarity"]): string {
  const supportive = polarity === "supports_yes";

  switch (market.canonicalMarket.resolutionArchetype) {
    case "appointment_or_resignation":
      return supportive ? "was officially reported as changing office status" : "was officially reported as staying in office";
    case "release_or_launch":
      return supportive ? "was officially reported as released or launched" : "was officially reported as delayed or not launched";
    case "winner_of_event":
      return supportive ? "was officially reported as the winner" : "was officially reported as not the winner";
    case "legal_outcome":
      return supportive ? "was officially reported as matching the legal outcome" : "was officially reported as not matching the legal outcome";
    case "numeric_threshold":
      return supportive ? "was officially reported as meeting the threshold" : "was officially reported as missing the threshold";
    case "negative_occurrence_by_deadline":
      return supportive ? "was officially reported as not occurring" : "was officially reported as occurring";
    case "official_announcement_by_deadline":
    default:
      return supportive ? "was officially reported as occurring" : "was officially reported as not occurring";
  }
}

function firstSentence(markdown: string): string | undefined {
  const normalized = markdown
    .replace(/[`#>*_\[\]\(\)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") {
    return undefined;
  }

  const sentence = normalized.match(/(.+?[.!?])(\s|$)/)?.[1] ?? normalized;
  return clipText(sentence, 180);
}

function clampProbability(value: number): number {
  return Math.max(0.02, Math.min(0.98, value));
}
