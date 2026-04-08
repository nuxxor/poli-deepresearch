import {
  type BenchmarkCandidate,
  ProviderAvailabilitySchema,
  ProviderBenchmarkReportSchema,
  type ProviderAvailability,
  type ProviderBenchmarkReport,
  type ProviderBenchmarkRequest,
  type ProviderSearchRun,
  type SearchQueryPlan
} from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { fetchMarketContextBySlug } from "./polymarket.js";
import { buildResearchPrompt, buildSearchQueryPlan } from "./queries.js";
import { runBraveSearch } from "./providers/brave.js";
import { runExaAnswer, runExaResearch, runExaSearch } from "./providers/exa.js";
import { checkOllamaAvailability, runOllamaChat } from "./providers/ollama.js";
import { runParallelChat, runParallelSearch } from "./providers/parallel.js";
import { runSerperSearch } from "./providers/serper.js";
import { runTwitterApiSearch } from "./providers/twitterapi.js";
import { runXaiWebSearch } from "./providers/xai.js";

const MARKET_BENCHMARK_CONCURRENCY = 3;

export const DEFAULT_BENCHMARK_PROVIDERS: BenchmarkCandidate[] = [
  "brave-search",
  "exa-search",
  "exa-deep-search",
  "exa-answer",
  "parallel-search",
  "parallel-chat-base",
  "parallel-chat-core",
  "ollama-chat-primary",
  "xai-web-search"
];

export async function getProviderAvailability(): Promise<ProviderAvailability> {
  return ProviderAvailabilitySchema.parse({
    serper: env.SERPER_API_KEY.trim() !== "",
    brave: env.BRAVE_API_KEY.trim() !== "",
    exa: env.EXA_API_KEY.trim() !== "",
    parallel: env.PARALLEL_API_KEY.trim() !== "",
    twitterapi: env.TWITTERAPI_KEY.trim() !== "",
    fred: env.FRED_API_KEY.trim() !== "",
    xai: env.XAI_API_KEY.trim() !== "",
    ollama: await checkOllamaAvailability()
  });
}

export async function runProviderBenchmark(request: ProviderBenchmarkRequest): Promise<ProviderBenchmarkReport> {
  const providers = request.providers ?? DEFAULT_BENCHMARK_PROVIDERS;
  const markets = await mapWithConcurrency(request.slugs, MARKET_BENCHMARK_CONCURRENCY, async (slug) => {
    const market = await fetchMarketContextBySlug(slug);
    const queryPlan = buildSearchQueryPlan(market);
    const researchPrompt = buildResearchPrompt(market);
    const providerRuns = await Promise.all(
      providers.map((provider) => runProvider(provider, researchPrompt, queryPlan, request.maxResults))
    );

    return {
      slug,
      marketId: market.canonicalMarket.marketId,
      title: market.canonicalMarket.title,
      category: market.canonicalMarket.category,
      resolutionArchetype: market.canonicalMarket.resolutionArchetype,
      queryPlan,
      providers: providerRuns
    };
  });

  return ProviderBenchmarkReportSchema.parse({
    generatedAt: new Date().toISOString(),
    providersRequested: providers,
    maxResults: request.maxResults,
    markets
  });
}

async function runProvider(
  provider: BenchmarkCandidate,
  researchPrompt: string,
  queryPlan: SearchQueryPlan,
  maxResults: number
): Promise<ProviderSearchRun> {
  switch (provider) {
    case "serper-search":
      return runSerperSearch(queryPlan.officialQuery, maxResults);
    case "brave-search":
      return runBraveSearch(queryPlan.officialQuery, maxResults);
    case "exa-search":
      return runExaSearch(queryPlan.officialQuery, maxResults, "exa-search");
    case "exa-deep-search":
      return runExaSearch(queryPlan.officialQuery, maxResults, "exa-deep-search");
    case "exa-answer":
      return runExaAnswer(researchPrompt, maxResults);
    case "exa-research-fast":
      return runExaResearch(researchPrompt, maxResults, "exa-research-fast");
    case "exa-research":
      return runExaResearch(researchPrompt, maxResults, "exa-research");
    case "exa-research-pro":
      return runExaResearch(researchPrompt, maxResults, "exa-research-pro");
    case "parallel-search":
      return runParallelSearch(queryPlan.officialQuery, maxResults);
    case "parallel-chat-base":
      return runParallelChat(researchPrompt, maxResults, "base");
    case "parallel-chat-core":
      return runParallelChat(researchPrompt, maxResults, "core");
    case "ollama-chat-primary":
      return runOllamaChat(researchPrompt, maxResults);
    case "twitterapi-search":
      return runTwitterApiSearch(queryPlan.socialQuery, maxResults);
    case "xai-web-search":
      return runXaiWebSearch(researchPrompt, maxResults);
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => consume());
  await Promise.all(workers);
  return results;
}
