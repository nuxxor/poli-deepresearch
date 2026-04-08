import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { MarketResearchResponseSchema, type AppliedPolicy, type MarketContext, type MarketResearchResponse, type ResearchCacheInfo } from "@polymarket/deep-research-contracts";
import { CACHE_ROOT } from "../paths.js";
import { withEvidenceArtifacts } from "./evidence-graph.js";

const CACHE_VERSION = "v33";
const CACHE_DIR = resolve(CACHE_ROOT, "research");

type CacheRecord = {
  key: string;
  savedAt: string;
  expiresAt: string;
  response: MarketResearchResponse;
};

export function buildResearchCacheKey(
  market: MarketContext,
  appliedPolicy: AppliedPolicy,
  maxCitations: number
): string {
  const source = [
    CACHE_VERSION,
    market.canonicalMarket.slug ?? market.canonicalMarket.marketId,
    market.canonicalMarket.endTimeUtc,
    appliedPolicy.pack.id,
    appliedPolicy.pack.version,
    appliedPolicy.opinionPrompt.id,
    appliedPolicy.opinionPrompt.version,
    market.canonicalMarket.resolutionArchetype,
    String(maxCitations)
  ].join("|");

  return createHash("sha256").update(source).digest("hex");
}

export async function readResearchCache(key: string): Promise<MarketResearchResponse | null> {
  try {
    const payload = await readFile(resolve(CACHE_DIR, `${key}.json`), "utf8");
    const cached = JSON.parse(payload) as CacheRecord;

    if (Date.parse(cached.expiresAt) <= Date.now()) {
      return null;
    }

    return withEvidenceArtifacts(MarketResearchResponseSchema.parse({
      ...cached.response,
      cache: {
        hit: true,
        key,
        savedAt: cached.savedAt,
        expiresAt: cached.expiresAt
      }
    }));
  } catch {
    return null;
  }
}

export async function writeResearchCache(
  key: string,
  response: MarketResearchResponse
): Promise<ResearchCacheInfo> {
  await mkdir(CACHE_DIR, { recursive: true });

  const savedAt = new Date().toISOString();
  const expiresAt = computeExpiresAt(response);
  const cache: ResearchCacheInfo = {
    hit: false,
    key,
    savedAt,
    expiresAt
  };

  const record: CacheRecord = {
    key,
    savedAt,
    expiresAt,
    response: {
      ...response,
      cache
    }
  };

  await writeFile(resolve(CACHE_DIR, `${key}.json`), JSON.stringify(record, null, 2), "utf8");
  return cache;
}

function computeExpiresAt(response: MarketResearchResponse): string {
  const market = response.market;
  const resolutionStatus = response.final.resolutionStatus;
  const now = Date.now();
  const deadline = Date.parse(market.canonicalMarket.endTimeUtc);
  const hoursUntilDeadline = Number.isNaN(deadline) ? 999 : (deadline - now) / (1000 * 60 * 60);

  let ttlMs = 1000 * 60 * 60;

  if (resolutionStatus === "RESOLVED_YES" || resolutionStatus === "RESOLVED_NO") {
    ttlMs = hoursUntilDeadline <= 24 ? 1000 * 60 * 30 : 1000 * 60 * 60 * 6;
  } else if (hoursUntilDeadline <= 24) {
    ttlMs = 1000 * 60 * 15;
  }

  const genericExpiry = now + ttlMs;
  const directNextCheckAt = Date.parse(response.final.nextCheckAt ?? "");

  if (!Number.isNaN(directNextCheckAt) && directNextCheckAt > now) {
    return new Date(Math.min(genericExpiry, directNextCheckAt)).toISOString();
  }

  return new Date(genericExpiry).toISOString();
}
