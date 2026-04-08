import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  HotMarketQueueSchema,
  HotMarketTickResponseSchema,
  type HotMarketEntry,
  type HotMarketQueue,
  type HotMarketTickRequest,
  type HotMarketTickResponse
} from "@polymarket/deep-research-contracts";

import { DATA_ROOT } from "../paths.js";
import { estimateDirectMarketNextCheckAt } from "./direct-resolver.js";
import { fetchActiveMarketSlugs, fetchMarketContextBySlug } from "./polymarket.js";
import { runMarketResearchBySlug } from "./research.js";

const MONITORS_DIR = resolve(DATA_ROOT, "monitors");
const HOT_MARKETS_PATH = resolve(MONITORS_DIR, "hot-markets.json");

export async function getHotMarketQueue(): Promise<HotMarketQueue> {
  return readHotMarketQueue();
}

export async function syncHotMarketQueue(limit: number): Promise<HotMarketQueue> {
  const existing = await readHotMarketQueue();
  const previousBySlug = new Map(existing.entries.map((entry) => [entry.slug, entry]));
  const slugs = await fetchActiveMarketSlugs(limit);
  const contexts = await mapWithConcurrency(slugs, 4, (slug) => fetchMarketContextBySlug(slug));

  const nowIso = new Date().toISOString();
  const entries: HotMarketEntry[] = contexts.map((context) => {
    const previous = previousBySlug.get(context.canonicalMarket.slug ?? "");
    const estimatedDirectNextCheckAt = estimateDirectMarketNextCheckAt(context);
    const previousStillUseful =
      previous?.nextCheckAt && Date.parse(previous.nextCheckAt) > Date.now() ? previous.nextCheckAt : undefined;
    const nextCheckAt =
      previousStillUseful ??
      estimatedDirectNextCheckAt ??
      computeNextCheckAt(context.canonicalMarket.endTimeUtc);

    return {
      slug: context.canonicalMarket.slug ?? context.rawMarket.slug,
      marketId: context.canonicalMarket.marketId,
      title: context.canonicalMarket.title,
      category: context.canonicalMarket.category,
      resolutionArchetype: context.canonicalMarket.resolutionArchetype,
      endTimeUtc: context.canonicalMarket.endTimeUtc,
      priorityScore: computePriorityScore(context.canonicalMarket.endTimeUtc, context.canonicalMarket.category),
      nextCheckAt,
      lastCheckedAt: previous?.lastCheckedAt,
      lastRunId: previous?.lastRunId,
      lastLean: previous?.lastLean,
      lastResolutionStatus: previous?.lastResolutionStatus,
      lastConfidence: previous?.lastConfidence
    };
  });

  const queue = HotMarketQueueSchema.parse({
    updatedAt: nowIso,
    entries: entries.sort(sortEntries)
  });

  await writeHotMarketQueue(queue);
  return queue;
}

export async function tickHotMarketQueue(request: HotMarketTickRequest): Promise<HotMarketTickResponse> {
  let queue = await readHotMarketQueue();
  if (queue.entries.length === 0) {
    queue = await syncHotMarketQueue(Math.max(request.limit * 4, 20));
  }

  const now = Date.now();
  const due = queue.entries.filter((entry) => Date.parse(entry.nextCheckAt) <= now).sort(sortEntries);
  const selected = (due.length > 0 ? due : [...queue.entries].sort(sortEntries)).slice(0, request.limit);
  const processed: HotMarketTickResponse["processed"] = [];

  for (const entry of selected) {
    const response = await runMarketResearchBySlug(
      entry.slug,
      {
        bypassCache: request.bypassCache,
        maxCitations: 5
      },
      {
        runType: "monitor_tick"
      }
    );

    processed.push({
      slug: entry.slug,
      runId: response.run.runId,
      lean: response.final.lean,
      leanConfidence: response.final.leanConfidence,
      resolutionStatus: response.final.resolutionStatus,
      totalUsd: response.costs.totalUsd,
      totalMs: response.latencies.totalMs,
      nextCheckAt: response.final.nextCheckAt
    });

    entry.lastCheckedAt = new Date().toISOString();
    entry.lastRunId = response.run.runId;
    entry.lastLean = response.final.lean;
    entry.lastResolutionStatus = response.final.resolutionStatus;
    entry.lastConfidence = response.final.leanConfidence;
    entry.nextCheckAt = response.final.nextCheckAt ?? computeNextCheckAt(entry.endTimeUtc, response.final.resolutionStatus);
  }

  queue = HotMarketQueueSchema.parse({
    updatedAt: new Date().toISOString(),
    entries: queue.entries.sort(sortEntries)
  });

  await writeHotMarketQueue(queue);

  return HotMarketTickResponseSchema.parse({
    tickedAt: new Date().toISOString(),
    processed,
    queue
  });
}

async function readHotMarketQueue(): Promise<HotMarketQueue> {
  try {
    const payload = await readFile(HOT_MARKETS_PATH, "utf8");
    return HotMarketQueueSchema.parse(JSON.parse(payload));
  } catch {
    return HotMarketQueueSchema.parse({
      updatedAt: new Date(0).toISOString(),
      entries: []
    });
  }
}

async function writeHotMarketQueue(queue: HotMarketQueue): Promise<void> {
  await mkdir(MONITORS_DIR, { recursive: true });
  await writeFile(HOT_MARKETS_PATH, JSON.stringify(queue, null, 2), "utf8");
}

function computePriorityScore(endTimeUtc: string, category: string): number {
  const deadline = Date.parse(endTimeUtc);
  const hoursUntilDeadline = Number.isNaN(deadline) ? 999 : Math.max((deadline - Date.now()) / (1000 * 60 * 60), 0);

  let score = 1;
  if (hoursUntilDeadline <= 24) {
    score += 4;
  } else if (hoursUntilDeadline <= 72) {
    score += 3;
  } else if (hoursUntilDeadline <= 24 * 7) {
    score += 2;
  }

  if (["politics", "world", "crypto", "business"].includes(category.toLowerCase())) {
    score += 1;
  }

  return Number(score.toFixed(2));
}

function computeNextCheckAt(endTimeUtc: string, resolutionStatus?: HotMarketEntry["lastResolutionStatus"]): string {
  const now = Date.now();
  const deadline = Date.parse(endTimeUtc);
  const hoursUntilDeadline = Number.isNaN(deadline) ? 999 : (deadline - now) / (1000 * 60 * 60);

  let ttlMs = 1000 * 60 * 60 * 6;

  if (resolutionStatus === "RESOLVED_YES" || resolutionStatus === "RESOLVED_NO") {
    ttlMs = 1000 * 60 * 60 * 12;
  } else if (hoursUntilDeadline <= 24) {
    ttlMs = 1000 * 60 * 15;
  } else if (hoursUntilDeadline <= 72) {
    ttlMs = 1000 * 60 * 60;
  }

  return new Date(now + ttlMs).toISOString();
}

function sortEntries(a: HotMarketEntry, b: HotMarketEntry): number {
  if (a.priorityScore !== b.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }

  return Date.parse(a.nextCheckAt) - Date.parse(b.nextCheckAt);
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
