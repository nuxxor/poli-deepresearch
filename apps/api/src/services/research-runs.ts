import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ResearchRunListResponseSchema,
  ResearchRunRecordSchema,
  ResearchRunSummarySchema,
  type MarketResearchRequest,
  type MarketResearchResponse,
  type ResearchRunListResponse,
  type ResearchRunMeta,
  type ResearchRunRecord,
  type ResearchRunSummary,
  type RunType
} from "@polymarket/deep-research-contracts";
import { DATA_ROOT } from "../paths.js";
import { withEvidenceArtifacts } from "./evidence-graph.js";

const RUNS_DIR = resolve(DATA_ROOT, "runs");
const RUNS_INDEX_PATH = resolve(RUNS_DIR, "index.json");
const MAX_INDEX_ITEMS = 500;

export function createResearchRunMeta(runType: RunType, replayOfRunId?: string): ResearchRunMeta {
  return {
    runId: randomUUID(),
    runType,
    createdAt: new Date().toISOString(),
    replayOfRunId
  };
}

export async function saveResearchRun(
  response: MarketResearchResponse,
  request: MarketResearchRequest
): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });

  const record = ResearchRunRecordSchema.parse({
    runId: response.run.runId,
    request,
    response
  });

  await writeFile(
    resolve(RUNS_DIR, `${response.run.runId}.json`),
    JSON.stringify(record, null, 2),
    "utf8"
  );

  const nextIndex = [toSummary(record), ...(await readRunIndex()).filter((item) => item.runId !== record.runId)].slice(
    0,
    MAX_INDEX_ITEMS
  );

  await writeFile(RUNS_INDEX_PATH, JSON.stringify({ runs: nextIndex }, null, 2), "utf8");
}

export async function loadResearchRun(runId: string): Promise<ResearchRunRecord> {
  const payload = await readFile(resolve(RUNS_DIR, `${runId}.json`), "utf8");
  const parsed = ResearchRunRecordSchema.parse(JSON.parse(payload));
  return ResearchRunRecordSchema.parse({
    ...parsed,
    response: withEvidenceArtifacts(parsed.response)
  });
}

export async function listRecentResearchRuns(limit: number): Promise<ResearchRunListResponse> {
  const runs = (await readRunIndex()).slice(0, Math.max(1, limit));
  return ResearchRunListResponseSchema.parse({ runs });
}

async function readRunIndex(): Promise<ResearchRunSummary[]> {
  try {
    const payload = await readFile(RUNS_INDEX_PATH, "utf8");
    const parsed = ResearchRunListResponseSchema.parse(JSON.parse(payload));
    return parsed.runs;
  } catch {
    return [];
  }
}

function toSummary(record: ResearchRunRecord): ResearchRunSummary {
  return ResearchRunSummarySchema.parse({
    runId: record.response.run.runId,
    runType: record.response.run.runType,
    createdAt: record.response.run.createdAt,
    replayOfRunId: record.response.run.replayOfRunId,
    marketId: record.response.market.canonicalMarket.marketId,
    slug: record.response.market.canonicalMarket.slug,
    title: record.response.market.canonicalMarket.title,
    lean: record.response.final.lean,
    leanConfidence: record.response.final.leanConfidence,
    resolutionStatus: record.response.final.resolutionStatus,
    totalUsd: record.response.costs.totalUsd,
    totalMs: record.response.latencies.totalMs,
    cacheHit: record.response.cache.hit
  });
}
