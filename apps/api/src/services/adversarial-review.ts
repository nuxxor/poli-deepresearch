import { z } from "zod";
import {
  AdversarialReviewSchema,
  type AdversarialReview,
  type Claim,
  type CrossMarketContext,
  type EvidenceDoc,
  type Opinion,
  type ProviderResearchJudgment,
  type MarketContext
} from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { runOllamaGenerateTask } from "./providers/ollama.js";

const DebateMemoSchema = z.object({
  thesis: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(2).max(4)
});

const AdjudicationSchema = z.object({
  lean: z.enum(["STRONG_NO", "LEAN_NO", "TOSSUP", "LEAN_YES", "STRONG_YES"]),
  leanConfidence: z.coerce.number().min(0).max(1),
  resolutionStatus: z.enum(["NOT_YET_RESOLVED", "RESOLVED_YES", "RESOLVED_NO"]),
  resolutionConfidence: z.coerce.number().min(0).max(1),
  why: z.string().min(1),
  modelTake: z.string().min(1),
  whatToWatch: z.array(z.string().min(1)).max(5).default([])
});

type RunAdversarialReviewInput = {
  market: MarketContext;
  opinion: Opinion;
  providerJudgments: ProviderResearchJudgment[];
  evidence: EvidenceDoc[];
  claims: Claim[];
  crossMarketContext?: CrossMarketContext;
  skip?: boolean;
};

export async function runAdversarialReview(
  input: RunAdversarialReviewInput
): Promise<{ review: AdversarialReview; opinion: Opinion }> {
  if (input.skip || input.opinion.resolutionStatus !== "NOT_YET_RESOLVED") {
    return {
      review: AdversarialReviewSchema.parse({
        status: "skipped",
        changedOpinion: false,
        revisedLean: input.opinion.lean,
        revisedConfidence: input.opinion.leanConfidence,
        notes: ["adversarial_review_skipped"]
      }),
      opinion: input.opinion
    };
  }

  const providerSummary = input.providerJudgments
    .filter((provider) => provider.ok)
    .map((provider) => ({
      provider: provider.provider,
      lean: provider.opinion?.lean,
      confidence: provider.opinion?.leanConfidence,
      why: clip(provider.why, 180)
    }))
    .slice(0, 4);
  const evidenceSummary = input.evidence.slice(0, 4).map((doc) => ({
    title: doc.title ?? doc.canonicalUrl,
    sourceType: doc.sourceType,
    authorityScore: doc.authorityScore,
    directnessScore: doc.directnessScore
  }));
  const claimSummary = input.claims.slice(0, 8).map((claim) => ({
    polarity: claim.polarity,
    predicate: claim.predicate,
    object: clip(claim.object, 120),
    confidence: claim.confidence
  }));

  const supportPrompt = [
    "You are the supporter in an adversarial market-research debate.",
    "Return JSON only.",
    `Market: ${input.market.canonicalMarket.title}`,
    `Rules: ${clip(input.market.canonicalMarket.rulesText, 1000)}`,
    `Current lean: ${input.opinion.lean} @ ${input.opinion.leanConfidence}`,
    `Current why: ${input.opinion.why}`,
    `Providers: ${JSON.stringify(providerSummary)}`,
    `Evidence: ${JSON.stringify(evidenceSummary)}`,
    `Claims: ${JSON.stringify(claimSummary)}`,
    input.crossMarketContext ? `Cross-market: ${JSON.stringify(input.crossMarketContext.markets.slice(0, 3))}` : "",
    'Schema: {"thesis":"string","bullets":["string","string"]}',
    "Defend the current thesis using only decisive, resolution-relevant points."
  ]
    .filter(Boolean)
    .join("\n");

  const criticPrompt = [
    "You are the critic in an adversarial market-research debate.",
    "Return JSON only.",
    `Market: ${input.market.canonicalMarket.title}`,
    `Rules: ${clip(input.market.canonicalMarket.rulesText, 1000)}`,
    `Current lean: ${input.opinion.lean} @ ${input.opinion.leanConfidence}`,
    `Current why: ${input.opinion.why}`,
    `Providers: ${JSON.stringify(providerSummary)}`,
    `Evidence: ${JSON.stringify(evidenceSummary)}`,
    `Claims: ${JSON.stringify(claimSummary)}`,
    input.crossMarketContext ? `Cross-market: ${JSON.stringify(input.crossMarketContext.markets.slice(0, 3))}` : "",
    'Schema: {"thesis":"string","bullets":["string","string"]}',
    "Attack the thesis. Focus on missing decisive checks, contradictory evidence, or overconfidence."
  ]
    .filter(Boolean)
    .join("\n");

  const [supportTask, criticTask] = await Promise.all([
    runOllamaGenerateTask(supportPrompt, { model: env.OLLAMA_MODEL_REASONER, timeoutMs: 15000 }),
    runOllamaGenerateTask(criticPrompt, { model: env.OLLAMA_MODEL_REASONER, timeoutMs: 15000 })
  ]);

  const supportMemo =
    (supportTask.ok ? parseDebateMemoCandidate(supportTask.responseText) : null) ??
    buildFallbackMemo("support", input.opinion, providerSummary, claimSummary, input.crossMarketContext);
  const criticMemo =
    (criticTask.ok ? parseDebateMemoCandidate(criticTask.responseText) : null) ??
    buildFallbackMemo("critic", input.opinion, providerSummary, claimSummary, input.crossMarketContext);

  const adjudicatorPrompt = [
    "You are the adjudicator in an adversarial market-research debate.",
    "Return JSON only.",
    `Market: ${input.market.canonicalMarket.title}`,
    `Rules: ${clip(input.market.canonicalMarket.rulesText, 1000)}`,
    `Current opinion: ${JSON.stringify({
      lean: input.opinion.lean,
      leanConfidence: input.opinion.leanConfidence,
      resolutionStatus: input.opinion.resolutionStatus,
      resolutionConfidence: input.opinion.resolutionConfidence,
      why: input.opinion.why
    })}`,
    `Support memo: ${JSON.stringify(supportMemo)}`,
    `Critic memo: ${JSON.stringify(criticMemo)}`,
    `Claims: ${JSON.stringify(claimSummary)}`,
    input.crossMarketContext ? `Cross-market: ${JSON.stringify(input.crossMarketContext.markets.slice(0, 3))}` : "",
    'Schema: {"lean":"STRONG_NO|LEAN_NO|TOSSUP|LEAN_YES|STRONG_YES","leanConfidence":0.0,"resolutionStatus":"NOT_YET_RESOLVED|RESOLVED_YES|RESOLVED_NO","resolutionConfidence":0.0,"why":"string","modelTake":"string","whatToWatch":["string"]}',
    "Revise the opinion only if the critic materially weakens the thesis or the support materially strengthens it."
  ]
    .filter(Boolean)
    .join("\n");

  const adjudicatorTask = await runOllamaGenerateTask(adjudicatorPrompt, {
    model: env.OLLAMA_MODEL_REASONER,
    timeoutMs: 18000
  });
  const adjudication =
    (adjudicatorTask.ok
      ? parseAdjudicationCandidate(adjudicatorTask.responseText, input.opinion)
      : null) ?? buildFallbackAdjudication(input.opinion, supportMemo, criticMemo);

  const opinion = applyAdversarialRevision(input.opinion, adjudication);
  const changedOpinion =
    opinion.lean !== input.opinion.lean ||
    opinion.resolutionStatus !== input.opinion.resolutionStatus ||
    Math.abs(opinion.leanConfidence - input.opinion.leanConfidence) >= 0.05;

  return {
    review: AdversarialReviewSchema.parse({
      status: "applied",
      changedOpinion,
      supportCase: joinMemo(supportMemo),
      critiqueCase: joinMemo(criticMemo),
      adjudication: adjudication.why,
      revisedLean: opinion.lean,
      revisedConfidence: opinion.leanConfidence,
      notes: [
        changedOpinion ? "opinion_revised" : "opinion_confirmed",
        ...(supportTask.ok ? [] : ["support_memo_fallback"]),
        ...(criticTask.ok ? [] : ["critique_memo_fallback"]),
        ...(adjudicatorTask.ok ? [] : ["adjudication_fallback"])
      ]
    }),
    opinion
  };
}

export function applyAdversarialRevision(
  opinion: Opinion,
  adjudication: z.infer<typeof AdjudicationSchema>
): Opinion {
  return {
    ...opinion,
    lean: adjudication.lean,
    leanConfidence: adjudication.leanConfidence,
    resolutionStatus: adjudication.resolutionStatus,
    resolutionConfidence: Math.max(opinion.resolutionConfidence, adjudication.resolutionConfidence),
    why: adjudication.why,
    modelTake: adjudication.modelTake,
    whatToWatch:
      adjudication.whatToWatch.length > 0
        ? [...new Set([...adjudication.whatToWatch, ...opinion.whatToWatch])].slice(0, 5)
        : opinion.whatToWatch
  };
}

export function parseDebateMemoCandidate(raw: string): z.infer<typeof DebateMemoSchema> | null {
  return parseJsonCandidate(raw, DebateMemoSchema) ?? salvageDebateMemo(raw);
}

export function parseAdjudicationCandidate(
  raw: string,
  opinion: Opinion
): z.infer<typeof AdjudicationSchema> | null {
  return parseJsonCandidate(raw, AdjudicationSchema) ?? salvageAdjudication(raw, opinion);
}

function buildFallbackMemo(
  role: "support" | "critic",
  opinion: Opinion,
  providerSummary: Array<{ provider: string; lean?: string; confidence?: number; why: string }>,
  claimSummary: Array<{ polarity: string; predicate: string; object: string; confidence: number }>,
  crossMarketContext: CrossMarketContext | undefined
): z.infer<typeof DebateMemoSchema> {
  const providerBullet = providerSummary[0]
    ? `${providerSummary[0].provider} leans ${providerSummary[0].lean ?? "unknown"} with ${Math.round((providerSummary[0].confidence ?? 0) * 100)}% confidence.`
    : "No external provider lane produced a decisive counterweight.";
  const claimBullet = claimSummary[0]
    ? `${claimSummary[0].predicate} ${claimSummary[0].object} (${claimSummary[0].polarity}).`
    : "No extracted claim materially settles the market yet.";
  const crossMarketBullet = crossMarketContext?.markets?.[0]
    ? `Related market context: ${crossMarketContext.markets[0].title}.`
    : "Cross-market context is too weak to settle the market on its own.";

  if (role === "support") {
    return DebateMemoSchema.parse({
      thesis: opinion.why,
      bullets: [providerBullet, claimBullet, crossMarketBullet].slice(0, 4)
    });
  }

  return DebateMemoSchema.parse({
    thesis: "The current thesis may be overstated or missing a decisive confirming check.",
    bullets: [
      "The market is still unresolved, so early confidence should be treated cautiously.",
      claimBullet,
      crossMarketBullet
    ].slice(0, 4)
  });
}

function buildFallbackAdjudication(
  opinion: Opinion,
  supportMemo: z.infer<typeof DebateMemoSchema>,
  criticMemo: z.infer<typeof DebateMemoSchema>
): z.infer<typeof AdjudicationSchema> {
  return AdjudicationSchema.parse({
    lean: opinion.lean,
    leanConfidence: opinion.leanConfidence,
    resolutionStatus: opinion.resolutionStatus,
    resolutionConfidence: opinion.resolutionConfidence,
    why: clip(
      `Fallback adjudication kept the current lean. Support: ${supportMemo.thesis} Critique: ${criticMemo.thesis}`,
      240
    ),
    modelTake: opinion.modelTake,
    whatToWatch: opinion.whatToWatch
  });
}

function parseJsonCandidate<T>(raw: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  const candidates = [
    raw.trim(),
    raw.match(/```json\s*([\s\S]*?)```/i)?.[1],
    raw.match(/```[\s\S]*?({[\s\S]*})[\s\S]*?```/i)?.[1],
    extractFirstJson(raw)
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim() !== ""));

  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return null;
}

function extractFirstJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function salvageDebateMemo(raw: string): z.infer<typeof DebateMemoSchema> | null {
  const lines = normalizedLines(raw);
  if (lines.length === 0) {
    return null;
  }

  const bulletLines = lines
    .filter((line) => /^[-*•]\s+|^\d+[.)]\s+/.test(line))
    .map(stripBulletPrefix)
    .filter((line) => line.length >= 8);
  const sentencePool = lines
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  const thesis = stripLabel(sentencePool[0] ?? lines[0] ?? "");
  const bullets = dedupeTrimmed([
    ...bulletLines,
    ...sentencePool.slice(1)
  ]).filter((line) => line !== thesis);

  if (thesis.length < 8 || bullets.length < 2) {
    return null;
  }

  return DebateMemoSchema.parse({
    thesis,
    bullets: bullets.slice(0, 4)
  });
}

function salvageAdjudication(raw: string, opinion: Opinion): z.infer<typeof AdjudicationSchema> | null {
  const lines = normalizedLines(raw);
  if (lines.length === 0) {
    return null;
  }

  const normalized = lines.join("\n");
  const why = stripLabel(lines.find((line) => /^(why|adjudication|decision|rationale)\s*:/i.test(line)) ?? lines[0] ?? "");
  const modelTake = stripLabel(
    lines.find((line) => /^(model take|take|summary|bottom line)\s*:/i.test(line)) ??
      lines.find((line) => line !== why) ??
      why
  );
  const watchLine = lines.find((line) => /watch/i.test(line));
  const watchItems = watchLine
    ? stripLabel(watchLine)
        .split(/[,;]| \| /)
        .map((item) => item.trim())
        .filter((item) => item.length >= 6)
        .slice(0, 5)
    : [];

  try {
    return AdjudicationSchema.parse({
      lean: extractLean(normalized) ?? opinion.lean,
      leanConfidence: extractConfidence(normalized, opinion.leanConfidence),
      resolutionStatus: extractResolutionStatus(normalized) ?? opinion.resolutionStatus,
      resolutionConfidence: extractResolutionConfidence(normalized, opinion.resolutionConfidence),
      why,
      modelTake,
      whatToWatch: watchItems
    });
  } catch {
    return null;
  }
}

function joinMemo(memo: z.infer<typeof DebateMemoSchema>): string {
  return [memo.thesis, ...memo.bullets].join(" ");
}

function clip(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizedLines(raw: string): string[] {
  return raw
    .replace(/```json|```/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function stripBulletPrefix(value: string): string {
  return value.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
}

function stripLabel(value: string): string {
  return value.replace(/^[a-z][a-z\s_-]{0,24}:\s*/i, "").trim();
}

function dedupeTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const trimmed = stripLabel(value).replace(/\s+/g, " ").trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    items.push(trimmed);
  }

  return items;
}

function extractLean(text: string): z.infer<typeof AdjudicationSchema>["lean"] | null {
  const match = text.match(/\b(STRONG_NO|LEAN_NO|TOSSUP|LEAN_YES|STRONG_YES)\b/i);
  return match?.[1] ? match[1].toUpperCase() as z.infer<typeof AdjudicationSchema>["lean"] : null;
}

function extractResolutionStatus(text: string): z.infer<typeof AdjudicationSchema>["resolutionStatus"] | null {
  const match = text.match(/\b(RESOLVED_YES|RESOLVED_NO|NOT_YET_RESOLVED)\b/i);
  return match?.[1] ? match[1].toUpperCase() as z.infer<typeof AdjudicationSchema>["resolutionStatus"] : null;
}

function extractConfidence(text: string, fallback: number): number {
  const confidencePatterns = [
    /lean(?:\s+confidence)?\s*[:=]\s*(\d+(?:\.\d+)?%?)/i,
    /\bconfidence\s*[:=]\s*(\d+(?:\.\d+)?%?)/i
  ];

  for (const pattern of confidencePatterns) {
    const match = text.match(pattern);
    const parsed = parseConfidenceValue(match?.[1]);
    if (parsed != null) {
      return parsed;
    }
  }

  return fallback;
}

function extractResolutionConfidence(text: string, fallback: number): number {
  const match = text.match(/\bresolution(?:\s+confidence)?\s*[:=]\s*(\d+(?:\.\d+)?%?)/i);
  const parsed = parseConfidenceValue(match?.[1]);
  return parsed ?? fallback;
}

function parseConfidenceValue(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim();
  const numeric = Number.parseFloat(normalized.replace(/%$/, ""));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (normalized.endsWith("%")) {
    return Math.max(0, Math.min(1, numeric / 100));
  }

  if (numeric > 1) {
    return Math.max(0, Math.min(1, numeric / 100));
  }

  return Math.max(0, Math.min(1, numeric));
}
