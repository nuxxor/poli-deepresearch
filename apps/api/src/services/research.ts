import { z } from "zod";
import {
  MarketResearchResponseSchema,
  OpinionSchema,
  ProviderResearchJudgmentSchema,
  type AppliedPolicy,
  type Lean,
  type MacroOfficialContext,
  type MarketContext,
  type MarketResearchRequest,
  type MarketResearchResponse,
  type Opinion,
  type OpinionCaseBullet,
  type ProviderResearchJudgment,
  type ProviderSearchRun,
  type ResearchFinalMode,
  type ResolutionStatus,
  type RunType
} from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { runAdversarialReview } from "./adversarial-review.js";
import { calibrateForecast } from "./calibration.js";
import { fetchMarketContextByConditionId, fetchMarketContextBySlug } from "./polymarket.js";
import { buildCrossMarketContext } from "./cross-market.js";
import { buildEvidenceGraphArtifacts } from "./evidence-graph.js";
import { deriveDecisiveEvidenceStatus, reconcileOpinionAgainstEvidence } from "./evidence-semantics.js";
import { rankAndFilterCitations } from "./citation-ranking.js";
import { tryResolveDirectOfficialMarket } from "./direct-resolver.js";
import { extractEvidenceDocs } from "./extract.js";
import { buildLocalOpinion, buildOfflineSummary } from "./local-lane.js";
import { buildMacroOfficialContext } from "./macro-official.js";
import { extractOfficialDomainsForMarket } from "./official-sources.js";
import { resolveAppliedPolicy } from "./policies.js";
import { applyForecastToOpinion, buildProbabilisticForecast } from "./probabilistic-forecast.js";
import { buildResearchCacheKey, readResearchCache, writeResearchCache } from "./research-cache.js";
import { withResearchPresentation } from "./research-projection.js";
import { createResearchRunMeta, saveResearchRun } from "./research-runs.js";
import { buildOpinionPrompt } from "./queries.js";
import {
  awaitSignalsWithBudget,
  buildEmptySignalsSummary,
  buildPlannerForMarket,
  extractClaimArtifacts,
  pickExtractionCandidates,
  shouldRunOfflineSummary
} from "./research-stages.js";
import { buildResolutionContract } from "./resolution-contract.js";
import { runParallelChat } from "./providers/parallel.js";
import { clipText } from "./providers/shared.js";
import { runXaiWebSearch } from "./providers/xai.js";
import { fetchMarketSignals } from "./signals.js";
import { dedupeProviderSearchResults } from "./urls.js";

const OpinionCaseBulletOutputSchema = z.object({
  text: z.string().min(1),
  citationUrls: z.array(z.string()).default([])
});

const OpinionCaseOutputSchema = z.object({
  headline: z.string().min(1),
  bullets: z.array(OpinionCaseBulletOutputSchema).min(1)
});

const OpinionHistoricalContextOutputSchema = z.object({
  narrative: z.string().min(1),
  priors: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().min(1)
      })
    )
    .default([])
});

const OpinionOutputSchema = z.object({
  resolutionStatus: z.enum(["NOT_YET_RESOLVED", "RESOLVED_YES", "RESOLVED_NO"]),
  resolutionConfidence: z.coerce.number().min(0).max(1),
  lean: z.enum(["STRONG_NO", "LEAN_NO", "TOSSUP", "LEAN_YES", "STRONG_YES"]),
  leanConfidence: z.coerce.number().min(0).max(1),
  yesCase: OpinionCaseOutputSchema,
  noCase: OpinionCaseOutputSchema,
  historicalContext: OpinionHistoricalContextOutputSchema,
  whatToWatch: z.array(z.string().min(1)).default([]),
  modelTake: z.string().min(1),
  why: z.string().min(1),
  nextCheckAt: z.string().optional()
});

type ResearchExecutionOptions = {
  runType?: RunType;
  replayOfRunId?: string;
};

export async function runMarketResearchBySlug(
  slug: string,
  request: MarketResearchRequest,
  options?: ResearchExecutionOptions
): Promise<MarketResearchResponse> {
  const market = await fetchMarketContextBySlug(slug);
  return runMarketResearch(market, request, options);
}

export async function runMarketResearchByConditionId(
  conditionId: string,
  request: MarketResearchRequest,
  options?: ResearchExecutionOptions
): Promise<MarketResearchResponse> {
  const market = await fetchMarketContextByConditionId(conditionId);
  return runMarketResearch(market, request, options);
}

async function runMarketResearch(
  market: MarketContext,
  request: MarketResearchRequest,
  options?: ResearchExecutionOptions
): Promise<MarketResearchResponse> {
  const startedAt = Date.now();
  const appliedPolicy = resolveAppliedPolicy(market);
  const resolutionContract = buildResolutionContract(market, appliedPolicy);
  const cacheKey = buildResearchCacheKey(market, appliedPolicy, request.maxCitations);

  if (!request.bypassCache) {
    const cached = await readResearchCache(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const macroOfficialContextPromise = buildMacroOfficialContext(market).catch(() => null);
  const crossMarketContextPromise = buildCrossMarketContext(market).catch(() => null);
  const localPlanner = await buildPlannerForMarket(market);
  const [macroOfficialContext, crossMarketContext] = await Promise.all([
    macroOfficialContextPromise,
    crossMarketContextPromise
  ]);
  const prompt = buildOpinionPrompt(
    market,
    localPlanner.queryPlan,
    macroOfficialContext ?? undefined,
    crossMarketContext ?? undefined
  );
  const officialDomains = extractOfficialDomainsForMarket(market);

  const signalsPromise = fetchMarketSignals(market, undefined, localPlanner.queryPlan).catch((error) =>
    buildEmptySignalsSummary(market, localPlanner.queryPlan, error)
  );

  const paidResearchEnabled = !env.DISABLE_PAID_RESEARCH;
  const directPromise = tryResolveDirectOfficialMarket(market).catch(() => null);
  const parallelPromise = paidResearchEnabled
    ? runParallelChat(prompt, request.maxCitations, "core", { responseFormat: "opinion_json" })
    : Promise.resolve(null);
  const xaiPromise = paidResearchEnabled
    ? runXaiWebSearch(prompt, request.maxCitations)
    : Promise.resolve(null);

  const [directResolution, parallelRunRaw, xaiRunRaw] = await Promise.all([
    directPromise,
    parallelPromise,
    xaiPromise
  ]);

  const parallelRun =
    parallelRunRaw != null ? normalizeParallelOpinion(parallelRunRaw) : undefined;
  const xaiRun = xaiRunRaw != null ? normalizeXaiFreeform(xaiRunRaw) : undefined;
  const directRun = directResolution?.primary ?? undefined;

  const combination = await combineOpinion({
    market,
    parallelRun,
    xaiRun,
    directRun,
    appliedPolicy,
    crossMarketContext: crossMarketContext ?? undefined
  });

  const allCitations = dedupeProviderSearchResults([
    ...(parallelRun?.citations ?? []),
    ...(xaiRun?.citations ?? []),
    ...(directRun?.citations ?? [])
  ]);
  const rankedCitations = rankAndFilterCitations(allCitations, officialDomains);
  const citations = rankedCitations.slice(0, request.maxCitations);

  const extractionCandidates = pickExtractionCandidates(allCitations, market, combination.finalMode, startedAt);
  const extracted = await extractEvidenceDocs(market, extractionCandidates).catch(() => ({
    docs: [],
    extractionCostUsd: 0,
    extractionMs: 0
  }));
  const claimArtifacts = await extractClaimArtifacts(market, combination.finalMode, startedAt, extracted.docs);
  const signals = await awaitSignalsWithBudget(signalsPromise, market, startedAt, localPlanner.queryPlan);

  const provisionalEvidenceArtifacts = buildEvidenceGraphArtifacts({
    market,
    parallelRun,
    xaiRun,
    directRun,
    final: combination.opinion,
    evidence: extracted.docs,
    claims: claimArtifacts.claims.length > 0 ? claimArtifacts.claims : undefined
  });
  const reconciled = reconcileOpinionAgainstEvidence({
    market,
    opinion: combination.opinion,
    directRun,
    evidence: extracted.docs,
    claims: provisionalEvidenceArtifacts.forecastClaims,
    sourceSummary: provisionalEvidenceArtifacts.sourceSummary,
    resolutionContract
  });

  const adversarialResult = await runAdversarialReview({
    market,
    opinion: reconciled.opinion,
    providerJudgments: [parallelRun, xaiRun, directRun].filter(
      (judgment): judgment is ProviderResearchJudgment => Boolean(judgment)
    ),
    evidence: extracted.docs,
    claims: provisionalEvidenceArtifacts.forecastClaims,
    crossMarketContext: crossMarketContext ?? undefined,
    skip: combination.finalMode === "direct_only" || combination.finalMode === "failed"
  }).catch(() => ({
    opinion: reconciled.opinion,
    review: {
      status: "failed",
      changedOpinion: false,
      revisedLean: reconciled.opinion.lean,
      revisedConfidence: reconciled.opinion.leanConfidence,
      notes: ["adversarial_review_exception"]
    }
  }));

  const evidenceArtifacts = buildEvidenceGraphArtifacts({
    market,
    parallelRun,
    xaiRun,
    directRun,
    final: adversarialResult.opinion,
    evidence: extracted.docs,
    claims: claimArtifacts.claims.length > 0 ? claimArtifacts.claims : undefined
  });

  const probabilisticForecast = buildProbabilisticForecast({
    opinion: adversarialResult.opinion,
    providerJudgments: [parallelRun, xaiRun, directRun].filter(
      (judgment): judgment is ProviderResearchJudgment => Boolean(judgment)
    ),
    claims: evidenceArtifacts.forecastClaims,
    evidence: extracted.docs
  });
  const calibrated = await calibrateForecast(market, probabilisticForecast).catch(() => ({
    forecast: probabilisticForecast,
    summary: {
      status: "insufficient",
      sampleSize: 0,
      bucketAccuracy: 0.5,
      adjustment: 0,
      notes: ["calibration_failed"]
    }
  }));
  const finalOpinion = OpinionSchema.parse(applyForecastToOpinion(adversarialResult.opinion, calibrated.forecast));

  const runOfflineSummaryFlag = shouldRunOfflineSummary(
    market,
    combination.finalMode,
    startedAt,
    evidenceArtifacts.forecastClaims.length,
    citations.length
  );
  const offlineSummary = runOfflineSummaryFlag
    ? await buildOfflineSummary(market, finalOpinion, evidenceArtifacts.forecastClaims, extracted.docs, citations).catch(
        () => null
      )
    : null;

  const parallelCost = parallelRun?.raw.estimatedRetrievalCostUsd ?? 0;
  const xaiCost = xaiRun?.raw.estimatedRetrievalCostUsd ?? 0;
  const directCost = directRun?.raw.estimatedRetrievalCostUsd ?? 0;
  const signalsCost = signals.estimatedCostUsd;

  const baseResponse = MarketResearchResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    run: createResearchRunMeta(options?.runType ?? "deep_refresh", options?.replayOfRunId),
    market,
    appliedPolicy,
    resolutionContract,
    cache: {
      hit: false,
      key: cacheKey,
      savedAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString()
    },
    strategy: {
      finalMode: combination.finalMode,
      ranParallel: parallelRun?.ok === true,
      ranXai: xaiRun?.ok === true,
      ranDirect: Boolean(directRun),
      ranLocalOpinion: combination.ranLocalOpinion,
      notes: [
        ...combination.notes,
        ...reconciled.notes,
        ...(crossMarketContext ? ["cross_market_context_loaded"] : ["cross_market_context_empty"]),
        ...adversarialResult.review.notes,
        ...calibrated.summary.notes
      ]
    },
    parallelRun,
    xaiRun,
    directRun,
    localOpinionRun: combination.localOpinionRun,
    final: finalOpinion,
    citations,
    queryPlan: localPlanner.queryPlan,
    localPlanner,
    evidence: extracted.docs,
    claims: evidenceArtifacts.graphClaims,
    forecastClaims: evidenceArtifacts.forecastClaims,
    claimExtractionStatus: claimArtifacts.status,
    offlineSummary: offlineSummary ?? undefined,
    signals,
    macroOfficialContext: macroOfficialContext ?? undefined,
    crossMarketContext: crossMarketContext ?? undefined,
    sourceSummary: evidenceArtifacts.sourceSummary,
    evidenceGraph: evidenceArtifacts.evidenceGraph,
    probabilisticForecast: calibrated.forecast,
    adversarialReview: adversarialResult.review,
    calibrationSummary: calibrated.summary,
    costs: {
      parallelUsd: parallelCost,
      xaiUsd: xaiCost,
      directUsd: directCost,
      extractionUsd: extracted.extractionCostUsd,
      signalsUsd: signalsCost,
      totalUsd: parallelCost + xaiCost + directCost + extracted.extractionCostUsd + signalsCost
    },
    latencies: {
      parallelMs: parallelRun?.raw.durationMs ?? 0,
      xaiMs: xaiRun?.raw.durationMs ?? 0,
      directMs: directRun?.raw.durationMs ?? 0,
      extractionMs: extracted.extractionMs,
      signalsMs: signals.totalMs,
      totalMs: Date.now() - startedAt
    }
  });
  const response = MarketResearchResponseSchema.parse({
    ...baseResponse,
    decisiveEvidenceStatus: deriveDecisiveEvidenceStatus({
      final: baseResponse.final,
      directRun: baseResponse.directRun,
      evidence: baseResponse.evidence,
      claims: baseResponse.forecastClaims ?? baseResponse.claims,
      sourceSummary: baseResponse.sourceSummary,
      citationsCount: baseResponse.citations.length,
      resolutionContract: baseResponse.resolutionContract
    })
  });

  return finalizeResearchResponse(cacheKey, response, request);
}

async function finalizeResearchResponse(
  cacheKey: string,
  response: MarketResearchResponse,
  _request: MarketResearchRequest
): Promise<MarketResearchResponse> {
  let cache = response.cache;

  try {
    cache = await writeResearchCache(cacheKey, response);
  } catch {
    cache = {
      hit: false,
      key: cacheKey,
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
  }

  const persisted = MarketResearchResponseSchema.parse({
    ...withResearchPresentation({
      ...response,
      cache
    }),
    cache
  });

  try {
    await saveResearchRun(persisted, _request);
  } catch {
    return persisted;
  }

  return persisted;
}

function clampProbability(value: number): number {
  return Math.max(0.02, Math.min(0.98, value));
}

function roundProbability(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundDelta(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeParallelOpinion(raw: ProviderSearchRun): ProviderResearchJudgment {
  const rawAnswer = getRawAnswer(raw);

  if (!raw.ok) {
    return ProviderResearchJudgmentSchema.parse({
      provider: "parallel-chat-core",
      ok: false,
      parseMode: "failed",
      why: raw.error ?? "parallel-chat-core failed",
      citations: raw.results,
      rawAnswer,
      raw
    });
  }

  const parsed = parseOpinionOutput(rawAnswer);
  if (parsed) {
    return ProviderResearchJudgmentSchema.parse({
      provider: "parallel-chat-core",
      ok: true,
      parseMode: "json",
      opinion: parsed,
      resolutionStatus: parsed.resolutionStatus,
      resolutionConfidence: parsed.resolutionConfidence,
      reasoning: parsed.modelTake,
      why: parsed.why,
      citations: raw.results,
      rawAnswer,
      raw
    });
  }

  return ProviderResearchJudgmentSchema.parse({
    provider: "parallel-chat-core",
    ok: true,
    parseMode: "freeform",
    freeformAnswer: rawAnswer,
    why: "Parallel returned non-JSON output; falling back to freeform salvage.",
    citations: raw.results,
    rawAnswer,
    raw
  });
}

function normalizeXaiFreeform(raw: ProviderSearchRun): ProviderResearchJudgment {
  const rawAnswer = getRawAnswer(raw);

  if (!raw.ok) {
    return ProviderResearchJudgmentSchema.parse({
      provider: "xai-web-search",
      ok: false,
      parseMode: "failed",
      why: raw.error ?? "xai-web-search failed",
      citations: raw.results,
      rawAnswer,
      raw
    });
  }

  const parsed = parseOpinionOutput(rawAnswer);
  if (parsed) {
    return ProviderResearchJudgmentSchema.parse({
      provider: "xai-web-search",
      ok: true,
      parseMode: "json",
      opinion: parsed,
      resolutionStatus: parsed.resolutionStatus,
      resolutionConfidence: parsed.resolutionConfidence,
      reasoning: parsed.modelTake,
      why: parsed.why,
      freeformAnswer: rawAnswer,
      citations: raw.results,
      rawAnswer,
      raw
    });
  }

  return ProviderResearchJudgmentSchema.parse({
    provider: "xai-web-search",
    ok: true,
    parseMode: "freeform",
    freeformAnswer: rawAnswer,
    why: clipText(rawAnswer, 200) ?? "xAI freeform research narrative.",
    citations: raw.results,
    rawAnswer,
    raw
  });
}

function getRawAnswer(run: ProviderSearchRun): string {
  const meta = run.meta as Record<string, unknown>;
  const answer = meta.answer;
  const summary = meta.summary;

  if (typeof answer === "string") {
    return answer;
  }

  if (typeof summary === "string") {
    return summary;
  }

  return "";
}

function parseOpinionOutput(text: string): Opinion | null {
  if (text.trim() === "") {
    return null;
  }

  const candidates = [
    text.trim(),
    text.match(/```json\s*([\s\S]*?)```/i)?.[1],
    text.match(/```[\s\S]*?({[\s\S]*})[\s\S]*?```/i)?.[1],
    extractFirstJsonObject(text)
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim() !== ""));

  for (const candidate of candidates) {
    try {
      const parsed = OpinionOutputSchema.parse(normalizeOpinionShape(JSON.parse(candidate)));
      return OpinionSchema.parse({
        ...parsed,
        secondModelTake: undefined
      });
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeOpinionShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const cloned = { ...(value as Record<string, unknown>) };
  for (const key of ["resolutionConfidence", "leanConfidence"] as const) {
    const raw = cloned[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 1 && raw <= 100) {
      cloned[key] = raw / 100;
    }
    if (typeof raw === "string") {
      const numeric = Number.parseFloat(raw);
      if (Number.isFinite(numeric)) {
        cloned[key] = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
      }
    }
  }

  const nextCheckAt = cloned.nextCheckAt;
  if (typeof nextCheckAt === "string" && nextCheckAt.trim() !== "") {
    const trimmed = nextCheckAt.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      cloned.nextCheckAt = `${trimmed}T00:00:00.000Z`;
    } else {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        cloned.nextCheckAt = parsed.toISOString();
      } else {
        delete cloned.nextCheckAt;
      }
    }
  }

  for (const caseKey of ["yesCase", "noCase"] as const) {
    const caseValue = cloned[caseKey];
    cloned[caseKey] = coerceOpinionCase(caseValue, caseKey);
  }

  const historical = cloned.historicalContext;
  cloned.historicalContext = coerceOpinionHistorical(historical);

  if (typeof cloned.modelTake !== "string" || cloned.modelTake.trim() === "") {
    const reasoning = (cloned as Record<string, unknown>).reasoning;
    const summary = (cloned as Record<string, unknown>).summary;
    if (typeof reasoning === "string" && reasoning.trim() !== "") {
      cloned.modelTake = reasoning;
    } else if (typeof summary === "string" && summary.trim() !== "") {
      cloned.modelTake = summary;
    }
  }

  if (typeof cloned.why !== "string" || cloned.why.trim() === "") {
    const lean = typeof cloned.lean === "string" ? cloned.lean : "TOSSUP";
    const modelTake = typeof cloned.modelTake === "string" ? cloned.modelTake : "";
    const firstSentence = modelTake.split(/(?<=[.!?])\s/)[0]?.trim();
    cloned.why = firstSentence && firstSentence.length > 0 ? firstSentence : `Model lean: ${lean}.`;
  }

  if (!Array.isArray(cloned.whatToWatch)) {
    cloned.whatToWatch = [];
  } else {
    cloned.whatToWatch = (cloned.whatToWatch as unknown[])
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .map((item) => item.trim());
  }

  return cloned;
}

const URL_PATTERN = /https?:\/\/[^\s)\]"']+/gi;

function extractUrlsFromText(text: string): { cleaned: string; urls: string[] } {
  const urls = Array.from(text.matchAll(URL_PATTERN)).map((match) => match[0]);
  const cleaned = text.replace(URL_PATTERN, "").replace(/\s+/g, " ").trim();
  return { cleaned, urls };
}

function coerceOpinionCase(value: unknown, caseKey: "yesCase" | "noCase"): unknown {
  const defaultHeadline = caseKey === "yesCase" ? "Reasons YES" : "Reasons NO";

  if (Array.isArray(value)) {
    const bullets = value
      .map((item) => coerceOpinionBullet(item))
      .filter((bullet): bullet is { text: string; citationUrls: string[] } => bullet !== null);
    return { headline: defaultHeadline, bullets };
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const headline =
      typeof obj.headline === "string" && obj.headline.trim() !== ""
        ? obj.headline
        : typeof obj.title === "string" && obj.title.trim() !== ""
          ? obj.title
          : defaultHeadline;
    const rawBullets = Array.isArray(obj.bullets)
      ? obj.bullets
      : Array.isArray(obj.points)
        ? obj.points
        : Array.isArray(obj.reasons)
          ? obj.reasons
          : [];
    const bullets = rawBullets
      .map((item) => coerceOpinionBullet(item))
      .filter((bullet): bullet is { text: string; citationUrls: string[] } => bullet !== null);
    return { headline, bullets };
  }

  return { headline: defaultHeadline, bullets: [] };
}

function coerceOpinionBullet(value: unknown): { text: string; citationUrls: string[] } | null {
  if (typeof value === "string") {
    const stripped = value.replace(/^[-*•\s]+/, "").trim();
    if (stripped === "") {
      return null;
    }
    const { cleaned, urls } = extractUrlsFromText(stripped);
    return { text: cleaned || stripped, citationUrls: urls };
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const text =
      typeof obj.text === "string" && obj.text.trim() !== ""
        ? obj.text.trim()
        : typeof obj.bullet === "string" && obj.bullet.trim() !== ""
          ? obj.bullet.trim()
          : typeof obj.point === "string" && obj.point.trim() !== ""
            ? obj.point.trim()
            : typeof obj.reason === "string" && obj.reason.trim() !== ""
              ? obj.reason.trim()
              : "";
    if (text === "") {
      return null;
    }
    const rawUrls = Array.isArray(obj.citationUrls)
      ? obj.citationUrls
      : Array.isArray(obj.citations)
        ? obj.citations
        : Array.isArray(obj.urls)
          ? obj.urls
          : [];
    const citationUrls = rawUrls
      .filter((url): url is string => typeof url === "string" && url.trim() !== "")
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//i.test(url));
    if (citationUrls.length === 0) {
      const extracted = extractUrlsFromText(text);
      return { text: extracted.cleaned || text, citationUrls: extracted.urls };
    }
    return { text, citationUrls };
  }

  return null;
}

function coerceOpinionHistorical(value: unknown): unknown {
  if (typeof value === "string") {
    return { narrative: value, priors: [] };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const narrative =
      typeof obj.narrative === "string" && obj.narrative.trim() !== ""
        ? obj.narrative
        : typeof obj.summary === "string" && obj.summary.trim() !== ""
          ? obj.summary
          : "Historical base rates not provided by the model.";
    const rawPriors = Array.isArray(obj.priors)
      ? obj.priors
      : Array.isArray(obj.examples)
        ? obj.examples
        : [];
    const priors = rawPriors
      .map((item) => {
        if (typeof item === "string" && item.trim() !== "") {
          return { label: item.slice(0, 80), detail: item };
        }
        if (item && typeof item === "object") {
          const itemObj = item as Record<string, unknown>;
          const label =
            typeof itemObj.label === "string" && itemObj.label.trim() !== ""
              ? itemObj.label
              : typeof itemObj.title === "string" && itemObj.title.trim() !== ""
                ? itemObj.title
                : "Prior";
          const detail =
            typeof itemObj.detail === "string" && itemObj.detail.trim() !== ""
              ? itemObj.detail
              : typeof itemObj.description === "string" && itemObj.description.trim() !== ""
                ? itemObj.description
                : label;
          return { label, detail };
        }
        return null;
      })
      .filter((p): p is { label: string; detail: string } => p !== null);
    return { narrative, priors };
  }

  return { narrative: "Historical base rates not provided by the model.", priors: [] };
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

type CombineOpinionInput = {
  market: MarketContext;
  parallelRun: ProviderResearchJudgment | undefined;
  xaiRun: ProviderResearchJudgment | undefined;
  directRun: ProviderResearchJudgment | undefined;
  appliedPolicy: AppliedPolicy;
  crossMarketContext?: NonNullable<MarketResearchResponse["crossMarketContext"]>;
};

type CombineOpinionResult = {
  opinion: Opinion;
  finalMode: ResearchFinalMode;
  notes: string[];
  ranLocalOpinion: boolean;
  localOpinionRun?: ProviderResearchJudgment;
};

async function combineOpinion(input: CombineOpinionInput): Promise<CombineOpinionResult> {
  const notes: string[] = [];
  const { market, parallelRun, xaiRun, directRun } = input;

  const xaiText =
    xaiRun?.ok && xaiRun.opinion?.modelTake && xaiRun.opinion.modelTake.trim() !== ""
      ? clipText(xaiRun.opinion.modelTake, 1200)
      : xaiRun?.ok && xaiRun.freeformAnswer && xaiRun.freeformAnswer.trim() !== ""
        ? clipText(xaiRun.freeformAnswer, 800)
        : undefined;

  const directStatus = directRun?.resolutionStatus;
  const directConfidence = directRun?.resolutionConfidence ?? 0;
  const directReasoning = directRun?.reasoning ?? directRun?.why;

  if (parallelRun?.ok && parallelRun.opinion) {
    const merged = mergeOpinionWithDirect(parallelRun.opinion, directStatus, directConfidence, directReasoning);
    const opinion = OpinionSchema.parse({
      ...merged,
      secondModelTake: xaiText,
      nextCheckAt: merged.nextCheckAt ?? buildNextCheckAt(market, merged.resolutionStatus)
    });

    if (directRun) {
      notes.push("direct_lane_consulted");
    }
    if (xaiText) {
      notes.push("xai_freeform_attached_as_second_take");
    }

    const finalMode: ResearchFinalMode = xaiRun?.ok || directRun ? "dual_synthesized" : "parallel_only";
    return {
      opinion,
      finalMode,
      notes,
      ranLocalOpinion: false
    };
  }

  if (parallelRun && !parallelRun.ok) {
    notes.push("parallel_failed");
  } else if (parallelRun && parallelRun.parseMode !== "json") {
    notes.push("parallel_returned_unstructured_output");
  } else if (!parallelRun) {
    notes.push("parallel_skipped");
  }

  if (xaiRun?.ok && xaiRun.opinion) {
    const merged = mergeOpinionWithDirect(xaiRun.opinion, directStatus, directConfidence, directReasoning);
    const opinion = OpinionSchema.parse({
      ...merged,
      secondModelTake: undefined,
      nextCheckAt: merged.nextCheckAt ?? buildNextCheckAt(market, merged.resolutionStatus)
    });
    notes.push("xai_structured_used_as_primary");

    const finalMode: ResearchFinalMode = directRun ? "dual_synthesized" : "xai_only";
    return {
      opinion,
      finalMode,
      notes,
      ranLocalOpinion: false
    };
  }

  if (xaiRun?.ok && xaiText) {
    const opinion = OpinionSchema.parse(
      buildOpinionFromXaiFreeform(market, xaiRun, directStatus, directConfidence, directReasoning)
    );
    notes.push("xai_freeform_used_as_primary");

    const finalMode: ResearchFinalMode = directRun ? "dual_synthesized" : "xai_only";
    return {
      opinion,
      finalMode,
      notes,
      ranLocalOpinion: false
    };
  }

  if (xaiRun && !xaiRun.ok) {
    notes.push("xai_failed");
  }

  if (directRun && directStatus && directStatus !== "NOT_YET_RESOLVED") {
    notes.push("direct_lane_resolved_alone");
    return {
      opinion: OpinionSchema.parse(buildDirectOnlyOpinion(market, directRun)),
      finalMode: "direct_only",
      notes,
      ranLocalOpinion: false
    };
  }

  notes.push("falling_back_to_local_opinion_floor");
  const localResult = await buildLocalOpinion(market, input.crossMarketContext).catch(() => null);
  if (localResult) {
    const opinion = OpinionSchema.parse({
      ...localResult.opinion,
      nextCheckAt: localResult.opinion.nextCheckAt ?? buildNextCheckAt(market, localResult.opinion.resolutionStatus)
    });

    return {
      opinion,
      finalMode: "local_floor",
      notes,
      ranLocalOpinion: true,
      localOpinionRun: localResult.judgment
    };
  }

  notes.push("local_opinion_floor_failed");
  return {
    opinion: OpinionSchema.parse(buildHardcodedFallbackOpinion(market)),
    finalMode: "failed",
    notes,
    ranLocalOpinion: false
  };
}

function mergeOpinionWithDirect(
  base: Opinion,
  directStatus: ResolutionStatus | undefined,
  directConfidence: number,
  directReasoning: string | undefined
): Opinion {
  if (!directStatus || directStatus === "NOT_YET_RESOLVED") {
    return base;
  }

  const lean: Lean = directStatus === "RESOLVED_YES" ? "STRONG_YES" : "STRONG_NO";
  const why = directReasoning ? `${base.why} Direct check: ${clipText(directReasoning, 240)}` : base.why;

  return {
    ...base,
    resolutionStatus: directStatus,
    resolutionConfidence: Math.max(base.resolutionConfidence, directConfidence),
    lean,
    leanConfidence: Math.max(base.leanConfidence, directConfidence),
    why
  };
}

function buildOpinionFromXaiFreeform(
  market: MarketContext,
  xaiRun: ProviderResearchJudgment,
  directStatus: ResolutionStatus | undefined,
  directConfidence: number,
  directReasoning: string | undefined
): Opinion {
  const text = xaiRun.freeformAnswer ?? "";
  const guessedLean = guessLeanFromFreeform(text);
  const resolutionStatus: ResolutionStatus = directStatus ?? "NOT_YET_RESOLVED";
  const yesPoints = extractDirectionalBullets(text, "yes");
  const noPoints = extractDirectionalBullets(text, "no");
  const citationUrls = xaiRun.citations
    .map((citation) => citation.url)
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);

  const finalLean: Lean =
    directStatus === "RESOLVED_YES"
      ? "STRONG_YES"
      : directStatus === "RESOLVED_NO"
        ? "STRONG_NO"
        : guessedLean;

  const directResolved = directStatus && directStatus !== "NOT_YET_RESOLVED";
  const baseConfidence = directResolved ? Math.max(0.85, directConfidence) : 0.45;

  return {
    resolutionStatus,
    resolutionConfidence: directResolved ? Math.max(0.85, directConfidence) : 0.45,
    lean: finalLean,
    leanConfidence: directResolved ? baseConfidence : 0.4,
    yesCase: {
      headline: "Reasons the market could resolve YES",
      bullets:
        yesPoints.length > 0
          ? yesPoints
          : [
              {
                text: "xAI did not return structured YES bullets; refer to the analyst narrative.",
                citationUrls
              }
            ]
    },
    noCase: {
      headline: "Reasons the market could resolve NO",
      bullets:
        noPoints.length > 0
          ? noPoints
          : [
              {
                text: "xAI did not return structured NO bullets; refer to the analyst narrative.",
                citationUrls
              }
            ]
    },
    historicalContext: {
      narrative:
        "Historical context unavailable from this provider; using fresh xAI web search results only.",
      priors: []
    },
    whatToWatch: ["A new official statement", "A direct contradiction from a tier-1 source"],
    modelTake: clipText(text, 600) ?? "xAI provided a freeform research narrative.",
    secondModelTake: undefined,
    nextCheckAt: buildNextCheckAt(market, resolutionStatus),
    why: directReasoning ?? `Synthesized from xAI freeform output (lean ${finalLean}).`
  };
}

function guessLeanFromFreeform(text: string): Lean {
  if (/\bresolves to yes\b|\bresolved yes\b|\bclearly yes\b|\bexpected to be yes\b/i.test(text)) {
    return "STRONG_YES";
  }
  if (/\bresolves to no\b|\bresolved no\b|\bclearly no\b|\bexpected to be no\b/i.test(text)) {
    return "STRONG_NO";
  }
  if (/\blean(?:s|ing)? (?:toward(?:s)? )?yes\b|\blikely yes\b|\bprobably yes\b/i.test(text)) {
    return "LEAN_YES";
  }
  if (/\blean(?:s|ing)? (?:toward(?:s)? )?no\b|\blikely no\b|\bprobably no\b/i.test(text)) {
    return "LEAN_NO";
  }
  return "TOSSUP";
}

function extractDirectionalBullets(text: string, direction: "yes" | "no"): OpinionCaseBullet[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const wanted = direction === "yes" ? /\byes\b/i : /\bno\b/i;
  const opposite = direction === "yes" ? /\bno\b/i : /\byes\b/i;

  const matches = sentences.filter((sentence) => wanted.test(sentence) && !opposite.test(sentence));
  return matches.slice(0, 3).map((sentence) => ({
    text: clipText(sentence, 240) ?? sentence,
    citationUrls: []
  }));
}

function buildDirectOnlyOpinion(market: MarketContext, directRun: ProviderResearchJudgment): Opinion {
  const status = directRun.resolutionStatus ?? "NOT_YET_RESOLVED";
  const lean: Lean = status === "RESOLVED_YES" ? "STRONG_YES" : status === "RESOLVED_NO" ? "STRONG_NO" : "TOSSUP";
  const why = directRun.reasoning ?? directRun.why;
  const citationUrls = directRun.citations
    .map((citation) => citation.url)
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);

  const yesText =
    status === "RESOLVED_YES"
      ? `Direct official-feed check confirms the YES condition: ${clipText(why, 220)}`
      : "Direct lane did not surface a YES-supporting condition.";
  const noText =
    status === "RESOLVED_NO"
      ? `Direct official-feed check confirms the NO condition: ${clipText(why, 220)}`
      : "Direct lane did not surface a NO-supporting condition.";

  return {
    resolutionStatus: status,
    resolutionConfidence: directRun.resolutionConfidence ?? 0.92,
    lean,
    leanConfidence: directRun.resolutionConfidence ?? 0.9,
    yesCase: {
      headline: status === "RESOLVED_YES" ? "Official feed confirms YES" : "Reasons YES",
      bullets: [{ text: yesText, citationUrls }]
    },
    noCase: {
      headline: status === "RESOLVED_NO" ? "Official feed confirms NO" : "Reasons NO",
      bullets: [{ text: noText, citationUrls }]
    },
    historicalContext: {
      narrative: "Direct rules-engine resolved this market without web search; historical context not synthesized.",
      priors: []
    },
    whatToWatch: ["Any superseding official correction or revision"],
    modelTake: clipText(why, 600) ?? "Direct rules-engine resolution.",
    secondModelTake: undefined,
    nextCheckAt: buildNextCheckAt(market, status),
    why
  };
}

function buildHardcodedFallbackOpinion(market: MarketContext): Opinion {
  const why = "All research providers failed; returning a neutral placeholder so the response stays valid. Please retry.";
  return {
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.2,
    lean: "TOSSUP",
    leanConfidence: 0.1,
    yesCase: {
      headline: "Reasons YES",
      bullets: [{ text: "No fresh evidence — provider lanes failed.", citationUrls: [] }]
    },
    noCase: {
      headline: "Reasons NO",
      bullets: [{ text: "No fresh evidence — provider lanes failed.", citationUrls: [] }]
    },
    historicalContext: {
      narrative: "Provider failure prevented any historical synthesis.",
      priors: []
    },
    whatToWatch: ["Re-run after provider lanes recover"],
    modelTake: why,
    secondModelTake: undefined,
    nextCheckAt: buildNextCheckAt(market, "NOT_YET_RESOLVED"),
    why
  };
}

function buildNextCheckAt(market: MarketContext, resolutionStatus: ResolutionStatus): string | undefined {
  if (resolutionStatus !== "NOT_YET_RESOLVED") {
    return undefined;
  }

  const deadline = Date.parse(market.canonicalMarket.endTimeUtc);
  const now = Date.now();
  const hoursUntilDeadline = Number.isNaN(deadline) ? 999 : (deadline - now) / (1000 * 60 * 60);
  const nextHours = hoursUntilDeadline <= 24 ? 2 : hoursUntilDeadline <= 72 ? 6 : 24;

  return new Date(now + nextHours * 60 * 60 * 1000).toISOString();
}
