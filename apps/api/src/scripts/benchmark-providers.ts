import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProviderBenchmarkRequestSchema, type BenchmarkCandidate } from "@polymarket/deep-research-contracts";

import { DEFAULT_BENCHMARK_PROVIDERS, runProviderBenchmark } from "../services/benchmarks.js";

type ParsedArgs = {
  slugs: string[];
  providers: BenchmarkCandidate[];
  maxResults: number;
};

const DEFAULT_BENCHMARK_SLUGS = [
  "russia-ukraine-ceasefire-before-gta-vi-554",
  "trump-out-as-president-before-gta-vi-846",
  "will-china-invades-taiwan-before-gta-vi-716",
  "will-bitcoin-hit-1m-before-gta-vi-872",
  "gta-vi-released-before-june-2026",
  "new-rhianna-album-before-gta-vi-926",
  "will-harvey-weinstein-be-sentenced-to-no-prison-time",
  "will-the-golden-state-warriors-win-the-2026-nba-finals",
  "megaeth-market-cap-fdv-2b-one-day-after-launch-738-867-649-272-765-733",
  "putin-out-before-2027"
] as const;

async function main(): Promise<void> {
  const args = await parseArgs(process.argv.slice(2));
  const report = await runProviderBenchmark(
    ProviderBenchmarkRequestSchema.parse({
      slugs: args.slugs,
      providers: args.providers,
      maxResults: args.maxResults
    })
  );

  const outputDir = resolve(getWorkspaceRoot(), "benchmarks");
  mkdirSync(outputDir, { recursive: true });

  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const latestPath = resolve(outputDir, "provider-benchmark-latest.json");
  const datedPath = resolve(outputDir, `provider-benchmark-${stamp}.json`);
  const payload = JSON.stringify(report, null, 2);

  writeFileSync(latestPath, payload);
  writeFileSync(datedPath, payload);

  console.log(`Saved benchmark report to ${datedPath}`);

  for (const market of report.markets) {
    console.log(`\n${market.slug}`);
    console.log(`  title: ${market.title}`);
    console.log(`  web_query: ${market.queryPlan.webQuery}`);

    for (const provider of market.providers) {
      const status = provider.ok ? "ok" : "error";
      const cost = provider.estimatedRetrievalCostUsd != null ? `$${provider.estimatedRetrievalCostUsd.toFixed(4)}` : "n/a";
      const note = provider.ok ? `${provider.resultCount} results` : provider.error;
      console.log(
        `  - ${provider.provider.padEnd(10)} ${status.padEnd(5)} ${String(provider.durationMs).padStart(5)}ms cost=${cost} ${note}`
      );
    }
  }
}

async function parseArgs(argv: string[]): Promise<ParsedArgs> {
  const slugs: string[] = [];
  const providers: BenchmarkCandidate[] = [];
  let maxResults = 5;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--slug" && next) {
      slugs.push(next);
      index += 1;
      continue;
    }

    if (token === "--provider" && next) {
      providers.push(next as BenchmarkCandidate);
      index += 1;
      continue;
    }

    if (token === "--max-results" && next) {
      maxResults = Number(next);
      index += 1;
    }
  }

  return {
    slugs: slugs.length > 0 ? slugs : [...DEFAULT_BENCHMARK_SLUGS],
    providers: providers.length > 0 ? providers : DEFAULT_BENCHMARK_PROVIDERS,
    maxResults
  };
}

function getWorkspaceRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "../../../../");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
