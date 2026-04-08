import { createHash } from "node:crypto";

import {
  ClaimSchema,
  EvidenceGraphSchema,
  MarketResearchResponseSchema,
  SourceSummarySchema,
  type Claim,
  type EvidenceDoc,
  type EvidenceGraph,
  type EvidenceGraphEdge,
  type EvidenceGraphNode,
  type MarketContext,
  type MarketResearchResponse,
  type Opinion,
  type ProviderResearchJudgment,
  type SourceScoreCard,
  type SourceSummary
} from "@polymarket/deep-research-contracts";

type BuildEvidenceGraphInput = {
  market: MarketContext;
  parallelRun?: ProviderResearchJudgment;
  xaiRun?: ProviderResearchJudgment;
  directRun?: ProviderResearchJudgment;
  final: Opinion;
  evidence: EvidenceDoc[];
  claims?: Claim[];
};

export function buildEvidenceGraphArtifacts(input: BuildEvidenceGraphInput): {
  sourceSummary: SourceSummary;
  evidenceGraph: EvidenceGraph;
  graphClaims: Claim[];
  forecastClaims: Claim[];
} {
  const providers: ProviderResearchJudgment[] = [input.parallelRun, input.xaiRun, input.directRun].filter(
    (judgment): judgment is ProviderResearchJudgment => Boolean(judgment)
  );

  const yesCaseUrls = collectCaseUrls(input.final.yesCase.bullets.map((bullet) => bullet.citationUrls));
  const noCaseUrls = collectCaseUrls(input.final.noCase.bullets.map((bullet) => bullet.citationUrls));

  const cards = input.evidence
    .map((doc) => buildSourceScoreCard(doc, providers, yesCaseUrls, noCaseUrls))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.docId.localeCompare(right.docId);
    });

  const extractedClaims = input.claims && input.claims.length > 0 ? input.claims : [];
  const graphClaims =
    extractedClaims.length > 0
      ? extractedClaims
      : cards
          .map((card) => {
            const doc = input.evidence.find((candidate) => candidate.docId === card.docId);
            return doc ? buildClaimFromEvidenceDoc(doc, card, input.market) : null;
          })
          .filter((claim): claim is Claim => Boolean(claim));
  const forecastClaims = graphClaims.filter((claim) => claim.origin !== "opinion_derived");

  const nodes: EvidenceGraphNode[] = [];
  const edges: EvidenceGraphEdge[] = [];

  for (const provider of providers) {
    nodes.push({
      id: `provider:${provider.provider}`,
      kind: "provider",
      label: `${formatProviderLabel(provider.provider)} ${formatProviderState(provider)}`,
      score: provider.resolutionConfidence ?? (provider.ok ? 0.6 : 0)
    });
  }

  nodes.push({
    id: "opinion:final",
    kind: "opinion",
    label: `Final ${input.final.lean}`,
    score: input.final.leanConfidence,
    lean: input.final.lean,
    resolutionStatus: input.final.resolutionStatus
  });

  for (const card of cards) {
    nodes.push({
      id: `doc:${card.docId}`,
      kind: "document",
      label: card.title?.trim() ? card.title : card.canonicalUrl,
      score: card.score,
      sourceType: card.sourceType
    });

    for (const provider of card.citedByProviders) {
      edges.push({
        from: `provider:${provider}`,
        to: `doc:${card.docId}`,
        relation: "cites",
        weight: card.score
      });
    }

    const docClaims = graphClaims.filter((claim) => claim.docId === card.docId);

    for (const claim of docClaims) {
      nodes.push({
        id: claim.claimId,
        kind: "claim",
        label: clipLabel(`${claim.predicate}: ${claim.object}`),
        score: claim.confidence
      });

      edges.push({
        from: `doc:${card.docId}`,
        to: claim.claimId,
        relation: "extracts",
        weight: claim.confidence
      });

      edges.push({
        from: claim.claimId,
        to: "opinion:final",
        relation: toGraphRelation(claim.polarity),
        weight: claim.confidence
      });
    }
  }

  const countsBySourceType = cards.reduce<Record<string, number>>((accumulator, card) => {
    accumulator[card.sourceType] = (accumulator[card.sourceType] ?? 0) + 1;
    return accumulator;
  }, {});

  const sourceSummary = SourceSummarySchema.parse({
    officialSourcePresent: cards.some((card) => card.isOfficial),
    contradictionSourcePresent: cards.some((card) => card.stance === "contradictory"),
    averageScore: cards.length === 0 ? 0 : cards.reduce((sum, card) => sum + card.score, 0) / cards.length,
    countsBySourceType,
    topSources: cards.slice(0, 5)
  });

  return {
    sourceSummary,
    evidenceGraph: EvidenceGraphSchema.parse({
      nodes,
      edges
    }),
    graphClaims,
    forecastClaims
  };
}

function formatProviderLabel(provider: ProviderResearchJudgment["provider"]): string {
  switch (provider) {
    case "parallel-chat-core":
      return "Parallel";
    case "xai-web-search":
      return "xAI";
    case "direct-official-feed":
      return "Direct";
    case "ollama-local-opinion":
      return "Local";
    case "local-disabled-fallback":
      return "LocalFallback";
  }
}

function formatProviderState(provider: ProviderResearchJudgment): string {
  if (!provider.ok) {
    return "failed";
  }
  if (provider.opinion) {
    return provider.opinion.lean;
  }
  if (provider.resolutionStatus) {
    return provider.resolutionStatus;
  }
  return provider.parseMode;
}

export function withEvidenceArtifacts(response: MarketResearchResponse): MarketResearchResponse {
  if (response.sourceSummary && response.evidenceGraph && response.claims && response.forecastClaims) {
    return response;
  }

  const artifacts = buildEvidenceGraphArtifacts({
    market: response.market,
    parallelRun: response.parallelRun,
    xaiRun: response.xaiRun,
    directRun: response.directRun,
    final: response.final,
    evidence: response.evidence
  });

  return MarketResearchResponseSchema.parse({
    ...response,
    claims: response.claims ?? artifacts.graphClaims,
    forecastClaims: response.forecastClaims ?? artifacts.forecastClaims,
    sourceSummary: response.sourceSummary ?? artifacts.sourceSummary,
    evidenceGraph: response.evidenceGraph ?? artifacts.evidenceGraph
  });
}

function collectCaseUrls(citationLists: string[][]): Set<string> {
  const set = new Set<string>();
  for (const list of citationLists) {
    for (const url of list) {
      const normalized = normalizeUrl(url);
      if (normalized) {
        set.add(normalized);
      }
    }
  }
  return set;
}

function buildSourceScoreCard(
  doc: EvidenceDoc,
  providers: ProviderResearchJudgment[],
  yesCaseUrls: Set<string>,
  noCaseUrls: Set<string>
): SourceScoreCard {
  const citedByProviders = providers
    .filter((provider) => isDocCitedByProvider(doc, provider))
    .map((provider) => provider.provider);
  const stance = inferDocStance(doc, yesCaseUrls, noCaseUrls);
  const score = clamp01(
    doc.authorityScore * 0.5 +
      doc.freshnessScore * 0.3 +
      doc.directnessScore * 0.2 +
      (doc.sourceType === "official" ? 0.05 : 0)
  );

  return {
    docId: doc.docId,
    title: doc.title,
    canonicalUrl: doc.canonicalUrl,
    sourceType: doc.sourceType,
    score,
    authorityScore: doc.authorityScore,
    freshnessScore: doc.freshnessScore,
    directnessScore: doc.directnessScore,
    stance,
    citedByProviders,
    isOfficial: doc.sourceType === "official"
  };
}

function inferDocStance(
  doc: EvidenceDoc,
  yesCaseUrls: Set<string>,
  noCaseUrls: Set<string>
): SourceScoreCard["stance"] {
  const docKeys = [normalizeUrl(doc.canonicalUrl), normalizeUrl(doc.url)].filter(
    (value): value is string => Boolean(value)
  );
  const inYes = docKeys.some((key) => yesCaseUrls.has(key));
  const inNo = docKeys.some((key) => noCaseUrls.has(key));

  if (inYes && inNo) {
    return "contradictory";
  }
  if (inYes) {
    return "supports_yes";
  }
  if (inNo) {
    return "supports_no";
  }
  return "neutral";
}

function isDocCitedByProvider(doc: EvidenceDoc, provider: ProviderResearchJudgment): boolean {
  return provider.citations.some((citation) => {
    if (!citation.url) {
      return false;
    }

    return normalizeUrl(citation.url) === doc.canonicalUrl || citation.url === doc.url;
  });
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildClaimFromEvidenceDoc(doc: EvidenceDoc, card: SourceScoreCard, market: MarketContext): Claim {
  const subject = inferClaimSubject(market);
  const predicate = inferClaimPredicate(market, card.stance);
  const object = inferClaimObject(doc);
  const digest = createHash("sha1")
    .update([market.canonicalMarket.marketId, doc.docId, card.stance, object].join("|"))
    .digest("hex")
    .slice(0, 12);

  return ClaimSchema.parse({
    claimId: `claim:${digest}`,
    docId: doc.docId,
    claimType: market.canonicalMarket.resolutionArchetype,
    subject,
    predicate,
    object,
    eventTime: doc.publishedAt,
    polarity: card.stance,
    confidence: clamp01(card.score),
    origin: "opinion_derived"
  });
}

function inferClaimSubject(market: MarketContext): string {
  const rawTitle = market.canonicalMarket.title.replace(/\?+$/, "").replace(/^will\s+/i, "").trim();

  for (const pattern of [
    /\b(hit|reach|reaches|close|closes|trade|trades|go above|go below|be above|be below)\b/i,
    /\b(released|release|launch|launched|begin publicly trading|begins publicly trading|begin trading|begins trading|start trading|starts trading)\b/i,
    /\b(win|wins|beat|beats|defeat|defeats)\b/i,
    /\b(drop out|drops out|resign|resigns|resignation|appointed|appointment|out as)\b/i,
    /\b(sentence|sentenced|convict|convicted|acquit|acquitted|indict|indicted)\b/i
  ]) {
    const [head] = rawTitle.split(pattern);
    if (head && head.trim() !== "") {
      return head.trim();
    }
  }

  const [head] = rawTitle.split(/\b(before|after|by|on|at)\b/i);
  return (head ?? rawTitle).trim() || market.canonicalMarket.title.trim();
}

function inferClaimPredicate(
  market: MarketContext,
  polarity: SourceScoreCard["stance"]
): Claim["predicate"] {
  if (polarity === "contradictory") {
    return "is reported inconsistently";
  }

  if (polarity === "neutral") {
    return "is reported with unresolved relevance";
  }

  const supportive = polarity === "supports_yes";

  switch (market.canonicalMarket.resolutionArchetype) {
    case "regulatory_approval":
      return supportive ? "is reported as approved" : "is reported as not approved";
    case "winner_of_event":
      return supportive ? "is reported as the winner" : "is reported as not the winner";
    case "numeric_threshold":
      return supportive ? "is reported as meeting the threshold" : "is reported as missing the threshold";
    case "appointment_or_resignation":
      return supportive ? "is reported as occurring in office status" : "is reported as not occurring in office status";
    case "release_or_launch":
      return supportive ? "is reported as released or launched" : "is reported as not released or launched";
    case "legal_outcome":
      return supportive ? "is reported as matching the legal outcome" : "is reported as not matching the legal outcome";
    case "negative_occurrence_by_deadline":
      return supportive ? "is reported as not occurring" : "is reported as occurring";
    case "official_announcement_by_deadline":
    default:
      return supportive ? "is reported as occurring" : "is reported as not occurring";
  }
}

function inferClaimObject(doc: EvidenceDoc): string {
  const candidates = [doc.title, firstSentence(doc.contentMarkdown), doc.canonicalUrl]
    .map((value) => normalizeClaimText(value))
    .filter((value): value is string => Boolean(value && value.trim() !== ""));

  return clipLabel(candidates[0] ?? doc.canonicalUrl, 180);
}

function firstSentence(markdown: string): string | undefined {
  const normalized = markdown
    .replace(/[`#>*_\[\]\(\)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") {
    return undefined;
  }

  const sentence = normalized.split(/(?<=[.!?])\s+/)[0]?.trim();
  return sentence && sentence !== "" ? sentence : normalized.slice(0, 180);
}

function clipLabel(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeClaimText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized === "" ? undefined : normalized;
}

function toGraphRelation(
  stance: SourceScoreCard["stance"] | Claim["polarity"]
): EvidenceGraphEdge["relation"] {
  switch (stance) {
    case "supports_yes":
    case "supports_no":
      return "supports";
    case "contradictory":
      return "contradicts";
    case "neutral":
      return "context";
  }
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
