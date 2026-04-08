import {
  ProbabilisticForecastSchema,
  type Claim,
  type EvidenceDoc,
  type Lean,
  type Opinion,
  type ProbabilisticContribution,
  type ProbabilisticForecast,
  type ProviderResearchJudgment
} from "@polymarket/deep-research-contracts";

type BuildProbabilisticForecastInput = {
  opinion: Opinion;
  providerJudgments: ProviderResearchJudgment[];
  claims: Claim[];
  evidence: EvidenceDoc[];
};

export function buildProbabilisticForecast(input: BuildProbabilisticForecastInput): ProbabilisticForecast {
  const components: ProbabilisticContribution[] = [];
  let logOdds = 0;

  const opinionProbability = opinionToProbability(input.opinion);
  pushComponent(
    components,
    {
      key: "opinion:base",
      label: `Base opinion ${input.opinion.lean}`,
      channel: "opinion",
      probability: opinionProbability,
      direction: directionFromProbability(opinionProbability),
      weight: 0.45 + input.opinion.leanConfidence * 0.35,
      detail: clipSentence(input.opinion.why)
    },
    (0.45 + input.opinion.leanConfidence * 0.35) * logit(opinionProbability)
  );
  logOdds += components.at(-1)?.contribution ?? 0;

  for (const provider of input.providerJudgments) {
    const normalized = providerProbability(provider);
    if (!normalized) {
      continue;
    }

    const contribution = normalized.weight * logit(normalized.probability);
    pushComponent(
      components,
      {
        key: `provider:${provider.provider}`,
        label: providerLabel(provider.provider),
        channel: "provider",
        probability: normalized.probability,
        direction: directionFromProbability(normalized.probability),
        weight: normalized.weight,
        detail: clipSentence(provider.why)
      },
      contribution
    );
    logOdds += contribution;
  }

  const sourceScores = new Map(
    input.evidence.map((doc) => [
      doc.docId,
      clamp(0.15, 1, doc.authorityScore * 0.45 + doc.freshnessScore * 0.2 + doc.directnessScore * 0.35)
    ])
  );

  for (const claim of input.claims.slice(0, 16)) {
    const direction = claimDirection(claim);
    if (direction === "neutral") {
      continue;
    }

    const sourceScore = sourceScores.get(claim.docId) ?? 0.4;
    const weight = clamp(0.08, 0.5, sourceScore * clamp(0.1, 1, claim.confidence));
    const probability = direction === "yes" ? 0.74 : 0.26;
    const contribution = weight * logit(probability);

    pushComponent(
      components,
      {
        key: claim.claimId,
        label: claim.predicate,
        channel: "claim",
        probability,
        direction,
        weight,
        detail: `${claim.subject} ${claim.predicate} ${claim.object}`.trim()
      },
      direction === "yes" ? contribution : -Math.abs(contribution)
    );
    logOdds += direction === "yes" ? contribution : -Math.abs(contribution);
  }

  const posteriorYesProbability = clampProbability(logistic(logOdds));
  const calibratedYesProbability = posteriorYesProbability;
  const confidence = clamp(0.05, 0.98, Math.abs(posteriorYesProbability - 0.5) * 2);
  const notes = buildForecastNotes(components, posteriorYesProbability);

  return ProbabilisticForecastSchema.parse({
    priorYesProbability: 0.5,
    posteriorYesProbability,
    calibratedYesProbability,
    calibratedNoProbability: clampProbability(1 - calibratedYesProbability),
    lean: probabilityToLean(calibratedYesProbability),
    confidence,
    notes,
    components
  });
}

export function applyCalibratedProbability(
  forecast: ProbabilisticForecast,
  calibratedYesProbability: number,
  note?: string
): ProbabilisticForecast {
  const confidence = clamp(0.05, 0.98, Math.abs(calibratedYesProbability - 0.5) * 2);
  const components = note
    ? [
        ...forecast.components,
        {
          key: "calibration:feedback",
          label: "Calibration feedback",
          channel: "calibration" as const,
          direction: directionFromProbability(calibratedYesProbability),
          weight: 0.35,
          contribution: clamp(-4, 4, logit(calibratedYesProbability) - logit(forecast.posteriorYesProbability)),
          probability: calibratedYesProbability,
          detail: note
        }
      ]
    : forecast.components;

  return ProbabilisticForecastSchema.parse({
    ...forecast,
    calibratedYesProbability: clampProbability(calibratedYesProbability),
    calibratedNoProbability: clampProbability(1 - calibratedYesProbability),
    lean: probabilityToLean(calibratedYesProbability),
    confidence,
    notes: note ? [...forecast.notes, note] : forecast.notes,
    components
  });
}

export function applyForecastToOpinion(opinion: Opinion, forecast: ProbabilisticForecast): Opinion {
  const probabilityText = `${Math.round(forecast.calibratedYesProbability * 100)}% YES / ${Math.round(forecast.calibratedNoProbability * 100)}% NO`;
  const forecastWhy = `Probabilistic aggregation lands at ${probabilityText}.`;
  const resolvedLean =
    opinion.resolutionStatus === "RESOLVED_YES"
      ? "STRONG_YES"
      : opinion.resolutionStatus === "RESOLVED_NO"
        ? "STRONG_NO"
        : forecast.lean;
  const leanConfidence =
    opinion.resolutionStatus === "NOT_YET_RESOLVED"
      ? forecast.confidence
      : Math.max(opinion.leanConfidence, forecast.confidence);

  return {
    ...opinion,
    lean: resolvedLean,
    leanConfidence,
    modelTake: joinSentences(opinion.modelTake, forecastWhy),
    why: joinSentences(opinion.why, forecastWhy)
  };
}

export function probabilityToLean(probability: number): Lean {
  if (probability >= 0.8) {
    return "STRONG_YES";
  }
  if (probability >= 0.6) {
    return "LEAN_YES";
  }
  if (probability <= 0.2) {
    return "STRONG_NO";
  }
  if (probability <= 0.4) {
    return "LEAN_NO";
  }
  return "TOSSUP";
}

function buildForecastNotes(components: ProbabilisticContribution[], probability: number): string[] {
  const providerCount = components.filter((component) => component.channel === "provider").length;
  const claimCount = components.filter((component) => component.channel === "claim").length;
  const leadingDirection = probability >= 0.5 ? "yes" : "no";
  const leadingCount = components.filter((component) => component.direction === leadingDirection).length;
  const opposingCount = components.filter(
    (component) => component.direction !== leadingDirection && component.direction !== "neutral"
  ).length;

  return [
    `providers=${providerCount}`,
    `claims=${claimCount}`,
    `agreement=${leadingCount}:${opposingCount}`,
    probability >= 0.5 ? "posterior_leans_yes" : "posterior_leans_no"
  ];
}

function pushComponent(
  components: ProbabilisticContribution[],
  base: Omit<ProbabilisticContribution, "contribution">,
  contribution: number
) {
  components.push({
    ...base,
    contribution: clamp(-4, 4, contribution)
  });
}

function providerProbability(
  provider: ProviderResearchJudgment
): { probability: number; weight: number } | null {
  if (!provider.ok) {
    return null;
  }

  if (provider.resolutionStatus === "RESOLVED_YES") {
    return { probability: 0.98, weight: 1 };
  }

  if (provider.resolutionStatus === "RESOLVED_NO") {
    return { probability: 0.02, weight: 1 };
  }

  if (!provider.opinion) {
    return null;
  }

  const probability = opinionToProbability(provider.opinion);
  const providerWeight: Record<ProviderResearchJudgment["provider"], number> = {
    "parallel-chat-core": 0.7,
    "xai-web-search": 0.62,
    "direct-official-feed": 1,
    "ollama-local-opinion": 0.45,
    "local-disabled-fallback": 0.25
  };

  const structureBonus = provider.parseMode === "json" ? 0.15 : 0;
  return {
    probability,
    weight: clamp(0.2, 1, providerWeight[provider.provider] + structureBonus)
  };
}

function providerLabel(provider: ProviderResearchJudgment["provider"]): string {
  switch (provider) {
    case "parallel-chat-core":
      return "Parallel core";
    case "xai-web-search":
      return "xAI web";
    case "direct-official-feed":
      return "Direct official";
    case "ollama-local-opinion":
      return "Local opinion";
    case "local-disabled-fallback":
      return "Local fallback";
  }
}

function opinionToProbability(opinion: Opinion): number {
  const base: Record<Lean, number> = {
    STRONG_NO: 0.12,
    LEAN_NO: 0.34,
    TOSSUP: 0.5,
    LEAN_YES: 0.66,
    STRONG_YES: 0.88
  };

  const anchor = base[opinion.lean];
  const distance = Math.abs(anchor - 0.5);
  const direction = anchor >= 0.5 ? 1 : -1;
  return clampProbability(0.5 + direction * distance * (0.55 + 0.45 * opinion.leanConfidence));
}

function claimDirection(claim: Claim): "yes" | "no" | "neutral" {
  if (claim.polarity === "supports_yes") {
    return "yes";
  }
  if (claim.polarity === "supports_no") {
    return "no";
  }
  return "neutral";
}

function directionFromProbability(probability: number): ProbabilisticContribution["direction"] {
  if (probability >= 0.55) {
    return "yes";
  }
  if (probability <= 0.45) {
    return "no";
  }
  return "neutral";
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability: number): number {
  const clipped = clampProbability(probability);
  return Math.log(clipped / (1 - clipped));
}

function clampProbability(value: number): number {
  return clamp(0.02, 0.98, value);
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function clipSentence(value: string | undefined): string {
  if (!value) {
    return "No summary available.";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function joinSentences(left: string, right: string): string {
  const items = [left.trim(), right.trim()].filter((value) => value !== "");
  return items.join(" ");
}
