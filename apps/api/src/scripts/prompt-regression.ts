import { runResolvedGoldEval } from "../services/evals.js";

type CliOptions = {
  limit?: number;
  minLeanAccuracy: number;
  minResolutionAccuracy: number;
  maxAvgCostUsd?: number;
  bypassCache: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { report, reportPath } = await runResolvedGoldEval({
    limit: options.limit,
    bypassCache: options.bypassCache
  });

  const failures: string[] = [];

  if (report.totals.leanAccuracy < options.minLeanAccuracy) {
    failures.push(`leanAccuracy ${report.totals.leanAccuracy.toFixed(3)} < ${options.minLeanAccuracy.toFixed(3)}`);
  }

  if (report.totals.resolutionAccuracy < options.minResolutionAccuracy) {
    failures.push(
      `resolutionAccuracy ${report.totals.resolutionAccuracy.toFixed(3)} < ${options.minResolutionAccuracy.toFixed(3)}`
    );
  }

  if (options.maxAvgCostUsd != null && report.totals.avgCostUsd > options.maxAvgCostUsd) {
    failures.push(`avgCostUsd ${report.totals.avgCostUsd.toFixed(4)} > ${options.maxAvgCostUsd.toFixed(4)}`);
  }

  console.log(`prompt regression report: ${reportPath}`);
  console.log(
    `leanAccuracy=${report.totals.leanAccuracy.toFixed(3)} resolutionAccuracy=${report.totals.resolutionAccuracy.toFixed(3)} avgCostUsd=${report.totals.avgCostUsd.toFixed(4)} avgLatencyMs=${Math.round(report.totals.avgLatencyMs)}`
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("PASS prompt regression thresholds satisfied");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    minLeanAccuracy: 0.6,
    minResolutionAccuracy: 0.85,
    bypassCache: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--limit":
        options.limit = next ? Number.parseInt(next, 10) : undefined;
        index += 1;
        break;
      case "--min-lean-accuracy":
        options.minLeanAccuracy = next ? Number.parseFloat(next) : options.minLeanAccuracy;
        index += 1;
        break;
      case "--min-resolution-accuracy":
        options.minResolutionAccuracy = next ? Number.parseFloat(next) : options.minResolutionAccuracy;
        index += 1;
        break;
      case "--max-avg-cost":
        options.maxAvgCostUsd = next ? Number.parseFloat(next) : options.maxAvgCostUsd;
        index += 1;
        break;
      case "--bypass-cache":
        options.bypassCache = true;
        break;
      default:
        break;
    }
  }

  return options;
}

void main();
