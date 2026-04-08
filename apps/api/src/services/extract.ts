import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type EvidenceDoc, type MarketContext, type ProviderSearchResultItem } from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { CACHE_ROOT } from "../paths.js";
import { isOfficialUrlForMarket, prioritizeExtractionTargets } from "./official-sources.js";
import { fetchWithRetry } from "./providers/shared.js";
import { canonicalizeUrl, dedupeProviderSearchResults } from "./urls.js";

const EXTRACT_CACHE_DIR = resolve(CACHE_ROOT, "extract");
const EXTRACT_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_EXTRACT_URLS = 5;
const TIER1_MIN_CONTENT_LENGTH = 220;

type ParallelExtractResult = {
  url?: string;
  title?: string;
  excerpts?: string[];
  full_content?: string;
  published_at?: string;
};

type ExtractCacheRecord = {
  savedAt: string;
  docs: EvidenceDoc[];
};

type ExtractionTarget = {
  url: string;
  origin: "official_direct" | "official_citation" | "citation";
  citation?: ProviderSearchResultItem;
};

export async function extractEvidenceDocs(
  market: MarketContext,
  citations: ProviderSearchResultItem[]
): Promise<{ docs: EvidenceDoc[]; extractionCostUsd: number; extractionMs: number }> {
  const dedupedCitations = dedupeProviderSearchResults(citations);
  const targets = prioritizeExtractionTargets(market, dedupedCitations, MAX_EXTRACT_URLS);
  const selected = targets.map((target) => ({
    url: target.url,
    origin: target.origin,
    citation: dedupedCitations.find((item) => item.url === target.url)
  }));

  if (selected.length === 0) {
    return {
      docs: [],
      extractionCostUsd: 0,
      extractionMs: 0
    };
  }

  const cacheKey = buildExtractCacheKey(market, selected.map((item) => item.url));
  const cached = await readExtractCache(cacheKey);
  if (cached) {
    return {
      docs: cached,
      extractionCostUsd: 0,
      extractionMs: 0
    };
  }

  const startedAt = Date.now();
  const now = new Date().toISOString();
  const tier1Docs = (
    await Promise.all(selected.map((target) => extractViaTier1(market, target, now)))
  ).filter((item): item is EvidenceDoc => Boolean(item));
  const tier1CanonicalUrls = new Set(tier1Docs.map((doc) => doc.canonicalUrl));
  const parallelTargets = selected.filter((target) => !tier1CanonicalUrls.has(canonicalizeUrl(target.url)));
  const parallelResult = await extractViaParallel(market, parallelTargets, now);
  const docs = mergeEvidenceDocs([...tier1Docs, ...parallelResult.docs]);

  await writeExtractCache(cacheKey, docs);

  return {
    docs,
    extractionCostUsd: parallelResult.extractionCostUsd,
    extractionMs: Date.now() - startedAt
  };
}

function normalizeEvidenceDoc(
  market: MarketContext,
  result: ParallelExtractResult,
  target:
    | {
        url: string;
        origin: "official_direct" | "official_citation" | "citation";
        citation?: ProviderSearchResultItem;
      }
    | undefined,
  nowIso: string
): EvidenceDoc | null {
  const url = result.url ?? target?.url;
  if (!url) {
    return null;
  }

  const canonicalUrl = canonicalizeUrl(url);
  const sourceType = inferSourceType(canonicalUrl, market);
  const authorityScore = sourceTypeToAuthority(sourceType);
  const publishedAt = toIsoDate(result.published_at);
  const freshnessScore = computeFreshnessScore(publishedAt);
  const directnessScore = target?.origin === "official_direct" ? 1 : target?.origin === "official_citation" ? 0.96 : target?.citation ? 0.86 : 0.7;
  const contentMarkdown = [result.excerpts?.join("\n\n"), result.full_content].filter(Boolean).join("\n\n").trim();

  return {
    docId: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16),
    url,
    canonicalUrl,
    title: result.title ?? target?.citation?.title,
    sourceType,
    publishedAt,
    observedAt: nowIso,
    fetchedAt: nowIso,
    retrievalChannel: inferRetrievalChannel(target?.citation?.source, sourceType),
    extractor: "parallel",
    authorityScore,
    freshnessScore,
    directnessScore,
    language: "en",
    contentMarkdown: contentMarkdown || target?.citation?.snippet || target?.citation?.title || url
  };
}

function buildExtractCacheKey(market: MarketContext, urls: string[]): string {
  const source = [
    "extract-v1",
    market.canonicalMarket.marketId,
    market.canonicalMarket.resolutionArchetype,
    ...urls.map((url) => canonicalizeUrl(url))
  ].join("|");

  return createHash("sha256").update(source).digest("hex");
}

async function readExtractCache(key: string): Promise<EvidenceDoc[] | null> {
  try {
    const path = resolve(EXTRACT_CACHE_DIR, `${key}.json`);
    const payload = await readFile(path, "utf8");
    const cached = JSON.parse(payload) as ExtractCacheRecord;

    if (Date.parse(cached.savedAt) + EXTRACT_CACHE_TTL_MS <= Date.now()) {
      return null;
    }

    return cached.docs;
  } catch {
    return null;
  }
}

async function writeExtractCache(key: string, docs: EvidenceDoc[]): Promise<void> {
  await mkdir(EXTRACT_CACHE_DIR, { recursive: true });
  const path = resolve(EXTRACT_CACHE_DIR, `${key}.json`);
  const payload: ExtractCacheRecord = {
    savedAt: new Date().toISOString(),
    docs
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

function inferSourceType(url: string, market: MarketContext): EvidenceDoc["sourceType"] {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }

  if (
    isOfficialUrlForMarket(url, market) ||
    hostname.endsWith(".gov") ||
    hostname === "whitehouse.gov" ||
    hostname === "www.whitehouse.gov" ||
    hostname === "www.rockstargames.com" ||
    hostname === "rockstargames.com" ||
    hostname === "www.nba.com" ||
    hostname === "nba.com"
  ) {
    return "official";
  }

  if (["www.reuters.com", "apnews.com", "www.apnews.com"].includes(hostname)) {
    return "wire";
  }

  if (
    [
      "www.bloomberg.com",
      "www.bbc.com",
      "www.nytimes.com",
      "www.wsj.com",
      "www.ft.com",
      "finance.yahoo.com"
    ].includes(hostname)
  ) {
    return "major_media";
  }

  if (
    hostname.includes("reddit.com") ||
    hostname.includes("facebook.com") ||
    hostname.includes("instagram.com") ||
    hostname.includes("x.com") ||
    hostname.includes("twitter.com") ||
    hostname.includes("youtube.com")
  ) {
    return "social";
  }

  if (hostname.includes("blog")) {
    return "blog";
  }

  return "trade";
}

function inferRetrievalChannel(
  source: string | undefined,
  sourceType: EvidenceDoc["sourceType"]
): EvidenceDoc["retrievalChannel"] {
  if (sourceType === "official") {
    return "official";
  }

  switch (source) {
    case "serper":
      return "serper";
    case "brave":
      return "brave";
    case "exa":
      return "exa";
    case "gdelt":
      return "gdelt";
    case "twitterapi":
    case "xai":
      return "x";
    case "parallel":
    default:
      return "parallel";
  }
}

function sourceTypeToAuthority(sourceType: EvidenceDoc["sourceType"]): number {
  switch (sourceType) {
    case "official":
      return 0.98;
    case "wire":
      return 0.92;
    case "major_media":
      return 0.84;
    case "trade":
      return 0.68;
    case "social":
      return 0.35;
    case "blog":
      return 0.22;
    case "unknown":
      return 0.5;
  }
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

function computeFreshnessScore(publishedAt: string | undefined): number {
  if (!publishedAt) {
    return 0.4;
  }

  const ageHours = (Date.now() - Date.parse(publishedAt)) / (1000 * 60 * 60);
  if (ageHours <= 24) {
    return 1;
  }
  if (ageHours <= 24 * 7) {
    return 0.82;
  }
  if (ageHours <= 24 * 30) {
    return 0.65;
  }
  return 0.4;
}

async function extractViaParallel(
  market: MarketContext,
  targets: ExtractionTarget[],
  nowIso: string
): Promise<{ docs: EvidenceDoc[]; extractionCostUsd: number }> {
  if (targets.length === 0 || env.PARALLEL_API_KEY.trim() === "") {
    return {
      docs: [],
      extractionCostUsd: 0
    };
  }

  try {
    const response = await fetchWithRetry("https://api.parallel.ai/v1beta/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.PARALLEL_API_KEY,
        "parallel-beta": "search-extract-2025-10-10"
      },
      body: JSON.stringify({
        urls: targets.map((item) => item.url),
        objective: `Extract decisive evidence for this Polymarket market: ${market.canonicalMarket.title}. Focus on resolution-relevant passages and dates.`,
        search_queries: [
          market.canonicalMarket.title,
          market.canonicalMarket.resolutionArchetype
        ],
        fetch_policy: {
          max_age_seconds: 1800
        },
        excerpts: {
          max_chars_per_result: 2500,
          max_chars_total: 12000
        },
        full_content: {
          max_chars_per_result: 12000
        }
      })
    }, {
      maxAttempts: 1,
      timeoutMs: 8000
    });

    const payload = (await response.json()) as {
      results?: ParallelExtractResult[];
    };

    if (!response.ok) {
      return {
        docs: [],
        extractionCostUsd: 0
      };
    }

    const docs = (payload.results ?? [])
      .map((item, index) => normalizeEvidenceDoc(market, item, targets[index], nowIso))
      .filter((item): item is EvidenceDoc => Boolean(item));

    return {
      docs,
      extractionCostUsd: targets.length * 0.001
    };
  } catch {
    return {
      docs: [],
      extractionCostUsd: 0
    };
  }
}

async function extractViaTier1(
  market: MarketContext,
  target: ExtractionTarget,
  nowIso: string
): Promise<EvidenceDoc | null> {
  try {
    const response = await fetchWithRetry(target.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "User-Agent": "PolymarketDeepResearch/0.1"
      }
    }, {
      maxAttempts: 1,
      timeoutMs: 5000
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("pdf") || contentType.includes("application/octet-stream")) {
      return null;
    }

    const raw = await response.text();
    const finalUrl = response.url || target.url;

    if (!contentType.includes("html") && !contentType.includes("text/plain")) {
      return null;
    }

    const title = extractHtmlMeta(raw, ["og:title", "twitter:title"]) ?? extractTitle(raw) ?? target.citation?.title;
    const publishedAt =
      toIsoDate(
        extractHtmlMeta(raw, ["article:published_time", "og:published_time", "date", "datePublished"]) ??
          extractJsonLdPublishedAt(raw)
      ) ?? target.citation?.publishedAt;
    const contentMarkdown = contentType.includes("text/plain") ? normalizeWhitespace(raw) : htmlToText(raw);

    if (contentMarkdown.length < TIER1_MIN_CONTENT_LENGTH) {
      return null;
    }

    const canonicalUrl =
      canonicalizeUrl(extractCanonicalUrl(raw, finalUrl) ?? finalUrl);
    const sourceType = inferSourceType(canonicalUrl, market);

    return {
      docId: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16),
      url: finalUrl,
      canonicalUrl,
      title,
      sourceType,
      publishedAt,
      observedAt: nowIso,
      fetchedAt: nowIso,
      retrievalChannel: inferRetrievalChannel(target.citation?.source, sourceType),
      extractor: "trafilatura",
      authorityScore: sourceTypeToAuthority(sourceType),
      freshnessScore: computeFreshnessScore(publishedAt),
      directnessScore: target.origin === "official_direct" ? 1 : target.origin === "official_citation" ? 0.96 : 0.84,
      language: "en",
      contentMarkdown
    };
  } catch {
    return null;
  }
}

function mergeEvidenceDocs(docs: EvidenceDoc[]): EvidenceDoc[] {
  const merged = new Map<string, EvidenceDoc>();

  for (const doc of docs) {
    const existing = merged.get(doc.canonicalUrl);
    if (!existing) {
      merged.set(doc.canonicalUrl, doc);
      continue;
    }

    merged.set(doc.canonicalUrl, scoreEvidenceDoc(doc) > scoreEvidenceDoc(existing) ? doc : existing);
  }

  return [...merged.values()];
}

function scoreEvidenceDoc(doc: EvidenceDoc): number {
  return doc.authorityScore * 0.4 + doc.freshnessScore * 0.2 + doc.directnessScore * 0.25 + Math.min(doc.contentMarkdown.length, 4000) / 4000 * 0.15;
}

function extractTitle(html: string): string | undefined {
  return normalizeWhitespace(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
}

function extractCanonicalUrl(html: string, fallbackUrl: string): string | undefined {
  const linkValue = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (!linkValue) {
    return fallbackUrl;
  }

  try {
    return new URL(linkValue, fallbackUrl).toString();
  } catch {
    return fallbackUrl;
  }
}

function extractHtmlMeta(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const propertyMatch = html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
    const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
    const value = normalizeWhitespace(propertyMatch?.[1] ?? nameMatch?.[1]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractJsonLdPublishedAt(html: string): string | undefined {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }

    try {
      const payload = JSON.parse(raw) as Record<string, unknown> | Array<Record<string, unknown>>;
      const nodes = Array.isArray(payload) ? payload : [payload];
      for (const node of nodes) {
        const value = node.datePublished;
        if (typeof value === "string" && value.trim() !== "") {
          return value;
        }
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const blockSpaced = withoutScripts.replace(/<\/?(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|br|tr|td)[^>]*>/gi, "\n");
  const text = blockSpaced.replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(decodeHtmlEntities(text)).slice(0, 8000);
}

function normalizeWhitespace(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
