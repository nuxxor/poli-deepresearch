import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ResolvedGoldDatasetSchema,
  ResolvedGoldEvalReportSchema,
  type EvalSummaryBucket,
  type ResolvedGoldCase,
  type ResolvedGoldCaseResult,
  type ResolvedGoldDataset,
  type ResolvedGoldEvalReport
} from "@polymarket/deep-research-contracts";

import { runMarketResearchBySlug } from "./research.js";

const SERVICE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SERVICE_DIR, "../../../..");
const DEFAULT_DATASET_PATH = resolve(PROJECT_ROOT, "evals", "resolved-gold-set.v3.json");
const REPORTS_DIR = resolve(PROJECT_ROOT, "evals", "reports");

export type RunResolvedGoldEvalOptions = {
  datasetPath?: string;
  outputPath?: string;
  limit?: number;
  bypassCache?: boolean;
  maxCitations?: number;
  onCaseComplete?: (result: ResolvedGoldCaseResult, index: number, total: number) => void;
};

export async function loadResolvedGoldDataset(datasetPath = DEFAULT_DATASET_PATH): Promise<ResolvedGoldDataset> {
  const raw = await readFile(datasetPath, "utf8");
  return ResolvedGoldDatasetSchema.parse(JSON.parse(raw));
}

export async function runResolvedGoldEval(options: RunResolvedGoldEvalOptions = {}): Promise<{
  dataset: ResolvedGoldDataset;
  report: ResolvedGoldEvalReport;
  reportPath: string;
  latestPath: string;
}> {
  const dataset = await loadResolvedGoldDataset(options.datasetPath);
  const cases = dataset.cases.slice(0, options.limit ?? dataset.cases.length);
  const results: ResolvedGoldCaseResult[] = [];

  for (const [index, testCase] of cases.entries()) {
    const response = await runMarketResearchBySlug(
      testCase.slug,
      {
        bypassCache: options.bypassCache ?? false,
        maxCitations: options.maxCitations ?? 4
      },
      {
        runType: "deep_refresh"
      }
    );

    const result = makeCaseResult(testCase, response);
    results.push(result);
    options.onCaseComplete?.(result, index + 1, cases.length);
  }

  const report = ResolvedGoldEvalReportSchema.parse({
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    generatedAt: new Date().toISOString(),
    totals: buildTotals(results),
    byCategory: buildBucketSummary(results, (result) => result.category),
    byPolicyPack: buildBucketSummary(results, (result) => result.policyPackId),
    results
  });

  await mkdir(REPORTS_DIR, { recursive: true });
  const reportFileName = `resolved-gold-eval-${timestampForFile(report.generatedAt)}.json`;
  const reportPath = options.outputPath ?? resolve(REPORTS_DIR, reportFileName);
  const latestPath = resolve(REPORTS_DIR, "resolved-gold-eval-latest.json");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  await writeFile(reportPath, serialized, "utf8");
  await writeFile(latestPath, serialized, "utf8");

  return {
    dataset,
    report,
    reportPath,
    latestPath
  };
}

function makeCaseResult(testCase: ResolvedGoldCase, response: Awaited<ReturnType<typeof runMarketResearchBySlug>>): ResolvedGoldCaseResult {
  const predictedLean = response.final.lean;
  const predictedResolutionStatus = response.final.resolutionStatus;
  const expectedResolutionStatus =
    testCase.expectedState === "YES" ? "RESOLVED_YES" : "RESOLVED_NO";
  const expectedLeanDirection = testCase.expectedState;
  const predictedLeanDirection =
    predictedLean === "STRONG_YES" || predictedLean === "LEAN_YES"
      ? "YES"
      : predictedLean === "STRONG_NO" || predictedLean === "LEAN_NO"
        ? "NO"
        : "TOSSUP";

  return {
    slug: testCase.slug,
    title: response.market.canonicalMarket.title,
    expectedState: testCase.expectedState,
    predictedLean,
    predictedResolutionStatus,
    leanCorrect: predictedLeanDirection === expectedLeanDirection,
    resolutionCorrect: predictedResolutionStatus === expectedResolutionStatus,
    leanConfidence: response.final.leanConfidence,
    runId: response.run.runId,
    category: response.market.canonicalMarket.category,
    resolutionArchetype: response.market.canonicalMarket.resolutionArchetype,
    policyPackId: response.appliedPolicy.pack.id,
    finalMode: response.strategy.finalMode,
    totalUsd: response.costs.totalUsd,
    totalMs: response.latencies.totalMs,
    cacheHit: response.cache.hit,
    why: response.final.why,
    notes: testCase.notes
  };
}

function buildTotals(results: ResolvedGoldCaseResult[]) {
  const total = results.length;
  const leanCorrect = results.filter((result) => result.leanCorrect).length;
  const resolutionCorrect = results.filter((result) => result.resolutionCorrect).length;
  const totalUsd = results.reduce((sum, result) => sum + result.totalUsd, 0);
  const totalMs = results.reduce((sum, result) => sum + result.totalMs, 0);

  return {
    total,
    leanCorrect,
    leanAccuracy: total === 0 ? 0 : leanCorrect / total,
    resolutionCorrect,
    resolutionAccuracy: total === 0 ? 0 : resolutionCorrect / total,
    avgCostUsd: total === 0 ? 0 : totalUsd / total,
    avgLatencyMs: total === 0 ? 0 : totalMs / total
  };
}

function buildBucketSummary(
  results: ResolvedGoldCaseResult[],
  getKey: (result: ResolvedGoldCaseResult) => string
): EvalSummaryBucket[] {
  const buckets = new Map<string, ResolvedGoldCaseResult[]>();

  for (const result of results) {
    const key = getKey(result);
    const existing = buckets.get(key);
    if (existing) {
      existing.push(result);
    } else {
      buckets.set(key, [result]);
    }
  }

  return [...buckets.entries()]
    .map(([key, bucketResults]) => {
      const totals = buildTotals(bucketResults);
      return {
        key,
        total: totals.total,
        leanCorrect: totals.leanCorrect,
        leanAccuracy: totals.leanAccuracy,
        resolutionCorrect: totals.resolutionCorrect,
        resolutionAccuracy: totals.resolutionAccuracy,
        avgCostUsd: totals.avgCostUsd,
        avgLatencyMs: totals.avgLatencyMs
      };
    })
    .sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.key.localeCompare(right.key);
    });
}

function timestampForFile(iso: string): string {
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}
