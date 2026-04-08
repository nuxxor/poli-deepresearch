import { createHash } from "node:crypto";

import { z } from "zod";
import {
  ClaimSchema,
  type CrossMarketContext,
  LocalPlannerSchema,
  OfflineSummarySchema,
  OpinionSchema,
  ProviderResearchJudgmentSchema,
  SearchQueryPlanSchema,
  type Claim,
  type EvidenceDoc,
  type LocalPlanner,
  type MarketContext,
  type OfflineSummary,
  type Opinion,
  type ProviderResearchJudgment,
  type ProviderSearchResultItem,
  type ProviderSearchRun,
  type SearchQueryPlan
} from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { buildSearchQueryPlan } from "./queries.js";
import { runOllamaGenerateTask } from "./providers/ollama.js";
import { dedupeStrings } from "./urls.js";

const PlannerOutputSchema = z.object({
  topic: z.string().min(1).optional(),
  officialQuery: z.string().min(1),
  webQuery: z.string().min(1),
  socialQuery: z.string().min(1),
  contradictionQuery: z.string().min(1),
  notes: z.array(z.string()).default([])
});

const ClaimDraftSchema = z.object({
  docId: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  polarity: z.enum(["supports_yes", "supports_no", "neutral", "contradictory"]),
  confidence: z.coerce.number().min(0).max(1),
  eventTime: z.string().optional()
});

const ClaimDraftListSchema = z.object({
  claims: z.array(ClaimDraftSchema).max(12)
});

export async function buildLocalPlanner(market: MarketContext): Promise<LocalPlanner> {
  const basePlan = buildSearchQueryPlan(market);
  const prompt = [
    "You refine Polymarket research queries.",
    "Return JSON only.",
    `Market title: ${market.canonicalMarket.title}`,
    `Category: ${market.canonicalMarket.category}`,
    `Resolution archetype: ${market.canonicalMarket.resolutionArchetype}`,
    `Rules text: ${market.canonicalMarket.rulesText}`,
    `Base official query: ${basePlan.officialQuery}`,
    `Base web query: ${basePlan.webQuery}`,
    `Base social query: ${basePlan.socialQuery}`,
    `Base contradiction query: ${basePlan.contradictionQuery}`,
    'Schema: {"topic":"optional string","officialQuery":"string","webQuery":"string","socialQuery":"string","contradictionQuery":"string","notes":["string"]}',
    "Keep queries concise, official-source-first, and resolution-aware."
  ].join("\n");

  const task = await runOllamaGenerateTask(prompt, {
    model: env.OLLAMA_MODEL_PRIMARY,
    timeoutMs: 6000
  });

  if (!task.ok) {
    return LocalPlannerSchema.parse({
      source: "deterministic",
      queryPlan: basePlan,
      notes: ["ollama_planner_unavailable"]
    });
  }

  const parsed = parseJsonCandidate(task.responseText, PlannerOutputSchema);
  if (!parsed) {
    return LocalPlannerSchema.parse({
      source: "deterministic",
      model: task.model,
      queryPlan: basePlan,
      notes: ["ollama_planner_parse_failed"]
    });
  }

  const mergedPlan = SearchQueryPlanSchema.parse({
    ...basePlan,
    topic: parsed.topic?.trim() ? parsed.topic.trim() : basePlan.topic,
    officialQuery: parsed.officialQuery,
    webQuery: parsed.webQuery,
    socialQuery: parsed.socialQuery,
    contradictionQuery: parsed.contradictionQuery,
    queryNotes: dedupeStrings([
      ...basePlan.queryNotes,
      ...(parsed.notes ?? [])
    ])
  });

  return LocalPlannerSchema.parse({
    source: "ollama",
    model: task.model,
    queryPlan: mergedPlan,
    notes: parsed.notes ?? []
  });
}

export async function extractClaimsWithLocalModel(
  market: MarketContext,
  evidence: EvidenceDoc[]
): Promise<Claim[] | null> {
  if (evidence.length === 0) {
    return [];
  }

  const prompt = [
    "You extract strict, resolution-relevant claims from evidence docs for a Polymarket market.",
    "Return JSON only.",
    `Market title: ${market.canonicalMarket.title}`,
    `Resolution archetype: ${market.canonicalMarket.resolutionArchetype}`,
    `Rules text: ${market.canonicalMarket.rulesText}`,
    "For each claim, use one of: supports_yes, supports_no, neutral, contradictory.",
    'Schema: {"claims":[{"docId":"string","predicate":"string","object":"string","polarity":"supports_yes|supports_no|neutral|contradictory","confidence":0.0,"eventTime":"optional ISO datetime"}]}',
    `Docs: ${JSON.stringify(evidence.slice(0, 5).map((doc) => ({
      docId: doc.docId,
      title: doc.title,
      sourceType: doc.sourceType,
      publishedAt: doc.publishedAt,
      content: clipForLocal(doc.contentMarkdown, 1800)
    })))}`
  ].join("\n");

  const task = await runOllamaGenerateTask(prompt, {
    model: env.OLLAMA_MODEL_PRIMARY,
    timeoutMs: 8000
  });

  if (!task.ok) {
    return null;
  }

  const parsed = parseJsonCandidate(task.responseText, ClaimDraftListSchema);
  if (!parsed) {
    return null;
  }

  const subject = market.canonicalMarket.title.replace(/\?+$/, "").trim();
  return parsed.claims.map((claim) =>
    ClaimSchema.parse({
      claimId: `claim:${createHash("sha1").update([claim.docId, claim.predicate, claim.object].join("|")).digest("hex").slice(0, 12)}`,
      docId: claim.docId,
      claimType: market.canonicalMarket.resolutionArchetype,
      subject,
      predicate: claim.predicate,
      object: clipForLocal(claim.object, 220),
      eventTime: toIsoDateMaybe(claim.eventTime),
      polarity: claim.polarity,
      confidence: claim.confidence,
      origin: "local_model"
    })
  );
}

export async function buildOfflineSummary(
  market: MarketContext,
  opinion: Opinion,
  claims: Claim[],
  evidence: EvidenceDoc[],
  citations: ProviderSearchResultItem[]
): Promise<OfflineSummary | null> {
  const citationPool = dedupeCitationPool(evidence, citations).slice(0, 6);
  const prompt = [
    "You write a concise but readable research note for a Polymarket market.",
    "Return JSON only.",
    `Market title: ${market.canonicalMarket.title}`,
    `Lean: ${opinion.lean} @ ${opinion.leanConfidence}`,
    `Resolution status: ${opinion.resolutionStatus} @ ${opinion.resolutionConfidence}`,
    `Why: ${opinion.why}`,
    `Analyst take: ${opinion.modelTake}`,
    `Claims: ${JSON.stringify(claims.slice(0, 6))}`,
    `Evidence titles: ${JSON.stringify(evidence.slice(0, 5).map((doc) => doc.title ?? doc.canonicalUrl))}`,
    `Citation pool: ${JSON.stringify(citationPool)}`,
    'Schema: {"headline":"string","summary":"string","watchItems":["string"],"lede":"string","sections":[{"heading":"Bull case|Bear case|What matters","body":"string","citations":[{"label":"string","url":"https://..."}]}],"closing":"string"}',
    "Write like a research copilot, not a resolver.",
    "Citations must come from the citation pool only.",
    "Do not mention provider names, internal pipeline, retries, cost, cache, or debugging details.",
    "Keep sections short, concrete, and source-backed."
  ].join("\n");

  const task = await runOllamaGenerateTask(prompt, {
    model: env.OLLAMA_MODEL_REASONER,
    timeoutMs: 8000
  });

  if (!task.ok) {
    return null;
  }

  const parsed = parseJsonCandidate(task.responseText, OfflineSummarySchema.omit({
    source: true,
    model: true
  }));
  if (!parsed) {
    return null;
  }

  return OfflineSummarySchema.parse({
    source: "ollama",
    model: task.model,
    headline: parsed.headline,
    summary: parsed.summary,
    watchItems: parsed.watchItems,
    lede: parsed.lede,
    sections: parsed.sections,
    closing: parsed.closing
  });
}

function dedupeCitationPool(evidence: EvidenceDoc[], citations: ProviderSearchResultItem[]) {
  const seen = new Set<string>();
  const pool: Array<{ label: string; url: string }> = [];

  for (const doc of evidence) {
    const url = doc.canonicalUrl ?? doc.url;
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    pool.push({
      label: doc.title ?? url,
      url
    });
  }

  for (const item of citations) {
    const url = item.url;
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    pool.push({
      label: item.title ?? url,
      url
    });
  }

  return pool;
}

function parseJsonCandidate<T>(raw: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  const candidates = [
    raw.trim(),
    raw.match(/```json\s*([\s\S]*?)```/i)?.[1],
    raw.match(/```[\s\S]*?({[\s\S]*}|\[[\s\S]*\])[\s\S]*?```/i)?.[1],
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
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1);
  }

  return null;
}

function clipForLocal(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function toIsoDateMaybe(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return new Date(`${value.trim()}T00:00:00Z`).toISOString();
  }

  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

const LocalBulletSchema = z
  .union([
    z.string().min(1),
    z.object({
      text: z.string().min(1).optional(),
      bullet: z.string().min(1).optional(),
      point: z.string().min(1).optional(),
      citationUrls: z.array(z.string()).optional(),
      citations: z.array(z.string()).optional()
    })
  ])
  .transform((value) => {
    if (typeof value === "string") {
      return { text: value, citationUrls: [] };
    }
    const text = value.text ?? value.bullet ?? value.point ?? "";
    const citationUrls = value.citationUrls ?? value.citations ?? [];
    return { text, citationUrls };
  })
  .pipe(
    z.object({
      text: z.string().min(1),
      citationUrls: z.array(z.string()).default([])
    })
  );

const LocalCaseSchema = z
  .union([
    z.object({
      headline: z.string().min(1),
      bullets: z.array(LocalBulletSchema).min(1)
    }),
    z.array(LocalBulletSchema).min(1)
  ])
  .transform((value) => {
    if (Array.isArray(value)) {
      return { headline: "", bullets: value };
    }
    return value;
  });

const LocalPriorSchema = z
  .union([
    z.string().min(1),
    z.object({
      label: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      detail: z.string().min(1).optional(),
      description: z.string().min(1).optional()
    })
  ])
  .transform((value) => {
    if (typeof value === "string") {
      return { label: value.slice(0, 80), detail: value };
    }
    const label = value.label ?? value.title ?? "Prior";
    const detail = value.detail ?? value.description ?? label;
    return { label, detail };
  })
  .pipe(
    z.object({
      label: z.string().min(1),
      detail: z.string().min(1)
    })
  );

const LocalOpinionDraftSchema = z
  .object({
    resolutionStatus: z.enum(["NOT_YET_RESOLVED", "RESOLVED_YES", "RESOLVED_NO"]),
    resolutionConfidence: z.coerce.number().min(0).max(1),
    lean: z.enum(["STRONG_NO", "LEAN_NO", "TOSSUP", "LEAN_YES", "STRONG_YES"]),
    leanConfidence: z.coerce.number().min(0).max(1),
    yesCase: LocalCaseSchema,
    noCase: LocalCaseSchema,
    historicalContext: z.object({
      narrative: z.string().min(1),
      priors: z.array(LocalPriorSchema).default([])
    }),
    whatToWatch: z.array(z.string().min(1)).default([]),
    modelTake: z.string().min(1),
    why: z.string().min(1)
  })
  .transform((value) => ({
    ...value,
    yesCase: {
      headline: value.yesCase.headline || "Reasons YES",
      bullets: value.yesCase.bullets
    },
    noCase: {
      headline: value.noCase.headline || "Reasons NO",
      bullets: value.noCase.bullets
    }
  }));

export async function buildLocalOpinion(
  market: MarketContext,
  crossMarketContext?: CrossMarketContext
): Promise<{ opinion: Opinion; judgment: ProviderResearchJudgment } | null> {
  const startedAt = Date.now();
  const prompt = [
    "You are a Polymarket research analyst. The web research providers are unavailable, so produce a directional opinion using ONLY your training-data knowledge and the rules below.",
    "Return JSON ONLY matching the schema. Do NOT default to TOSSUP unless you genuinely have no prior to lean on.",
    `Market title: ${market.canonicalMarket.title}`,
    `Category: ${market.canonicalMarket.category}`,
    `Resolution archetype: ${market.canonicalMarket.resolutionArchetype}`,
    `Deadline (UTC): ${market.canonicalMarket.endTimeUtc}`,
    `Rules text: ${clipForLocal(market.canonicalMarket.rulesText, 1400)}`,
    market.canonicalMarket.resolutionSourceText
      ? `Resolution source text: ${clipForLocal(market.canonicalMarket.resolutionSourceText, 400)}`
      : "Resolution source text: (none)",
    "Lean must be one of: STRONG_NO, LEAN_NO, TOSSUP, LEAN_YES, STRONG_YES.",
    "resolutionStatus must be NOT_YET_RESOLVED unless your training-data clearly shows the market is already settled.",
    "yesCase and noCase each need at least 2 bullets — present the strongest argument for each side.",
    "historicalContext should cite past base rates and similar past events from your training-data knowledge. Be concrete.",
    "whatToWatch lists 2-4 observable signals that would shift your lean.",
    "modelTake is your one-paragraph analyst voice. why is one short sentence summarizing the lean.",
    "Citations must be empty arrays — there are no fresh web results in this lane.",
    crossMarketContext?.markets?.length
      ? `Cross-market context from archived and live related markets: ${JSON.stringify(
          crossMarketContext.markets.slice(0, 4).map((item) => ({
            title: item.title,
            relation: item.relation,
            overlapScore: item.overlapScore,
            lean: item.lean,
            leanConfidence: item.leanConfidence,
            resolutionStatus: item.resolutionStatus,
            why: item.why
          }))
        )}`
      : "Cross-market context: none",
    'Schema: {"resolutionStatus":"NOT_YET_RESOLVED|RESOLVED_YES|RESOLVED_NO","resolutionConfidence":0.0,"lean":"STRONG_NO|LEAN_NO|TOSSUP|LEAN_YES|STRONG_YES","leanConfidence":0.0,"yesCase":{"headline":"string","bullets":[{"text":"string","citationUrls":[]}]},"noCase":{"headline":"string","bullets":[{"text":"string","citationUrls":[]}]},"historicalContext":{"narrative":"string","priors":[{"label":"string","detail":"string"}]},"whatToWatch":["string"],"modelTake":"string","why":"string"}'
  ].join("\n");

  const task = await runOllamaGenerateTask(prompt, {
    model: env.OLLAMA_MODEL_REASONER,
    timeoutMs: 90000
  });

  const raw: ProviderSearchRun = {
    provider: "ollama-local-opinion",
    ok: task.ok,
    query: clipForLocal(market.canonicalMarket.title, 240),
    durationMs: Date.now() - startedAt,
    resultCount: 0,
    estimatedRetrievalCostUsd: 0,
    results: [],
    meta: {
      model: task.model,
      answer: task.responseText
    }
  };

  if (!task.ok) {
    return null;
  }

  const parsed = parseJsonCandidate(task.responseText, LocalOpinionDraftSchema);
  if (!parsed) {
    return null;
  }

  const opinion = OpinionSchema.parse({
    ...parsed,
    secondModelTake: undefined
  });

  const judgment = ProviderResearchJudgmentSchema.parse({
    provider: "ollama-local-opinion",
    ok: true,
    parseMode: "json",
    opinion,
    resolutionStatus: opinion.resolutionStatus,
    resolutionConfidence: opinion.resolutionConfidence,
    reasoning: opinion.modelTake,
    why: opinion.why,
    citations: [],
    rawAnswer: task.responseText,
    raw
  });

  return { opinion, judgment };
}
