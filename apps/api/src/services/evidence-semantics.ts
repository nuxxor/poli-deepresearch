import {
  type Claim,
  type DecisiveEvidenceStatus,
  type EvidenceDoc,
  type MarketContext,
  type Opinion,
  type ProviderResearchJudgment,
  type SourceSummary
} from "@polymarket/deep-research-contracts";

type OfficialClaimSignal = {
  hasOfficialEvidence: boolean;
  hasDirectOfficialCheck: boolean;
  anyOfficialClaim: boolean;
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
};

type ReconcileOpinionAgainstEvidenceInput = {
  market: MarketContext;
  opinion: Opinion;
  directRun?: ProviderResearchJudgment;
  evidence: EvidenceDoc[];
  claims?: Claim[];
  sourceSummary?: SourceSummary;
};

export function deriveDecisiveEvidenceStatus(
  input: DeriveDecisiveEvidenceStatusInput
): DecisiveEvidenceStatus {
  const officialSignal = summarizeOfficialClaimSignal(input.claims, input.evidence, input.directRun);
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
    officialSignal.supportsYesWeight >= 0.75 &&
    officialSignal.supportsNoWeight === 0
  ) {
    return "decisive_yes";
  }
  if (
    input.final?.resolutionStatus === "RESOLVED_NO" &&
    officialSignal.supportsNoWeight >= 0.75 &&
    officialSignal.supportsYesWeight === 0
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
    sourceSummary: input.sourceSummary
  });
  const signal = summarizeOfficialClaimSignal(input.claims, input.evidence, input.directRun);

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
  directRun?: ProviderResearchJudgment
): OfficialClaimSignal {
  const evidenceById = new Map(evidence.map((doc) => [doc.docId, doc]));
  let supportsYesWeight = 0;
  let supportsNoWeight = 0;
  let contradictory = false;
  let anyOfficialClaim = false;

  for (const claim of claims ?? []) {
    const doc = evidenceById.get(claim.docId);
    const fromOfficialDoc = doc?.sourceType === "official" || claim.origin === "heuristic_official";
    if (!fromOfficialDoc) {
      continue;
    }

    anyOfficialClaim = true;
    const weight = clamp01(
      claim.confidence * (doc ? doc.authorityScore * 0.6 + doc.directnessScore * 0.4 : 0.75)
    );

    if (claim.polarity === "contradictory") {
      contradictory = true;
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
    hasOfficialEvidence: evidence.some((doc) => doc.sourceType === "official"),
    hasDirectOfficialCheck: directRun?.parseMode === "direct",
    anyOfficialClaim,
    supportsYesWeight: round3(clamp01(supportsYesWeight)),
    supportsNoWeight: round3(clamp01(supportsNoWeight)),
    contradictory
  };
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
