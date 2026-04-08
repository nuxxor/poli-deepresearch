import { z } from "zod";

export const DeepResearchEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4010),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  POLYMARKET_GAMMA_API_URL: z.string().url().default("https://gamma-api.polymarket.com"),
  POLYMARKET_CLOB_API_URL: z.string().url().default("https://clob.polymarket.com"),
  POLYMARKET_MARKET_WS_URL: z
    .string()
    .url()
    .default("wss://ws-subscriptions-clob.polymarket.com/ws/market"),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@127.0.0.1:5432/polymarket_research"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379/0"),
  SERPER_API_KEY: z.string().default(""),
  BRAVE_API_KEY: z.string().default(""),
  EXA_API_KEY: z.string().default(""),
  PARALLEL_API_KEY: z.string().default(""),
  TWITTERAPI_KEY: z.string().default(""),
  FRED_API_KEY: z.string().default(""),
  GDELT_DOC_API_BASE: z.string().url().default("https://api.gdeltproject.org/api/v2/doc/doc"),
  BINANCE_SPOT_API_URL: z.string().url().default("https://api.binance.com"),
  DISABLE_PAID_RESEARCH: z
    .string()
    .default("false")
    .transform((value) => {
      const normalized = value.trim().toLowerCase();
      return normalized === "true" || normalized === "1" || normalized === "yes";
    }),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434/api"),
  OLLAMA_MODEL_PRIMARY: z.string().default("qwen2.5:32b-instruct"),
  OLLAMA_MODEL_REASONER: z.string().default("qwen2.5:32b-instruct"),
  OLLAMA_MODEL_CODER: z.string().default("qwen2.5:32b-instruct"),
  VLLM_BASE_URL: z.string().url().default("http://127.0.0.1:8000/v1"),
  LITELLM_PROXY_BASE_URL: z.string().url().default("http://127.0.0.1:4000"),
  LANGFUSE_BASE_URL: z.string().default(""),
  LANGFUSE_PUBLIC_KEY: z.string().default(""),
  LANGFUSE_SECRET_KEY: z.string().default(""),
  XAI_API_KEY: z.string().default(""),
  FIREWORKS_API_KEY: z.string().default("")
});

export const RunTypeSchema = z.enum(["fast_refresh", "deep_refresh", "monitor_tick", "replay_run"]);

export const CanonicalMarketSchema = z.object({
  marketId: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  rulesText: z.string().min(1),
  additionalContext: z.string().optional(),
  endTimeUtc: z.string().datetime(),
  resolutionSourceText: z.string().optional(),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  tags: z.array(z.string()),
  relatedTags: z.array(z.string()),
  resolutionArchetype: z.string().min(1),
  officialSourceRequired: z.boolean(),
  earlyNoAllowed: z.boolean(),
  priceBlind: z.literal(true)
});

export const EvidenceDocSchema = z.object({
  docId: z.string().min(1),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  title: z.string().optional(),
  sourceType: z.enum(["official", "wire", "major_media", "trade", "social", "blog", "unknown"]),
  publishedAt: z.string().datetime().optional(),
  observedAt: z.string().datetime(),
  fetchedAt: z.string().datetime(),
  retrievalChannel: z.enum(["official", "serper", "dataforseo", "gdelt", "x", "brave", "exa", "parallel"]),
  extractor: z.enum(["trafilatura", "parallel", "firecrawl"]),
  authorityScore: z.number(),
  freshnessScore: z.number(),
  directnessScore: z.number(),
  language: z.string().optional(),
  contentMarkdown: z.string()
});

export const ClaimSchema = z.object({
  claimId: z.string().min(1),
  docId: z.string().min(1),
  claimType: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  eventTime: z.string().datetime().optional(),
  polarity: z.enum(["supports_yes", "supports_no", "neutral", "contradictory"]),
  confidence: z.number().min(0).max(1)
});

export const ResolutionStatusSchema = z.enum([
  "NOT_YET_RESOLVED",
  "RESOLVED_YES",
  "RESOLVED_NO"
]);

export const LeanSchema = z.enum([
  "STRONG_NO",
  "LEAN_NO",
  "TOSSUP",
  "LEAN_YES",
  "STRONG_YES"
]);

export const OpinionCaseBulletSchema = z.object({
  text: z.string().min(1),
  citationUrls: z.array(z.string().url()).default([])
});

export const OpinionCaseSchema = z.object({
  headline: z.string().min(1),
  bullets: z.array(OpinionCaseBulletSchema).min(1)
});

export const OpinionHistoricalPriorSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1)
});

export const OpinionHistoricalContextSchema = z.object({
  narrative: z.string().min(1),
  priors: z.array(OpinionHistoricalPriorSchema).default([])
});

export const OpinionSchema = z.object({
  resolutionStatus: ResolutionStatusSchema,
  resolutionConfidence: z.number().min(0).max(1),
  lean: LeanSchema,
  leanConfidence: z.number().min(0).max(1),
  yesCase: OpinionCaseSchema,
  noCase: OpinionCaseSchema,
  historicalContext: OpinionHistoricalContextSchema,
  whatToWatch: z.array(z.string().min(1)).default([]),
  modelTake: z.string().min(1),
  secondModelTake: z.string().optional(),
  nextCheckAt: z.string().datetime().optional(),
  why: z.string().min(1)
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("deep-research-api"),
  time: z.string().datetime(),
  version: z.string().min(1)
});

export const PolymarketEventSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    slug: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    endDate: z.string().optional(),
    category: z.string().optional(),
    subcategory: z.string().nullable().optional(),
    resolutionSource: z.string().nullable().optional()
  })
  .passthrough();

export const PolymarketMarketSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    question: z.string(),
    conditionId: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    subcategory: z.string().nullable().optional(),
    endDate: z.string().optional(),
    resolutionSource: z.string().nullable().optional(),
    outcomes: z.union([z.string(), z.array(z.string())]).optional(),
    outcomePrices: z.union([z.string(), z.array(z.string())]).optional(),
    clobTokenIds: z.union([z.string(), z.array(z.string())]).optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    events: z.array(PolymarketEventSchema).optional()
  })
  .passthrough();

export const MarketContextSchema = z.object({
  rawMarket: PolymarketMarketSchema,
  canonicalMarket: CanonicalMarketSchema,
  tokenIds: z.array(z.string())
});

export const ResolutionAuthorityKindSchema = z.enum([
  "official_statement",
  "government",
  "regulator",
  "league",
  "court_record",
  "economic_release",
  "exchange_data",
  "company_ir",
  "publisher",
  "institution",
  "unknown"
]);

export const ResolutionComparatorSchema = z.enum([
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "equal_to",
  "official_confirmation",
  "occurs",
  "not_occurs",
  "winner",
  "legal_outcome",
  "appointment_change",
  "unknown"
]);

export const ResolutionContractSchema = z.object({
  subject: z.string().min(1),
  eventLabel: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  comparator: ResolutionComparatorSchema,
  metricName: z.string().min(1).optional(),
  thresholdValue: z.number().optional(),
  thresholdUnit: z.string().min(1).optional(),
  deadlineUtc: z.string().datetime().optional(),
  authorityKinds: z.array(ResolutionAuthorityKindSchema).min(1),
  officialSourceRequired: z.boolean(),
  earlyNoAllowed: z.boolean(),
  decisiveYesRule: z.string().min(1),
  decisiveNoRule: z.string().min(1),
  notes: z.array(z.string()).default([])
});

export const ResearchActionabilitySchema = z.enum([
  "high_conviction",
  "monitor",
  "abstain"
]);

export const ResearchGuardrailsSchema = z.object({
  runMode: z.enum(["full_stack", "hybrid", "local_only", "direct_only", "degraded"]),
  degraded: z.boolean(),
  reasons: z.array(z.string()).max(12),
  actionability: ResearchActionabilitySchema,
  confidenceCapApplied: z.number().min(0).max(1).optional()
});

export const PublicConfigSchema = z.object({
  apiBaseUrl: z.string().url(),
  stack: z.object({
    search: z.string(),
    extract: z.string(),
    social: z.array(z.string()),
    llmPrimary: z.string(),
    llmFallback: z.array(z.string()),
    llmLocal: z.array(z.string()).optional()
  })
});

export const ProviderNameSchema = z.enum([
  "serper",
  "brave",
  "exa",
  "parallel",
  "twitterapi",
  "fred",
  "xai",
  "ollama"
]);

export const BenchmarkCandidateSchema = z.enum([
  "serper-search",
  "brave-search",
  "exa-search",
  "exa-deep-search",
  "exa-answer",
  "exa-research-fast",
  "exa-research",
  "exa-research-pro",
  "parallel-search",
  "parallel-chat-base",
  "parallel-chat-core",
  "ollama-chat-primary",
  "twitterapi-search",
  "xai-web-search"
]);

export const PolicyPackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  category: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  officialSourceRequired: z.boolean(),
  earlyNoAllowed: z.boolean(),
  sourcePriority: z.array(z.string()),
  queryFocusTerms: z.array(z.string()),
  decisiveYesRules: z.array(z.string()),
  decisiveNoRules: z.array(z.string()),
  contradictionRules: z.array(z.string()),
  escalationRules: z.array(z.string())
});

export const PromptTemplateSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(["research", "opinion"]),
  summary: z.string().min(1)
});

export const AppliedPolicySchema = z.object({
  pack: PolicyPackSchema,
  researchPrompt: PromptTemplateSchema,
  opinionPrompt: PromptTemplateSchema
});

export const SearchQueryPlanSchema = z.object({
  topic: z.string().min(1),
  webQuery: z.string().min(1),
  officialQuery: z.string().min(1),
  socialQuery: z.string().min(1),
  contradictionQuery: z.string().min(1),
  officialDomains: z.array(z.string()),
  queryNotes: z.array(z.string()),
  policyPackId: z.string().min(1),
  promptVersion: z.string().min(1)
});

export const LocalPlannerSchema = z.object({
  source: z.enum(["deterministic", "ollama"]),
  model: z.string().optional(),
  queryPlan: SearchQueryPlanSchema,
  notes: z.array(z.string())
});

export const OfflineSummaryCitationSchema = z.object({
  label: z.string().min(1),
  url: z.string().url()
});

export const OfflineSummarySectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  citations: z.array(OfflineSummaryCitationSchema).max(3).default([])
});

export const OfflineSummarySchema = z.object({
  source: z.literal("ollama"),
  model: z.string().min(1),
  headline: z.string().min(1),
  summary: z.string().min(1),
  watchItems: z.array(z.string()),
  lede: z.string().min(1).optional(),
  sections: z.array(OfflineSummarySectionSchema).max(4).optional(),
  closing: z.string().min(1).optional()
});

export const ProviderSearchResultItemSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  publishedAt: z.string().optional(),
  source: z.string().optional(),
  author: z.string().optional()
});

export const ProviderSearchRunSchema = z.object({
  provider: z.string().min(1),
  ok: z.boolean(),
  query: z.string().min(1),
  durationMs: z.number().nonnegative(),
  resultCount: z.number().int().nonnegative(),
  estimatedRetrievalCostUsd: z.number().nonnegative().optional(),
  httpStatus: z.number().int().optional(),
  error: z.string().optional(),
  results: z.array(ProviderSearchResultItemSchema),
  meta: z.record(z.unknown()).default({})
});

export const ProviderBenchmarkMarketRunSchema = z.object({
  slug: z.string().min(1),
  marketId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  queryPlan: SearchQueryPlanSchema,
  providers: z.array(ProviderSearchRunSchema)
});

export const ProviderBenchmarkRequestSchema = z.object({
  slugs: z.array(z.string().min(1)).min(1).max(10),
  providers: z.array(BenchmarkCandidateSchema).min(1).optional(),
  maxResults: z.coerce.number().int().min(1).max(10).default(5)
});

export const ProviderBenchmarkReportSchema = z.object({
  generatedAt: z.string().datetime(),
  providersRequested: z.array(BenchmarkCandidateSchema),
  maxResults: z.number().int().min(1).max(10),
  markets: z.array(ProviderBenchmarkMarketRunSchema)
});

export const ProviderAvailabilitySchema = z.object({
  serper: z.boolean(),
  brave: z.boolean(),
  exa: z.boolean(),
  parallel: z.boolean(),
  twitterapi: z.boolean(),
  fred: z.boolean(),
  xai: z.boolean(),
  ollama: z.boolean()
});

export const FredSeriesSearchItemSchema = z.object({
  seriesId: z.string().min(1),
  title: z.string().min(1),
  units: z.string().optional(),
  frequency: z.string().optional(),
  popularity: z.number().int().optional(),
  observationStart: z.string().optional(),
  observationEnd: z.string().optional(),
  lastUpdated: z.string().optional(),
  notes: z.string().optional()
});

export const FredSeriesSearchResponseSchema = z.object({
  query: z.string().min(1),
  count: z.number().int().nonnegative(),
  items: z.array(FredSeriesSearchItemSchema)
});

export const FredSeriesLatestResponseSchema = z.object({
  seriesId: z.string().min(1),
  title: z.string().min(1),
  units: z.string().optional(),
  frequency: z.string().optional(),
  observationDate: z.string().min(1),
  observationValue: z.string().min(1),
  previousDate: z.string().optional(),
  previousValue: z.string().optional(),
  lastUpdated: z.string().optional(),
  notes: z.string().optional()
});

export const FredTransformSchema = z.enum(["level", "yoy_pct", "mom_pct"]);

export const MacroOfficialContextSchema = z.object({
  provider: z.literal("fred"),
  seriesId: z.string().min(1),
  title: z.string().min(1),
  transform: FredTransformSchema,
  officialDomain: z.literal("fred.stlouisfed.org"),
  officialUrl: z.string().url(),
  units: z.string().optional(),
  frequency: z.string().optional(),
  latestObservationDate: z.string().min(1),
  latestObservationValue: z.number(),
  comparisonObservationDate: z.string().optional(),
  comparisonObservationValue: z.number().optional(),
  transformedValue: z.number(),
  transformedLabel: z.string().min(1),
  targetPeriodLabel: z.string().optional(),
  targetPeriodStatus: z.enum(["no_target_period", "target_not_available", "target_available"]),
  targetObservationDate: z.string().optional(),
  targetObservationValue: z.number().optional(),
  targetComparisonObservationDate: z.string().optional(),
  targetComparisonObservationValue: z.number().optional(),
  targetTransformedValue: z.number().optional(),
  targetThresholdLabel: z.string().optional(),
  targetThresholdSatisfied: z.boolean().optional(),
  estimatedReleaseAt: z.string().datetime().optional(),
  releaseEstimateSource: z.enum(["heuristic"]).optional(),
  notes: z.array(z.string())
});

export const ProviderHealthEntrySchema = z.object({
  provider: z.string().min(1),
  total: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  consecutiveFailures: z.number().int().nonnegative(),
  averageDurationMs: z.number().nonnegative(),
  lastStatus: z.enum(["ok", "error"]).optional(),
  lastHttpStatus: z.number().int().optional(),
  lastError: z.string().optional(),
  lastDurationMs: z.number().nonnegative().optional(),
  lastSeenAt: z.string().datetime().optional()
});

export const ProviderHealthResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  providers: z.array(ProviderHealthEntrySchema)
});

export const ProviderResearchJudgmentSchema = z.object({
  provider: z.enum([
    "parallel-chat-core",
    "xai-web-search",
    "direct-official-feed",
    "ollama-local-opinion",
    "local-disabled-fallback"
  ]),
  ok: z.boolean(),
  parseMode: z.enum(["json", "freeform", "direct", "failed"]),
  opinion: OpinionSchema.optional(),
  freeformAnswer: z.string().optional(),
  resolutionStatus: ResolutionStatusSchema.optional(),
  resolutionConfidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  why: z.string().min(1),
  citations: z.array(ProviderSearchResultItemSchema),
  rawAnswer: z.string(),
  raw: ProviderSearchRunSchema
});

export const ResearchFinalModeSchema = z.enum([
  "dual_synthesized",
  "parallel_only",
  "xai_only",
  "direct_only",
  "local_floor",
  "failed"
]);

export const MarketResearchRequestSchema = z.object({
  bypassCache: z.boolean().default(false),
  maxCitations: z.coerce.number().int().min(1).max(10).default(8)
});

export const ResearchCacheInfoSchema = z.object({
  hit: z.boolean(),
  key: z.string().min(1),
  savedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});

export const ResearchRunMetaSchema = z.object({
  runId: z.string().min(1),
  runType: RunTypeSchema,
  createdAt: z.string().datetime(),
  replayOfRunId: z.string().min(1).optional()
});

export const MarketSignalItemSchema = z.object({
  signalSource: z.enum(["twitterapi", "gdelt"]),
  title: z.string().optional(),
  url: z.string().url().optional(),
  snippet: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
  author: z.string().optional(),
  domain: z.string().optional()
});

export const MarketSignalProviderStatusSchema = z.object({
  ok: z.boolean(),
  resultCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  error: z.string().optional()
});

export const MarketSignalsSummarySchema = z.object({
  generatedAt: z.string().datetime(),
  cacheHit: z.boolean(),
  topic: z.string().min(1),
  socialQuery: z.string().min(1),
  newsQuery: z.string().min(1),
  latestPublishedAt: z.string().datetime().optional(),
  totalItems: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  twitter: MarketSignalProviderStatusSchema,
  gdelt: MarketSignalProviderStatusSchema,
  items: z.array(MarketSignalItemSchema)
});

export const SourceScoreCardSchema = z.object({
  docId: z.string().min(1),
  title: z.string().optional(),
  canonicalUrl: z.string().url(),
  sourceType: EvidenceDocSchema.shape.sourceType,
  score: z.number().min(0).max(1),
  authorityScore: z.number().min(0).max(1),
  freshnessScore: z.number().min(0).max(1),
  directnessScore: z.number().min(0).max(1),
  stance: z.enum(["supports_yes", "supports_no", "contradictory", "neutral"]),
  citedByProviders: z.array(ProviderResearchJudgmentSchema.shape.provider),
  isOfficial: z.boolean()
});

export const SourceSummarySchema = z.object({
  officialSourcePresent: z.boolean(),
  contradictionSourcePresent: z.boolean(),
  averageScore: z.number().min(0).max(1),
  countsBySourceType: z.record(z.number().int().nonnegative()),
  topSources: z.array(SourceScoreCardSchema)
});

export const EvidenceGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["provider", "document", "claim", "opinion"]),
  label: z.string().min(1),
  score: z.number().min(0).max(1).optional(),
  lean: LeanSchema.optional(),
  resolutionStatus: ResolutionStatusSchema.optional(),
  sourceType: EvidenceDocSchema.shape.sourceType.optional()
});

export const EvidenceGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum(["cites", "extracts", "supports", "contradicts", "context"]),
  weight: z.number().min(0).max(1)
});

export const EvidenceGraphSchema = z.object({
  nodes: z.array(EvidenceGraphNodeSchema),
  edges: z.array(EvidenceGraphEdgeSchema)
});

export const ProbabilisticContributionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  channel: z.enum(["provider", "claim", "opinion", "market", "calibration"]),
  direction: z.enum(["yes", "no", "neutral"]),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(-4).max(4),
  probability: z.number().min(0).max(1).optional(),
  detail: z.string().min(1)
});

export const ProbabilisticForecastSchema = z.object({
  priorYesProbability: z.number().min(0).max(1),
  posteriorYesProbability: z.number().min(0).max(1),
  calibratedYesProbability: z.number().min(0).max(1),
  calibratedNoProbability: z.number().min(0).max(1),
  lean: LeanSchema,
  confidence: z.number().min(0).max(1),
  notes: z.array(z.string()),
  components: z.array(ProbabilisticContributionSchema).max(32)
});

export const AdversarialReviewSchema = z.object({
  status: z.enum(["applied", "skipped", "failed"]),
  changedOpinion: z.boolean(),
  supportCase: z.string().min(1).optional(),
  critiqueCase: z.string().min(1).optional(),
  adjudication: z.string().min(1).optional(),
  revisedLean: LeanSchema.optional(),
  revisedConfidence: z.number().min(0).max(1).optional(),
  notes: z.array(z.string())
});

export const CalibrationSummarySchema = z.object({
  status: z.enum(["empirical", "fallback", "insufficient"]),
  sampleSize: z.number().int().nonnegative(),
  bucketAccuracy: z.number().min(0).max(1),
  categoryAccuracy: z.number().min(0).max(1).optional(),
  archetypeAccuracy: z.number().min(0).max(1).optional(),
  adjustment: z.number().min(-1).max(1),
  notes: z.array(z.string())
});

export const CrossMarketRelationSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  overlapScore: z.number().min(0).max(1),
  relation: z.enum(["shared_tokens", "same_category", "same_archetype", "same_entity"]),
  lean: LeanSchema.optional(),
  leanConfidence: z.number().min(0).max(1).optional(),
  resolutionStatus: ResolutionStatusSchema.optional(),
  why: z.string().min(1)
});

export const CrossMarketContextSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: z.string().min(1),
  relatedQuestionHints: z.array(z.string().min(1)).max(6),
  markets: z.array(CrossMarketRelationSchema).max(8)
});

export const MarketOddsSchema = z.object({
  source: z.literal("polymarket"),
  yesProbability: z.number().min(0).max(1).optional(),
  noProbability: z.number().min(0).max(1).optional()
});

export const ResearchViewSchema = z.object({
  probabilitySource: z.enum(["opinion", "probabilistic_forecast", "calibrated_forecast"]),
  lean: LeanSchema,
  leanConfidence: z.number().min(0).max(1),
  confidenceLabel: z.enum(["low", "medium", "high"]),
  systemYesProbability: z.number().min(0).max(1),
  systemNoProbability: z.number().min(0).max(1),
  marketYesProbability: z.number().min(0).max(1).optional(),
  marketNoProbability: z.number().min(0).max(1).optional(),
  yesEdge: z.number().min(-1).max(1).optional(),
  noEdge: z.number().min(-1).max(1).optional(),
  rationale: z.string().min(1)
});

export const ProductMarketSummarySchema = z.object({
  marketId: z.string().min(1),
  slug: z.string().min(1).optional(),
  title: z.string().min(1),
  category: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  endTimeUtc: z.string().datetime(),
  officialSourceRequired: z.boolean(),
  earlyNoAllowed: z.boolean()
});

export const ResearchNarrativeSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  watchItems: z.array(z.string().min(1)).max(10),
  nextCheckAt: z.string().datetime().optional()
});

export const MarketResearchResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  run: ResearchRunMetaSchema,
  market: MarketContextSchema,
  resolutionContract: ResolutionContractSchema.optional(),
  appliedPolicy: AppliedPolicySchema,
  cache: ResearchCacheInfoSchema,
  strategy: z.object({
    finalMode: ResearchFinalModeSchema,
    ranParallel: z.boolean(),
    ranXai: z.boolean(),
    ranDirect: z.boolean(),
    ranLocalOpinion: z.boolean(),
    notes: z.array(z.string())
  }),
  parallelRun: ProviderResearchJudgmentSchema.optional(),
  xaiRun: ProviderResearchJudgmentSchema.optional(),
  directRun: ProviderResearchJudgmentSchema.optional(),
  localOpinionRun: ProviderResearchJudgmentSchema.optional(),
  final: OpinionSchema,
  citations: z.array(ProviderSearchResultItemSchema),
  queryPlan: SearchQueryPlanSchema.optional(),
  localPlanner: LocalPlannerSchema.optional(),
  evidence: z.array(EvidenceDocSchema),
  claims: z.array(ClaimSchema).optional(),
  offlineSummary: OfflineSummarySchema.optional(),
  signals: MarketSignalsSummarySchema.optional(),
  macroOfficialContext: MacroOfficialContextSchema.optional(),
  crossMarketContext: CrossMarketContextSchema.optional(),
  sourceSummary: SourceSummarySchema.optional(),
  evidenceGraph: EvidenceGraphSchema.optional(),
  probabilisticForecast: ProbabilisticForecastSchema.optional(),
  adversarialReview: AdversarialReviewSchema.optional(),
  calibrationSummary: CalibrationSummarySchema.optional(),
  marketOdds: MarketOddsSchema.optional(),
  guardrails: ResearchGuardrailsSchema.optional(),
  researchView: ResearchViewSchema.optional(),
  costs: z.object({
    parallelUsd: z.number().nonnegative(),
    xaiUsd: z.number().nonnegative(),
    directUsd: z.number().nonnegative(),
    extractionUsd: z.number().nonnegative(),
    signalsUsd: z.number().nonnegative().optional(),
    totalUsd: z.number().nonnegative()
  }),
  latencies: z.object({
    parallelMs: z.number().nonnegative(),
    xaiMs: z.number().nonnegative(),
    directMs: z.number().nonnegative(),
    extractionMs: z.number().nonnegative(),
    signalsMs: z.number().nonnegative().optional(),
    totalMs: z.number().nonnegative()
  })
});

export const ResearchProductResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  run: ResearchRunMetaSchema,
  market: ProductMarketSummarySchema,
  resolutionContract: ResolutionContractSchema,
  final: OpinionSchema,
  marketOdds: MarketOddsSchema,
  guardrails: ResearchGuardrailsSchema,
  researchView: ResearchViewSchema,
  narrative: ResearchNarrativeSchema,
  topSources: z.array(SourceScoreCardSchema).max(5),
  citations: z.array(ProviderSearchResultItemSchema).max(5),
  crossMarketContext: CrossMarketContextSchema.optional(),
  adversarialReview: AdversarialReviewSchema.optional(),
  probabilisticForecast: ProbabilisticForecastSchema.optional(),
  calibrationSummary: CalibrationSummarySchema.optional()
});

export const ResearchReplayRequestSchema = MarketResearchRequestSchema.partial()
  .extend({
    bypassCache: z.boolean().default(true)
  })
  .default({});

export const ResearchRunRecordSchema = z.object({
  runId: z.string().min(1),
  request: MarketResearchRequestSchema,
  response: MarketResearchResponseSchema
});

export const ResearchRunSummarySchema = z.object({
  runId: z.string().min(1),
  runType: RunTypeSchema,
  createdAt: z.string().datetime(),
  replayOfRunId: z.string().min(1).optional(),
  marketId: z.string().min(1),
  slug: z.string().min(1).optional(),
  title: z.string().min(1),
  lean: LeanSchema,
  leanConfidence: z.number().min(0).max(1),
  resolutionStatus: ResolutionStatusSchema,
  totalUsd: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  cacheHit: z.boolean()
});

export const ResearchRunListResponseSchema = z.object({
  runs: z.array(ResearchRunSummarySchema)
});

export const HotMarketEntrySchema = z.object({
  slug: z.string().min(1),
  marketId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  endTimeUtc: z.string().datetime(),
  priorityScore: z.number().nonnegative(),
  nextCheckAt: z.string().datetime(),
  lastCheckedAt: z.string().datetime().optional(),
  lastRunId: z.string().min(1).optional(),
  lastLean: LeanSchema.optional(),
  lastResolutionStatus: ResolutionStatusSchema.optional(),
  lastConfidence: z.number().min(0).max(1).optional()
});

export const HotMarketQueueSchema = z.object({
  updatedAt: z.string().datetime(),
  entries: z.array(HotMarketEntrySchema)
});

export const HotMarketSyncRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const HotMarketTickRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  bypassCache: z.boolean().default(false)
});

export const HotMarketTickResultSchema = z.object({
  slug: z.string().min(1),
  runId: z.string().min(1),
  lean: LeanSchema,
  leanConfidence: z.number().min(0).max(1),
  resolutionStatus: ResolutionStatusSchema,
  totalUsd: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  nextCheckAt: z.string().datetime().optional()
});

export const HotMarketTickResponseSchema = z.object({
  tickedAt: z.string().datetime(),
  processed: z.array(HotMarketTickResultSchema),
  queue: HotMarketQueueSchema
});

export const ResolvedGoldCaseSchema = z.object({
  slug: z.string().min(1),
  expectedState: z.enum(["YES", "NO"]),
  label: z.string().min(1).optional(),
  notes: z.string().optional()
});

export const ResolvedGoldDatasetSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  generatedAt: z.string().datetime(),
  cases: z.array(ResolvedGoldCaseSchema).min(1)
});

export const EvalSummaryBucketSchema = z.object({
  key: z.string().min(1),
  total: z.number().int().nonnegative(),
  leanCorrect: z.number().int().nonnegative(),
  leanAccuracy: z.number().min(0).max(1),
  resolutionCorrect: z.number().int().nonnegative(),
  resolutionAccuracy: z.number().min(0).max(1),
  avgCostUsd: z.number().nonnegative(),
  avgLatencyMs: z.number().nonnegative()
});

export const ResolvedGoldCaseResultSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  expectedState: z.enum(["YES", "NO"]),
  predictedLean: LeanSchema,
  predictedResolutionStatus: ResolutionStatusSchema,
  leanCorrect: z.boolean(),
  resolutionCorrect: z.boolean(),
  leanConfidence: z.number().min(0).max(1),
  runId: z.string().min(1),
  category: z.string().min(1),
  resolutionArchetype: z.string().min(1),
  policyPackId: z.string().min(1),
  finalMode: ResearchFinalModeSchema,
  totalUsd: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  cacheHit: z.boolean(),
  why: z.string().min(1),
  notes: z.string().optional()
});

export const ResolvedGoldEvalReportSchema = z.object({
  datasetId: z.string().min(1),
  datasetVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  totals: z.object({
    total: z.number().int().positive(),
    leanCorrect: z.number().int().nonnegative(),
    leanAccuracy: z.number().min(0).max(1),
    resolutionCorrect: z.number().int().nonnegative(),
    resolutionAccuracy: z.number().min(0).max(1),
    avgCostUsd: z.number().nonnegative(),
    avgLatencyMs: z.number().nonnegative()
  }),
  byCategory: z.array(EvalSummaryBucketSchema),
  byPolicyPack: z.array(EvalSummaryBucketSchema),
  results: z.array(ResolvedGoldCaseResultSchema)
});

export type DeepResearchEnv = z.infer<typeof DeepResearchEnvSchema>;
export type RunType = z.infer<typeof RunTypeSchema>;
export type CanonicalMarket = z.infer<typeof CanonicalMarketSchema>;
export type EvidenceDoc = z.infer<typeof EvidenceDocSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;
export type Lean = z.infer<typeof LeanSchema>;
export type OpinionCaseBullet = z.infer<typeof OpinionCaseBulletSchema>;
export type OpinionCase = z.infer<typeof OpinionCaseSchema>;
export type OpinionHistoricalPrior = z.infer<typeof OpinionHistoricalPriorSchema>;
export type OpinionHistoricalContext = z.infer<typeof OpinionHistoricalContextSchema>;
export type Opinion = z.infer<typeof OpinionSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type PolymarketEvent = z.infer<typeof PolymarketEventSchema>;
export type PolymarketMarket = z.infer<typeof PolymarketMarketSchema>;
export type MarketContext = z.infer<typeof MarketContextSchema>;
export type ResolutionAuthorityKind = z.infer<typeof ResolutionAuthorityKindSchema>;
export type ResolutionComparator = z.infer<typeof ResolutionComparatorSchema>;
export type ResolutionContract = z.infer<typeof ResolutionContractSchema>;
export type ResearchActionability = z.infer<typeof ResearchActionabilitySchema>;
export type ResearchGuardrails = z.infer<typeof ResearchGuardrailsSchema>;
export type PublicConfig = z.infer<typeof PublicConfigSchema>;
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export type BenchmarkCandidate = z.infer<typeof BenchmarkCandidateSchema>;
export type PolicyPack = z.infer<typeof PolicyPackSchema>;
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
export type AppliedPolicy = z.infer<typeof AppliedPolicySchema>;
export type SearchQueryPlan = z.infer<typeof SearchQueryPlanSchema>;
export type LocalPlanner = z.infer<typeof LocalPlannerSchema>;
export type OfflineSummaryCitation = z.infer<typeof OfflineSummaryCitationSchema>;
export type OfflineSummarySection = z.infer<typeof OfflineSummarySectionSchema>;
export type OfflineSummary = z.infer<typeof OfflineSummarySchema>;
export type ProviderSearchResultItem = z.infer<typeof ProviderSearchResultItemSchema>;
export type ProviderSearchRun = z.infer<typeof ProviderSearchRunSchema>;
export type ProviderBenchmarkMarketRun = z.infer<typeof ProviderBenchmarkMarketRunSchema>;
export type ProviderBenchmarkRequest = z.infer<typeof ProviderBenchmarkRequestSchema>;
export type ProviderBenchmarkReport = z.infer<typeof ProviderBenchmarkReportSchema>;
export type ProviderAvailability = z.infer<typeof ProviderAvailabilitySchema>;
export type FredSeriesSearchItem = z.infer<typeof FredSeriesSearchItemSchema>;
export type FredSeriesSearchResponse = z.infer<typeof FredSeriesSearchResponseSchema>;
export type FredSeriesLatestResponse = z.infer<typeof FredSeriesLatestResponseSchema>;
export type FredTransform = z.infer<typeof FredTransformSchema>;
export type MacroOfficialContext = z.infer<typeof MacroOfficialContextSchema>;
export type ProviderHealthEntry = z.infer<typeof ProviderHealthEntrySchema>;
export type ProviderHealthResponse = z.infer<typeof ProviderHealthResponseSchema>;
export type ProviderResearchJudgment = z.infer<typeof ProviderResearchJudgmentSchema>;
export type ResearchFinalMode = z.infer<typeof ResearchFinalModeSchema>;
export type MarketResearchRequest = z.infer<typeof MarketResearchRequestSchema>;
export type ResearchCacheInfo = z.infer<typeof ResearchCacheInfoSchema>;
export type ResearchRunMeta = z.infer<typeof ResearchRunMetaSchema>;
export type MarketSignalItem = z.infer<typeof MarketSignalItemSchema>;
export type MarketSignalProviderStatus = z.infer<typeof MarketSignalProviderStatusSchema>;
export type MarketSignalsSummary = z.infer<typeof MarketSignalsSummarySchema>;
export type SourceScoreCard = z.infer<typeof SourceScoreCardSchema>;
export type SourceSummary = z.infer<typeof SourceSummarySchema>;
export type EvidenceGraphNode = z.infer<typeof EvidenceGraphNodeSchema>;
export type EvidenceGraphEdge = z.infer<typeof EvidenceGraphEdgeSchema>;
export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;
export type ProbabilisticContribution = z.infer<typeof ProbabilisticContributionSchema>;
export type ProbabilisticForecast = z.infer<typeof ProbabilisticForecastSchema>;
export type AdversarialReview = z.infer<typeof AdversarialReviewSchema>;
export type CalibrationSummary = z.infer<typeof CalibrationSummarySchema>;
export type CrossMarketRelation = z.infer<typeof CrossMarketRelationSchema>;
export type CrossMarketContext = z.infer<typeof CrossMarketContextSchema>;
export type MarketOdds = z.infer<typeof MarketOddsSchema>;
export type ResearchView = z.infer<typeof ResearchViewSchema>;
export type ProductMarketSummary = z.infer<typeof ProductMarketSummarySchema>;
export type ResearchNarrative = z.infer<typeof ResearchNarrativeSchema>;
export type MarketResearchResponse = z.infer<typeof MarketResearchResponseSchema>;
export type ResearchProductResponse = z.infer<typeof ResearchProductResponseSchema>;
export type ResearchReplayRequest = z.infer<typeof ResearchReplayRequestSchema>;
export type ResearchRunRecord = z.infer<typeof ResearchRunRecordSchema>;
export type ResearchRunSummary = z.infer<typeof ResearchRunSummarySchema>;
export type ResearchRunListResponse = z.infer<typeof ResearchRunListResponseSchema>;
export type HotMarketEntry = z.infer<typeof HotMarketEntrySchema>;
export type HotMarketQueue = z.infer<typeof HotMarketQueueSchema>;
export type HotMarketSyncRequest = z.infer<typeof HotMarketSyncRequestSchema>;
export type HotMarketTickRequest = z.infer<typeof HotMarketTickRequestSchema>;
export type HotMarketTickResult = z.infer<typeof HotMarketTickResultSchema>;
export type HotMarketTickResponse = z.infer<typeof HotMarketTickResponseSchema>;
export type ResolvedGoldCase = z.infer<typeof ResolvedGoldCaseSchema>;
export type ResolvedGoldDataset = z.infer<typeof ResolvedGoldDatasetSchema>;
export type EvalSummaryBucket = z.infer<typeof EvalSummaryBucketSchema>;
export type ResolvedGoldCaseResult = z.infer<typeof ResolvedGoldCaseResultSchema>;
export type ResolvedGoldEvalReport = z.infer<typeof ResolvedGoldEvalReportSchema>;
