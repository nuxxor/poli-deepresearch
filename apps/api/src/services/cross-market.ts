import {
  CrossMarketContextSchema,
  type CrossMarketContext,
  type CrossMarketRelation,
  type MarketContext
} from "@polymarket/deep-research-contracts";

import { loadArchivedRunSnapshots } from "./archive-runs.js";
import { fetchRelatedMarketCandidates, type RelatedMarketCandidate } from "./polymarket.js";

const STOPWORDS = new Set([
  "will",
  "the",
  "a",
  "an",
  "before",
  "after",
  "by",
  "on",
  "at",
  "of",
  "to",
  "and",
  "or",
  "be",
  "is",
  "are",
  "for",
  "with",
  "in",
  "this",
  "that",
  "what",
  "who",
  "when",
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
  "year",
  "quarter",
  "publicly",
  "trading",
  "traded",
  "begin",
  "begins",
  "start",
  "starts",
  "starting",
  "launch",
  "launches",
  "launching",
  "release",
  "releases",
  "released",
  "announcement",
  "announce",
  "announces",
  "announced"
]);

export async function buildCrossMarketContext(market: MarketContext, limit = 6): Promise<CrossMarketContext> {
  const [archivedRuns, liveCandidates] = await Promise.all([
    loadArchivedRunSnapshots(80),
    fetchRelatedMarketCandidates(market, Math.max(limit * 2, 8)).catch(() => [])
  ]);
  const currentSlug = market.canonicalMarket.slug;
  const candidates = blendCrossMarketRelations(
    market.canonicalMarket.title,
    market.canonicalMarket.category,
    market.canonicalMarket.resolutionArchetype,
    liveCandidates,
    archivedRuns,
    limit + 1
  )
    .filter((item) => item.slug !== currentSlug)
    .slice(0, limit);

  const summary =
    candidates.length === 0
      ? "No related market context was strong enough to reuse."
      : `Found ${candidates.length} related market theses by blending live Gamma matches with archived research runs.`;

  return CrossMarketContextSchema.parse({
    generatedAt: new Date().toISOString(),
    summary,
    relatedQuestionHints: candidates.slice(0, 4).map((item) => item.title),
    markets: candidates
  });
}

export function summarizeCrossMarketContext(context: CrossMarketContext | null | undefined): string | undefined {
  if (!context || context.markets.length === 0) {
    return undefined;
  }

  const examples = context.markets
    .slice(0, 3)
    .map((item) => `${item.title} (${Math.round(item.overlapScore * 100)}%)`)
    .join("; ");

  return `${context.summary} Related archived theses: ${examples}.`;
}

export function rankCrossMarketCandidates(
  currentTitle: string,
  currentCategory: string,
  currentArchetype: string,
  candidates: Array<{ slug: string; title: string; category?: string; resolutionArchetype?: string }>
): CrossMarketRelation[] {
  const currentTokens = extractKeyTokens(currentTitle);

  return candidates
    .map((item) => {
      const candidateTokens = extractKeyTokens(item.title);
      const sharedTokens = [...candidateTokens].filter((token) => currentTokens.has(token));
      const sameCategory = item.category === currentCategory;
      const sameArchetype = item.resolutionArchetype === currentArchetype;
      const sameEntity = hasEntityOverlap(sharedTokens);
      const overlapScore = clamp01(
        (sharedTokens.length / Math.max(currentTokens.size, candidateTokens.size, 1)) * 0.7 +
          (sameCategory ? 0.2 : 0) +
          (sameArchetype ? 0.1 : 0)
      );

      return {
        slug: item.slug,
        title: item.title,
        category: item.category ?? "unknown",
        resolutionArchetype: item.resolutionArchetype ?? "unknown",
        overlapScore,
        relation: selectRelation(sharedTokens.length, sameCategory, sameArchetype, sameEntity),
        why: buildRelationWhy(sharedTokens, sameCategory, sameArchetype)
      } satisfies CrossMarketRelation;
    })
    .sort((left, right) => right.overlapScore - left.overlapScore);
}

export function blendCrossMarketRelations(
  currentTitle: string,
  currentCategory: string,
  currentArchetype: string,
  liveCandidates: RelatedMarketCandidate[],
  archivedRuns: Array<{
    slug?: string;
    title: string;
    category?: string;
    resolutionArchetype?: string;
    lean?: CrossMarketRelation["lean"];
    leanConfidence?: number;
    resolutionStatus?: CrossMarketRelation["resolutionStatus"];
    why?: string;
  }>,
  limit = 6
): CrossMarketRelation[] {
  const archivedBySlug = new Map(
    archivedRuns
      .filter((item): item is typeof item & { slug: string } => Boolean(item.slug))
      .map((item) => [item.slug, item])
  );

  const liveRanked = rankCrossMarketCandidates(currentTitle, currentCategory, currentArchetype, liveCandidates)
    .map((candidate) => {
      const archived = archivedBySlug.get(candidate.slug);
      return {
        ...candidate,
        overlapScore: clamp01(candidate.overlapScore + 0.08),
        lean: archived?.lean,
        leanConfidence: archived?.leanConfidence,
        resolutionStatus: archived?.resolutionStatus,
        why: archived?.why ? `${candidate.why} | archived thesis: ${clip(archived.why, 120)}` : `${candidate.why} | live_gamma_match`
      } satisfies CrossMarketRelation;
    });

  const archivedOnly = rankCrossMarketCandidates(
    currentTitle,
    currentCategory,
    currentArchetype,
    archivedRuns
      .filter((item): item is typeof item & { slug: string } => Boolean(item.slug) && !liveCandidates.some((candidate) => candidate.slug === item.slug))
      .map((item) => ({
        slug: item.slug,
        title: item.title,
        category: item.category,
        resolutionArchetype: item.resolutionArchetype
      }))
  ).map((candidate) => {
    const archived = archivedBySlug.get(candidate.slug);
    return {
      ...candidate,
      lean: archived?.lean,
      leanConfidence: archived?.leanConfidence,
      resolutionStatus: archived?.resolutionStatus,
      why: archived?.why ? `${candidate.why} | archived thesis: ${clip(archived.why, 120)}` : candidate.why
    } satisfies CrossMarketRelation;
  });

  const merged = [...liveRanked, ...archivedOnly]
    .filter((item) => item.overlapScore >= 0.2)
    .sort((left, right) => {
      if (right.overlapScore !== left.overlapScore) {
        return right.overlapScore - left.overlapScore;
      }
      if ((right.leanConfidence ?? 0) !== (left.leanConfidence ?? 0)) {
        return (right.leanConfidence ?? 0) - (left.leanConfidence ?? 0);
      }
      return left.slug.localeCompare(right.slug);
    });

  const unique: CrossMarketRelation[] = [];
  const seen = new Set<string>();
  for (const item of merged) {
    if (seen.has(item.slug)) {
      continue;
    }
    seen.add(item.slug);
    unique.push(item);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function extractKeyTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/\d/.test(token))
  );
}

function hasEntityOverlap(sharedTokens: string[]): boolean {
  return sharedTokens.some((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function selectRelation(
  sharedTokenCount: number,
  sameCategory: boolean,
  sameArchetype: boolean,
  sameEntity: boolean
): CrossMarketRelation["relation"] {
  if (sameEntity) {
    return "same_entity";
  }
  if (sharedTokenCount > 0) {
    return "shared_tokens";
  }
  if (sameArchetype) {
    return "same_archetype";
  }
  if (sameCategory) {
    return "same_category";
  }
  return "shared_tokens";
}

function buildRelationWhy(sharedTokens: string[], sameCategory: boolean, sameArchetype: boolean): string {
  const parts: string[] = [];
  if (sharedTokens.length > 0) {
    parts.push(`shared tokens: ${sharedTokens.slice(0, 4).join(", ")}`);
  }
  if (sameCategory) {
    parts.push("same category");
  }
  if (sameArchetype) {
    parts.push("same resolution archetype");
  }
  return parts.length > 0 ? parts.join(" | ") : "weak lexical overlap only";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clip(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}
