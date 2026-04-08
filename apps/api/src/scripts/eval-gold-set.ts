import { resolve } from "node:path";

import { runResolvedGoldEval } from "../services/evals.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = args.dataset ? resolve(process.cwd(), args.dataset) : undefined;
  const outputPath = args.output ? resolve(process.cwd(), args.output) : undefined;

  const { dataset, report, reportPath, latestPath } = await runResolvedGoldEval({
    datasetPath,
    outputPath,
    limit: args.limit,
    bypassCache: args.bypassCache,
    maxCitations: args.maxCitations,
    onCaseComplete: (result, index, total) => {
      const leanStatus = result.leanCorrect ? "LEAN_OK" : "LEAN_MISS";
      const resStatus = result.resolutionCorrect ? "RES_OK" : "RES_MISS";
      console.log(
        `[${index}/${total}] ${leanStatus} ${resStatus} ${result.slug} -> expected=${result.expectedState} lean=${result.predictedLean}@${result.leanConfidence.toFixed(2)} res=${result.predictedResolutionStatus} pack=${result.policyPackId} mode=${result.finalMode} cost=$${result.totalUsd.toFixed(4)} latency=${Math.round(result.totalMs)}ms`
      );
    }
  });

  console.log("");
  console.log(`Dataset: ${dataset.id}@${dataset.version}`);
  console.log(`Total: ${report.totals.total}`);
  console.log(`Lean correct: ${report.totals.leanCorrect}`);
  console.log(`Lean accuracy: ${(report.totals.leanAccuracy * 100).toFixed(1)}%`);
  console.log(`Resolution correct: ${report.totals.resolutionCorrect}`);
  console.log(`Resolution accuracy: ${(report.totals.resolutionAccuracy * 100).toFixed(1)}%`);
  console.log(`Avg cost: $${report.totals.avgCostUsd.toFixed(4)}`);
  console.log(`Avg latency: ${Math.round(report.totals.avgLatencyMs)}ms`);
  console.log(`Report: ${reportPath}`);
  console.log(`Latest: ${latestPath}`);
}

function parseArgs(argv: string[]): {
  dataset?: string;
  output?: string;
  limit?: number;
  maxCitations?: number;
  bypassCache: boolean;
} {
  const parsed = {
    dataset: undefined as string | undefined,
    output: undefined as string | undefined,
    limit: undefined as number | undefined,
    maxCitations: undefined as number | undefined,
    bypassCache: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dataset" && next) {
      parsed.dataset = next;
      index += 1;
      continue;
    }

    if (arg === "--output" && next) {
      parsed.output = next;
      index += 1;
      continue;
    }

    if (arg === "--limit" && next) {
      parsed.limit = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--max-citations" && next) {
      parsed.maxCitations = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--bypass-cache") {
      parsed.bypassCache = true;
      continue;
    }
  }

  return parsed;
}

void main();
