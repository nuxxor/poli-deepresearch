import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runMarketResearchBySlug } from "../services/research.js";

type BusinessTechBenchmarkArgs = {
  slugs: string[];
  baselinePath?: string;
  bypassCache: boolean;
  maxCitations: number;
};

type BaselineEntry = {
  slug: string;
  lean?: string;
  resolutionStatus?: string;
  totalUsd?: number;
  totalMs?: number;
  finalMode?: string;
};

const DEFAULT_SLUGS = [
  "will-amazon-acquire-tiktok-277-366-936",
  "will-applovin-acquire-tiktok-682-567",
  "will-fannie-mae-not-ipo-by-june-30-2026",
  "will-gpt-6-be-released",
  "will-openai-not-ipo-by-december-31-2026",
  "will-tesla-release-optimus-by-june-30-2026"
] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../../../..");
const BENCHMARKS_DIR = resolve(PROJECT_ROOT, "benchmarks");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const baseline = args.baselinePath ? await loadBaseline(args.baselinePath) : new Map<string, BaselineEntry>();
  const results: Array<Record<string, unknown>> = [];

  for (const [index, slug] of args.slugs.entries()) {
    const response = await runMarketResearchBySlug(
      slug,
      {
        bypassCache: args.bypassCache,
        maxCitations: args.maxCitations
      },
      {
        runType: "deep_refresh"
      }
    );

    const baselineEntry = baseline.get(slug);
    const result = {
      slug,
      title: response.market.canonicalMarket.title,
      category: response.market.canonicalMarket.category,
      policyPackId: response.appliedPolicy.pack.id,
      status: 200,
      lean: response.final.lean,
      leanConfidence: response.final.leanConfidence,
      resolutionStatus: response.final.resolutionStatus,
      resolutionConfidence: response.final.resolutionConfidence,
      why: response.final.why,
      nextCheckAt: response.final.nextCheckAt ?? null,
      totalUsd: response.costs.totalUsd,
      totalMs: response.latencies.totalMs,
      cacheHit: response.cache.hit,
      finalMode: response.strategy.finalMode,
      ranParallel: response.strategy.ranParallel,
      ranXai: response.strategy.ranXai,
      ranDirect: response.strategy.ranDirect,
      ranLocalOpinion: response.strategy.ranLocalOpinion,
      baseline: baselineEntry
        ? {
            lean: baselineEntry.lean ?? null,
            resolutionStatus: baselineEntry.resolutionStatus ?? null,
            totalUsd: baselineEntry.totalUsd ?? null,
            totalMs: baselineEntry.totalMs ?? null,
            finalMode: baselineEntry.finalMode ?? null,
            deltaUsd: roundDelta(response.costs.totalUsd, baselineEntry.totalUsd),
            deltaMs: roundDelta(response.latencies.totalMs, baselineEntry.totalMs)
          }
        : null
    };

    results.push(result);

    const deltaUsd = baselineEntry?.totalUsd != null ? roundDelta(response.costs.totalUsd, baselineEntry.totalUsd) : null;
    const deltaMs = baselineEntry?.totalMs != null ? roundDelta(response.latencies.totalMs, baselineEntry.totalMs) : null;
    const deltaUsdText = deltaUsd == null ? "n/a" : `${deltaUsd >= 0 ? "+" : ""}${deltaUsd.toFixed(4)}`;
    const deltaMsText = deltaMs == null ? "n/a" : `${deltaMs >= 0 ? "+" : ""}${Math.round(deltaMs)}ms`;

    console.log(
      `[${index + 1}/${args.slugs.length}] ${slug} -> lean=${response.final.lean}@${response.final.leanConfidence.toFixed(2)} res=${response.final.resolutionStatus} mode=${response.strategy.finalMode} cost=$${response.costs.totalUsd.toFixed(4)} (${deltaUsdText}) latency=${Math.round(response.latencies.totalMs)}ms (${deltaMsText})`
    );
  }

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    count: results.length,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    baselinePath: args.baselinePath ?? null,
    results
  };

  await mkdir(BENCHMARKS_DIR, { recursive: true });
  const stamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const latestPath = resolve(BENCHMARKS_DIR, "business-tech-benchmark-latest.json");
  const datedPath = resolve(BENCHMARKS_DIR, `business-tech-benchmark-${stamp}.json`);
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  await writeFile(latestPath, payload, "utf8");
  await writeFile(datedPath, payload, "utf8");

  const totalUsd = results.reduce((sum, result) => sum + Number(result.totalUsd ?? 0), 0);
  const totalMs = results.reduce((sum, result) => sum + Number(result.totalMs ?? 0), 0);

  console.log("");
  console.log(`Report: ${datedPath}`);
  console.log(`Latest: ${latestPath}`);
  console.log(`Total cost: $${totalUsd.toFixed(4)}`);
  console.log(`Avg cost: $${(results.length === 0 ? 0 : totalUsd / results.length).toFixed(4)}`);
  console.log(`Avg latency: ${Math.round(results.length === 0 ? 0 : totalMs / results.length)}ms`);
}

function parseArgs(argv: string[]): BusinessTechBenchmarkArgs {
  const parsed: BusinessTechBenchmarkArgs = {
    slugs: [],
    baselinePath: undefined,
    bypassCache: false,
    maxCitations: 4
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--slug" && next) {
      parsed.slugs.push(next);
      index += 1;
      continue;
    }

    if (arg === "--baseline" && next) {
      parsed.baselinePath = resolveFromWorkspaceRoot(next);
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

  if (parsed.slugs.length === 0) {
    parsed.slugs = [...DEFAULT_SLUGS];
  }

  return parsed;
}

function resolveFromWorkspaceRoot(path: string): string {
  if (path.startsWith("/")) {
    return path;
  }

  return resolve(PROJECT_ROOT, path);
}

async function loadBaseline(path: string): Promise<Map<string, BaselineEntry>> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as {
    results?: BaselineEntry[];
  };

  return new Map((parsed.results ?? []).map((entry) => [entry.slug, entry]));
}

function roundDelta(current: number, baseline?: number): number | null {
  if (baseline == null) {
    return null;
  }

  return Number((current - baseline).toFixed(6));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
