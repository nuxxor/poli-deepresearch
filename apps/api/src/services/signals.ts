import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  MarketSignalsSummarySchema,
  type MarketContext,
  type MarketSignalItem,
  type MarketSignalsSummary,
  type SearchQueryPlan
} from "@polymarket/deep-research-contracts";

import { CACHE_ROOT } from "../paths.js";
import { buildSearchQueryPlan } from "./queries.js";
import { runGdeltDocSearch } from "./providers/gdelt.js";
import { runTwitterApiSearch } from "./providers/twitterapi.js";

const SIGNALS_CACHE_DIR = resolve(CACHE_ROOT, "signals");
const SIGNALS_CACHE_TTL_MS = 1000 * 60 * 20;
const SIGNALS_DEGRADED_CACHE_TTL_MS = 1000 * 60 * 2;
const SIGNALS_EMPTY_CACHE_TTL_MS = 1000 * 60 * 5;
const DEFAULT_SIGNAL_ITEMS = 3;

type SignalCacheRecord = {
  savedAt: string;
  expiresAt: string;
  summary: MarketSignalsSummary;
};

export async function fetchMarketSignals(
  market: MarketContext,
  maxItems = DEFAULT_SIGNAL_ITEMS,
  queryPlanOverride?: SearchQueryPlan
): Promise<MarketSignalsSummary> {
  const queryPlan = queryPlanOverride ?? buildSearchQueryPlan(market);
  const cacheKey = buildSignalsCacheKey(market, queryPlan, maxItems);
  const cached = await readSignalsCache(cacheKey);

  if (cached) {
    return cached;
  }

  const startedAt = Date.now();
  const [twitterRun, gdeltRun] = await Promise.all([
    runTwitterApiSearch(queryPlan.socialQuery, maxItems),
    runGdeltDocSearch(queryPlan.webQuery, maxItems)
  ]);

  const items = dedupeSignalItems([
    ...twitterRun.results.map((item) => toSignalItem("twitterapi", item)),
    ...gdeltRun.results.map((item) => toSignalItem("gdelt", item))
  ]).slice(0, maxItems * 2);

  const latestPublishedAt = items
    .map((item) => item.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const summary = MarketSignalsSummarySchema.parse({
    generatedAt: new Date().toISOString(),
    cacheHit: false,
    topic: queryPlan.topic,
    socialQuery: queryPlan.socialQuery,
    newsQuery: queryPlan.webQuery,
    latestPublishedAt,
    totalItems: items.length,
    estimatedCostUsd: twitterRun.estimatedRetrievalCostUsd ?? 0,
    totalMs: Date.now() - startedAt,
    twitter: {
      ok: twitterRun.ok,
      resultCount: twitterRun.resultCount,
      durationMs: twitterRun.durationMs,
      error: twitterRun.error
    },
    gdelt: {
      ok: gdeltRun.ok,
      resultCount: gdeltRun.resultCount,
      durationMs: gdeltRun.durationMs,
      error: gdeltRun.error
    },
    items
  });

  await writeSignalsCache(cacheKey, summary);
  return summary;
}

function toSignalItem(
  signalSource: MarketSignalItem["signalSource"],
  item: {
    title?: string;
    url?: string;
    snippet?: string;
    publishedAt?: string;
    source?: string;
    author?: string;
  }
): MarketSignalItem {
  return {
    signalSource,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    publishedAt: item.publishedAt,
    author: item.author,
    domain: item.source
  };
}

function buildSignalsCacheKey(
  market: MarketContext,
  queryPlan: ReturnType<typeof buildSearchQueryPlan>,
  maxItems: number
): string {
  const source = [
    "signals-v2",
    market.canonicalMarket.marketId,
    market.canonicalMarket.endTimeUtc,
    queryPlan.policyPackId,
    queryPlan.socialQuery,
    queryPlan.webQuery,
    String(maxItems)
  ].join("|");

  return createHash("sha256").update(source).digest("hex");
}

async function readSignalsCache(key: string): Promise<MarketSignalsSummary | null> {
  try {
    const payload = await readFile(resolve(SIGNALS_CACHE_DIR, `${key}.json`), "utf8");
    const cached = JSON.parse(payload) as SignalCacheRecord;

    if (Date.parse(cached.expiresAt) <= Date.now()) {
      return null;
    }

    return MarketSignalsSummarySchema.parse({
      ...cached.summary,
      cacheHit: true
    });
  } catch {
    return null;
  }
}

async function writeSignalsCache(key: string, summary: MarketSignalsSummary): Promise<void> {
  await mkdir(SIGNALS_CACHE_DIR, { recursive: true });
  const expiresAt = new Date(Date.now() + computeSignalsCacheTtl(summary)).toISOString();
  const payload: SignalCacheRecord = {
    savedAt: new Date().toISOString(),
    expiresAt,
    summary
  };
  await writeFile(resolve(SIGNALS_CACHE_DIR, `${key}.json`), JSON.stringify(payload, null, 2), "utf8");
}

function dedupeSignalItems(items: MarketSignalItem[]): MarketSignalItem[] {
  const seen = new Set<string>();
  const deduped: MarketSignalItem[] = [];

  for (const item of items) {
    const key = (item.url ?? `${item.signalSource}:${item.title ?? item.snippet ?? ""}`).trim();
    if (key === "" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((left, right) => {
    const leftTs = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTs = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    return rightTs - leftTs;
  });
}

function computeSignalsCacheTtl(summary: MarketSignalsSummary): number {
  if (!summary.twitter.ok || !summary.gdelt.ok) {
    return SIGNALS_DEGRADED_CACHE_TTL_MS;
  }

  if (summary.totalItems === 0) {
    return SIGNALS_EMPTY_CACHE_TTL_MS;
  }

  return SIGNALS_CACHE_TTL_MS;
}
