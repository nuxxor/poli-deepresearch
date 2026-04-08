import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MarketResearchResponse } from "@polymarket/deep-research-contracts";

type HoldoutBenchmarkArgs = {
  slugs: string[];
  baselinePath?: string;
  bypassCache: boolean;
  maxCitations: number;
  timeoutMs: number;
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
  "russia-ukraine-ceasefire-before-gta-vi-554",
  "will-china-invades-taiwan-before-gta-vi-716",
  "new-rhianna-album-before-gta-vi-926",
  "new-playboi-carti-album-before-gta-vi-421",
  "will-harvey-weinstein-be-sentenced-to-no-prison-time",
  "will-harvey-weinstein-be-sentenced-to-between-10-and-20-years-in-prison",
  "will-the-golden-state-warriors-win-the-2026-nba-finals",
  "putin-out-before-2027",
  "will-jd-vance-win-the-2028-us-presidential-election",
  "will-kamala-harris-win-the-2028-us-presidential-election"
] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../../../..");
const BENCHMARKS_DIR = resolve(PROJECT_ROOT, "benchmarks");
const API_BASE = "http://127.0.0.1:4010";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const baseline = args.baselinePath ? await loadBaseline(args.baselinePath) : new Map<string, BaselineEntry>();
  const results: Array<Record<string, unknown>> = [];

  for (const [index, slug] of args.slugs.entries()) {
    const baselineEntry = baseline.get(slug);
    console.log(`[${index + 1}/${args.slugs.length}] starting ${slug}`);

    try {
      const response = await runMarketWithRetry(slug, args);
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
        citations: response.citations.length,
        evidence: response.evidence.length,
        claims: response.claims?.length ?? 0,
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
      console.log(
        `[${index + 1}/${args.slugs.length}] ${slug} -> lean=${response.final.lean}@${response.final.leanConfidence.toFixed(2)} res=${response.final.resolutionStatus} mode=${response.strategy.finalMode} cost=$${response.costs.totalUsd.toFixed(4)} latency=${Math.round(response.latencies.totalMs)}ms`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown benchmark failure";
      results.push({
        slug,
        title: null,
        category: null,
        policyPackId: null,
        status: 500,
        lean: null,
        leanConfidence: 0,
        resolutionStatus: null,
        resolutionConfidence: 0,
        why: message,
        nextCheckAt: null,
        totalUsd: 0,
        totalMs: 0,
        cacheHit: false,
        finalMode: "failed",
        ranParallel: false,
        ranXai: false,
        ranDirect: false,
        ranLocalOpinion: false,
        citations: 0,
        evidence: 0,
        claims: 0,
        baseline: baselineEntry
          ? {
              lean: baselineEntry.lean ?? null,
              resolutionStatus: baselineEntry.resolutionStatus ?? null,
              totalUsd: baselineEntry.totalUsd ?? null,
              totalMs: baselineEntry.totalMs ?? null,
              finalMode: baselineEntry.finalMode ?? null,
              deltaUsd: baselineEntry.totalUsd == null ? null : roundDelta(0, baselineEntry.totalUsd),
              deltaMs: baselineEntry.totalMs == null ? null : roundDelta(0, baselineEntry.totalMs)
            }
          : null
      });
      console.log(`[${index + 1}/${args.slugs.length}] ${slug} -> ERROR ${message}`);
    }
  }

  const okResults = results.filter((result) => result.status === 200);
  const totalUsd = okResults.reduce((sum, result) => sum + Number(result.totalUsd ?? 0), 0);
  const totalMs = okResults.reduce((sum, result) => sum + Number(result.totalMs ?? 0), 0);
  const parallelCount = okResults.filter((result) => result.ranParallel === true).length;
  const xaiCount = okResults.filter((result) => result.ranXai === true).length;
  const directCount = okResults.filter((result) => result.ranDirect === true).length;
  const localFloorCount = okResults.filter((result) => result.ranLocalOpinion === true).length;
  const dualSynthesizedCount = okResults.filter((result) => result.finalMode === "dual_synthesized").length;

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    count: results.length,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    baselinePath: args.baselinePath ?? null,
    summary: {
      successCount: okResults.length,
      errorCount: results.length - okResults.length,
      parallelCount,
      xaiCount,
      directCount,
      localFloorCount,
      dualSynthesizedCount,
      totalUsd: Number(totalUsd.toFixed(4)),
      averageUsd: Number((okResults.length === 0 ? 0 : totalUsd / okResults.length).toFixed(4)),
      averageMs: Math.round(okResults.length === 0 ? 0 : totalMs / okResults.length)
    },
    results
  };

  await mkdir(BENCHMARKS_DIR, { recursive: true });
  const stamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const latestPath = resolve(BENCHMARKS_DIR, "research-holdout-benchmark-latest.json");
  const datedPath = resolve(BENCHMARKS_DIR, `research-holdout-benchmark-${stamp}.json`);
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  await writeFile(latestPath, payload, "utf8");
  await writeFile(datedPath, payload, "utf8");

  console.log("");
  console.log(`Report: ${datedPath}`);
  console.log(`Latest: ${latestPath}`);
  console.log(`Parallel: ${parallelCount}/${okResults.length}`);
  console.log(`xAI: ${xaiCount}/${okResults.length}`);
  console.log(`Direct: ${directCount}/${okResults.length}`);
  console.log(`Local floor: ${localFloorCount}/${okResults.length}`);
  console.log(`Dual synthesized: ${dualSynthesizedCount}/${okResults.length}`);
  console.log(`Total cost: $${totalUsd.toFixed(4)}`);
  console.log(`Avg cost: $${(okResults.length === 0 ? 0 : totalUsd / okResults.length).toFixed(4)}`);
  console.log(`Avg latency: ${Math.round(okResults.length === 0 ? 0 : totalMs / okResults.length)}ms`);
}

function parseArgs(argv: string[]): HoldoutBenchmarkArgs {
  const parsed: HoldoutBenchmarkArgs = {
    slugs: [],
    baselinePath: undefined,
    bypassCache: false,
    maxCitations: 5,
    timeoutMs: 120000
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

    if (arg === "--timeout-ms" && next) {
      parsed.timeoutMs = Number.parseInt(next, 10);
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

async function runMarketWithRetry(slug: string, args: HoldoutBenchmarkArgs): Promise<MarketResearchResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const params = new URLSearchParams({
        bypassCache: String(args.bypassCache),
        maxCitations: String(args.maxCitations)
      });
      const response = await fetch(`${API_BASE}/v1/research/slug/${encodeURIComponent(slug)}/latest?${params.toString()}`, {
        signal: AbortSignal.timeout(args.timeoutMs)
      });
      const payload = (await response.json()) as MarketResearchResponse & { error?: string };

      if (!response.ok) {
        throw new Error(String(payload.error ?? `HTTP ${response.status}`));
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= 3) {
        throw error;
      }
      await sleep(1500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("benchmark retry exhausted");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
