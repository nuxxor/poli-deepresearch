import {
  type Claim,
  type DecisiveEvidenceStatus,
  type EvidenceDoc,
  type MarketContext,
  type Opinion,
  type ProviderResearchJudgment,
  type ResolutionComparator,
  type ResolutionContract,
  type SourceSummary
} from "@polymarket/deep-research-contracts";

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "will",
  "would",
  "before",
  "after",
  "about",
  "into",
  "their",
  "there",
  "have",
  "has",
  "been",
  "being",
  "official",
  "reported",
  "market",
  "according",
  "requires",
  "require",
  "under",
  "said",
  "says"
]);

type OfficialClaimSignal = {
  hasOfficialEvidence: boolean;
  hasDirectOfficialCheck: boolean;
  anyOfficialClaim: boolean;
  hasContractAlignedOfficialClaim: boolean;
  supportsYesWeight: number;
  supportsNoWeight: number;
  contradictory: boolean;
};

type DeriveDecisiveEvidenceStatusInput = {
  final?: Opinion;
  directRun?: ProviderResearchJudgment;
  evidence: EvidenceDoc[];
  claims?: Claim[];
  sourceSummary?: SourceSummary;
  citationsCount?: number;
  resolutionContract?: ResolutionContract;
};

type ReconcileOpinionAgainstEvidenceInput = {
  market: MarketContext;
  opinion: Opinion;
  directRun?: ProviderResearchJudgment;
  evidence: EvidenceDoc[];
  claims?: Claim[];
  sourceSummary?: SourceSummary;
  resolutionContract?: ResolutionContract;
};

export function deriveDecisiveEvidenceStatus(
  input: DeriveDecisiveEvidenceStatusInput
): DecisiveEvidenceStatus {
  const officialSignal = summarizeOfficialClaimSignal(
    input.claims,
    input.evidence,
    input.directRun,
    input.resolutionContract
  );
  const hasOfficialSource = (input.sourceSummary?.officialSourcePresent ?? false) || officialSignal.hasOfficialEvidence;
  const directStatus = input.directRun?.parseMode === "direct" ? input.directRun.resolutionStatus : undefined;

  if (
    input.sourceSummary?.contradictionSourcePresent ||
    officialSignal.contradictory ||
    (officialSignal.supportsYesWeight > 0.35 && officialSignal.supportsNoWeight > 0.35)
  ) {
    return "conflicting";
  }

  if (directStatus === "RESOLVED_YES") {
    return "decisive_yes";
  }
  if (directStatus === "RESOLVED_NO") {
    return "decisive_no";
  }

  if (
    input.final?.resolutionStatus === "RESOLVED_YES" &&
    officialSignal.hasContractAlignedOfficialClaim &&
    officialSignal.supportsYesWeight >= 0.65 &&
    officialSignal.supportsNoWeight <= 0.18
  ) {
    return "decisive_yes";
  }
  if (
    input.final?.resolutionStatus === "RESOLVED_NO" &&
    officialSignal.hasContractAlignedOfficialClaim &&
    officialSignal.supportsNoWeight >= 0.65 &&
    officialSignal.supportsYesWeight <= 0.18
  ) {
    return "decisive_no";
  }

  if (hasOfficialSource || officialSignal.hasDirectOfficialCheck || officialSignal.anyOfficialClaim) {
    return "official_inconclusive";
  }

  if ((input.evidence.length ?? 0) > 0 || (input.citationsCount ?? 0) > 0) {
    return "secondary_only";
  }

  return "none";
}

export function reconcileOpinionAgainstEvidence(
  input: ReconcileOpinionAgainstEvidenceInput
): { opinion: Opinion; notes: string[] } {
  const notes: string[] = [];
  const status = deriveDecisiveEvidenceStatus({
    final: input.opinion,
    directRun: input.directRun,
    evidence: input.evidence,
    claims: input.claims,
    sourceSummary: input.sourceSummary,
    resolutionContract: input.resolutionContract
  });
  const signal = summarizeOfficialClaimSignal(
    input.claims,
    input.evidence,
    input.directRun,
    input.resolutionContract
  );

  let opinion = input.opinion;

  if (status === "conflicting") {
    opinion = softenOpinion(opinion, 0.57, "Conflicting evidence remains unresolved.");
    notes.push("evidence_reconcile_conflicting");
  }

  if (input.market.canonicalMarket.officialSourceRequired && (status === "secondary_only" || status === "none")) {
    opinion = softenOpinion(opinion, 0.52, "No decisive official evidence was found yet.");
    notes.push("evidence_reconcile_official_missing");
  } else if (input.market.canonicalMarket.officialSourceRequired && status === "official_inconclusive") {
    opinion = softenOpinion(opinion, 0.62, "Official evidence exists, but it does not yet decisively resolve the market.");
    notes.push("evidence_reconcile_official_inconclusive");
  }

  const leanDirection = toLeanDirection(opinion.lean);
  if (
    leanDirection === "yes" &&
    signal.supportsNoWeight > Math.max(0.42, signal.supportsYesWeight + 0.14)
  ) {
    opinion = softenOpinion(opinion, 0.56, "Official evidence currently leans NO more than the draft view.");
    notes.push("evidence_reconcile_official_no_pressure");
  } else if (
    leanDirection === "no" &&
    signal.supportsYesWeight > Math.max(0.42, signal.supportsNoWeight + 0.14)
  ) {
    opinion = softenOpinion(opinion, 0.56, "Official evidence currently leans YES more than the draft view.");
    notes.push("evidence_reconcile_official_yes_pressure");
  }

  return { opinion, notes };
}

function summarizeOfficialClaimSignal(
  claims: Claim[] | undefined,
  evidence: EvidenceDoc[],
  directRun?: ProviderResearchJudgment,
  resolutionContract?: ResolutionContract
): OfficialClaimSignal {
  const evidenceById = new Map(evidence.map((doc) => [doc.docId, doc]));
  let supportsYesWeight = 0;
  let supportsNoWeight = 0;
  let contradictory = false;
  let anyOfficialClaim = false;
  let hasContractAlignedOfficialClaim = false;

  for (const claim of claims ?? []) {
    const doc = evidenceById.get(claim.docId);
    const fromOfficialDoc = doc?.sourceType === "official" || claim.origin === "heuristic_official";
    if (!fromOfficialDoc) {
      continue;
    }

    anyOfficialClaim = true;
    const docAlignment = scoreDocumentAlignmentToResolutionContract(doc, resolutionContract);
    const claimAlignment = scoreClaimAlignmentToResolutionContract(claim, doc, resolutionContract);
    const alignmentWeight = resolutionContract ? Math.max(docAlignment, claimAlignment) : 1;

    if (alignmentWeight >= 0.55) {
      hasContractAlignedOfficialClaim = true;
    }
    if (alignmentWeight < 0.24) {
      continue;
    }

    const sourceWeight = doc ? doc.authorityScore * 0.6 + doc.directnessScore * 0.4 : 0.75;
    const weight = clamp01(claim.confidence * sourceWeight * Math.max(0.2, alignmentWeight));

    if (claim.polarity === "contradictory") {
      contradictory = contradictory || alignmentWeight >= 0.4;
      continue;
    }
    if (claim.polarity === "supports_yes") {
      supportsYesWeight += weight;
      continue;
    }
    if (claim.polarity === "supports_no") {
      supportsNoWeight += weight;
    }
  }

  return {
    hasOfficialEvidence: evidence.some(
      (doc) => doc.sourceType === "official" && scoreDocumentAlignmentToResolutionContract(doc, resolutionContract) >= 0.38
    ),
    hasDirectOfficialCheck: directRun?.parseMode === "direct",
    anyOfficialClaim,
    hasContractAlignedOfficialClaim,
    supportsYesWeight: round3(clamp01(supportsYesWeight)),
    supportsNoWeight: round3(clamp01(supportsNoWeight)),
    contradictory
  };
}

function scoreClaimAlignmentToResolutionContract(
  claim: Claim,
  doc: EvidenceDoc | undefined,
  resolutionContract?: ResolutionContract
): number {
  if (!resolutionContract) {
    return 1;
  }

  const text = normalizeText([
    claim.subject,
    claim.predicate,
    claim.object,
    doc?.title,
    clipEvidenceText(doc?.contentMarkdown)
  ]);

  let score = 0.1;
  const thresholdScore = thresholdAlignmentScore(text, resolutionContract, 0.18);
  if (claim.claimType === resolutionContract.resolutionArchetype) {
    score += 0.14;
  }
  score += tokenMatchScore(text, resolutionContract.subject, 0.24);
  score += tokenMatchScore(text, resolutionContract.eventLabel, 0.14);
  score += tokenMatchScore(text, resolutionContract.metricName, 0.1);
  score += comparatorCueScore(text, resolutionContract, 0.12);
  score += thresholdScore;
  score += decisiveRuleScore(
    text,
    claim.polarity === "supports_no" ? resolutionContract.decisiveNoRule : resolutionContract.decisiveYesRule,
    0.1
  );
  if (claim.origin === "heuristic_official" || doc?.sourceType === "official") {
    score += 0.08;
  }
  if (
    resolutionContract.resolutionArchetype === "numeric_threshold" &&
    resolutionContract.thresholdValue != null &&
    thresholdScore === 0
  ) {
    score = Math.min(score, 0.44);
  }

  return clamp01(score);
}

function scoreDocumentAlignmentToResolutionContract(
  doc: EvidenceDoc | undefined,
  resolutionContract?: ResolutionContract
): number {
  if (!doc) {
    return 0;
  }
  if (!resolutionContract) {
    return doc.sourceType === "official" ? 1 : 0.5;
  }

  const text = normalizeText([doc.title, clipEvidenceText(doc.contentMarkdown), doc.canonicalUrl]);
  const thresholdScore = thresholdAlignmentScore(text, resolutionContract, 0.16);
  let score = doc.sourceType === "official" ? 0.12 : 0.04;
  score += tokenMatchScore(text, resolutionContract.subject, 0.3);
  score += tokenMatchScore(text, resolutionContract.eventLabel, 0.18);
  score += tokenMatchScore(text, resolutionContract.metricName, 0.1);
  score += comparatorCueScore(text, resolutionContract, 0.14);
  score += thresholdScore;
  score += Math.max(
    decisiveRuleScore(text, resolutionContract.decisiveYesRule, 0.05),
    decisiveRuleScore(text, resolutionContract.decisiveNoRule, 0.05)
  );
  if (
    resolutionContract.resolutionArchetype === "numeric_threshold" &&
    resolutionContract.thresholdValue != null &&
    thresholdScore === 0
  ) {
    score = Math.min(score, 0.36);
  }

  return clamp01(score);
}

function comparatorCueScore(text: string, resolutionContract: ResolutionContract, weight: number): number {
  const patterns = comparatorCuePatterns(resolutionContract.comparator);
  if (patterns.length === 0) {
    return 0;
  }
  return patterns.some((pattern) => pattern.test(text)) ? weight : 0;
}

function thresholdAlignmentScore(text: string, resolutionContract: ResolutionContract, weight: number): number {
  if (resolutionContract.thresholdValue == null) {
    return 0;
  }

  const values = extractNumericValues(text);
  if (values.some((value) => compareNumericToThreshold(value, resolutionContract.comparator, resolutionContract.thresholdValue!))) {
    return weight;
  }

  return 0;
}

function decisiveRuleScore(text: string, rule: string | undefined, weight: number): number {
  return tokenMatchScore(text, rule, weight);
}

function tokenMatchScore(text: string, phrase: string | undefined, weight: number): number {
  if (!phrase) {
    return 0;
  }
  return tokenMatchRatio(text, phrase) * weight;
}

function tokenMatchRatio(text: string, phrase: string): number {
  const tokens = tokenizeMeaningful(phrase);
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = new Set(tokenizeMeaningful(text));
  let hits = 0;
  for (const token of tokens) {
    if (haystack.has(token)) {
      hits += 1;
    }
  }

  return hits / tokens.length;
}

function tokenizeMeaningful(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
}

function extractNumericValues(text: string): number[] {
  const values: number[] = [];
  const regex = /(-?\d[\d,]*(?:\.\d+)?)\s*([kmb])?\b/gi;

  for (const match of text.matchAll(regex)) {
    const rawValue = match[1]?.replaceAll(",", "");
    if (!rawValue) {
      continue;
    }
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
    values.push(parsed * multiplier);
  }

  return values;
}

function compareNumericToThreshold(
  value: number,
  comparator: ResolutionComparator,
  threshold: number
): boolean {
  const epsilon = Math.max(0.001, Math.abs(threshold) * 0.001);

  switch (comparator) {
    case "greater_than":
      return value > threshold;
    case "greater_than_or_equal":
      return value >= threshold - epsilon;
    case "less_than":
      return value < threshold;
    case "less_than_or_equal":
      return value <= threshold + epsilon;
    case "equal_to":
      return Math.abs(value - threshold) <= epsilon;
    default:
      return Math.abs(value - threshold) <= epsilon;
  }
}

function comparatorCuePatterns(comparator: ResolutionComparator): RegExp[] {
  switch (comparator) {
    case "greater_than":
      return [/\babove\b/, /\bover\b/, /\bgreater than\b/, /\bexceed(?:ed|s)?\b/, /\bbroke\b/];
    case "greater_than_or_equal":
      return [/\bat least\b/, /\b>=\b/, /\bhit\b/, /\breach(?:ed|es)?\b/, /\btouch(?:ed|es)?\b/];
    case "less_than":
      return [/\bbelow\b/, /\bunder\b/, /\bless than\b/, /\bmiss(?:ed|es)?\b/];
    case "less_than_or_equal":
      return [/\bat most\b/, /\b<=\b/, /\bno more than\b/];
    case "winner":
      return [/\bwon\b/, /\bwinner\b/, /\bdefeat(?:ed|s)?\b/, /\bchampion\b/, /\bclinched\b/];
    case "official_confirmation":
    case "occurs":
      return [/\bannounced\b/, /\bconfirmed\b/, /\breleased\b/, /\blaunched\b/, /\blisted\b/, /\bapproved\b/];
    case "not_occurs":
      return [/\bwill not\b/, /\bwon'?t\b/, /\bnot\b/, /\bcancelled\b/, /\bdelayed\b/, /\bterminated\b/];
    case "legal_outcome":
      return [/\bcharged\b/, /\bindicted\b/, /\bconvicted\b/, /\bacquitted\b/, /\bdismissed\b/];
    case "appointment_change":
      return [/\bappointed\b/, /\bconfirmed\b/, /\bresigned\b/, /\bstepped down\b/, /\bremoved\b/];
    case "equal_to":
      return [/\bexactly\b/, /\bequal to\b/];
    case "unknown":
    default:
      return [];
  }
}

function clipEvidenceText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.slice(0, 1_200);
}

function normalizeText(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

function softenOpinion(opinion: Opinion, confidenceCap: number, note: string): Opinion {
  return {
    ...opinion,
    lean: weakenLean(opinion.lean),
    leanConfidence: Math.min(opinion.leanConfidence, confidenceCap),
    resolutionConfidence:
      opinion.resolutionStatus === "NOT_YET_RESOLVED"
        ? Math.min(opinion.resolutionConfidence, Math.max(0.38, confidenceCap - 0.08))
        : opinion.resolutionConfidence,
    why: appendSentence(opinion.why, note),
    modelTake: appendSentence(opinion.modelTake, note)
  };
}

function weakenLean(lean: Opinion["lean"]): Opinion["lean"] {
  switch (lean) {
    case "STRONG_YES":
      return "LEAN_YES";
    case "LEAN_YES":
      return "TOSSUP";
    case "LEAN_NO":
      return "TOSSUP";
    case "STRONG_NO":
      return "LEAN_NO";
    case "TOSSUP":
    default:
      return "TOSSUP";
  }
}

function toLeanDirection(lean: Opinion["lean"]): "yes" | "no" | "neutral" {
  if (lean === "LEAN_YES" || lean === "STRONG_YES") {
    return "yes";
  }
  if (lean === "LEAN_NO" || lean === "STRONG_NO") {
    return "no";
  }
  return "neutral";
}

function appendSentence(base: string, next: string): string {
  const normalizedBase = base.trim();
  const normalizedNext = next.trim();
  if (normalizedNext === "" || normalizedBase.includes(normalizedNext)) {
    return normalizedBase;
  }
  if (normalizedBase === "") {
    return normalizedNext;
  }
  return `${normalizedBase}${/[.!?]$/.test(normalizedBase) ? "" : "."} ${normalizedNext}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
