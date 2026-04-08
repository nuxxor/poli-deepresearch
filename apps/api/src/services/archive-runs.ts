import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DATA_ROOT } from "../paths.js";

const RUNS_DIR = resolve(DATA_ROOT, "runs");
const RUNS_INDEX_PATH = resolve(RUNS_DIR, "index.json");

export type ArchivedRunSnapshot = {
  runId: string;
  slug?: string;
  title: string;
  category?: string;
  resolutionArchetype?: string;
  lean?: "STRONG_NO" | "LEAN_NO" | "TOSSUP" | "LEAN_YES" | "STRONG_YES";
  leanConfidence?: number;
  resolutionStatus?: "NOT_YET_RESOLVED" | "RESOLVED_YES" | "RESOLVED_NO";
  why?: string;
  createdAt?: string;
};

export async function loadArchivedRunSnapshots(limit = 200): Promise<ArchivedRunSnapshot[]> {
  const boundedLimit = Math.max(1, limit);
  const indexedFileNames = await readIndexedRunFileNames(boundedLimit);
  const directoryFileNames =
    indexedFileNames.length >= boundedLimit ? [] : await readRunDirectoryFileNames();
  const fileNames = dedupeFileNames([...indexedFileNames, ...directoryFileNames]);

  if (fileNames.length === 0) {
    return [];
  }

  const selectedFileNames = fileNames.slice(0, boundedLimit);
  const snapshots = await Promise.all(
    selectedFileNames.map(async (fileName) => {
      try {
        const payload = await readFile(resolve(RUNS_DIR, fileName), "utf8");
        return normalizeArchivedRun(JSON.parse(payload));
      } catch {
        return null;
      }
    })
  );

  return snapshots.filter((snapshot): snapshot is ArchivedRunSnapshot => snapshot !== null);
}

async function readIndexedRunFileNames(limit: number): Promise<string[]> {
  try {
    const payload = await readFile(RUNS_INDEX_PATH, "utf8");
    const parsed = JSON.parse(payload) as { runs?: Array<{ runId?: string }> };
    return (parsed.runs ?? [])
      .map((item) => item.runId)
      .filter((runId): runId is string => typeof runId === "string" && runId.trim() !== "")
      .slice(0, limit)
      .map((runId) => `${runId}.json`);
  } catch {
    return [];
  }
}

async function readRunDirectoryFileNames(): Promise<string[]> {
  try {
    return (await readdir(RUNS_DIR))
      .filter((fileName) => fileName.endsWith(".json") && fileName !== "index.json")
      .sort();
  } catch {
    return [];
  }
}

function dedupeFileNames(fileNames: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const fileName of fileNames) {
    if (seen.has(fileName)) {
      continue;
    }
    seen.add(fileName);
    items.push(fileName);
  }

  return items;
}

function normalizeArchivedRun(value: unknown): ArchivedRunSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const root = value as Record<string, unknown>;
  const response = asRecord(root.response);
  if (!response) {
    return null;
  }

  const market = asRecord(response.market);
  const canonicalMarket = asRecord(market?.canonicalMarket);
  const final = asRecord(response.final);
  const run = asRecord(response.run);

  const title = getString(canonicalMarket?.title) ?? getString(asRecord(market?.rawMarket)?.question);
  if (!title) {
    return null;
  }

  const state = getString(final?.state);
  const lean = normalizeLean(getString(final?.lean), state);
  const leanConfidence = normalizeProbability(final?.leanConfidence ?? final?.researchConfidence);
  const resolutionStatus = normalizeResolutionStatus(getString(final?.resolutionStatus), state);

  return {
    runId: getString(run?.runId) ?? getString(root.runId) ?? fileSafeId(title),
    slug: getString(canonicalMarket?.slug),
    title,
    category: getString(canonicalMarket?.category),
    resolutionArchetype: getString(canonicalMarket?.resolutionArchetype),
    lean,
    leanConfidence,
    resolutionStatus,
    why: getString(final?.why),
    createdAt: getString(run?.createdAt)
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function normalizeProbability(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  if (numeric > 1 && numeric <= 100) {
    return Math.max(0, Math.min(1, numeric / 100));
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeLean(
  lean: string | undefined,
  legacyState: string | undefined
): ArchivedRunSnapshot["lean"] {
  if (lean === "STRONG_NO" || lean === "LEAN_NO" || lean === "TOSSUP" || lean === "LEAN_YES" || lean === "STRONG_YES") {
    return lean;
  }

  if (legacyState === "YES") {
    return "STRONG_YES";
  }

  if (legacyState === "NO") {
    return "STRONG_NO";
  }

  return undefined;
}

function normalizeResolutionStatus(
  resolutionStatus: string | undefined,
  legacyState: string | undefined
): ArchivedRunSnapshot["resolutionStatus"] {
  if (resolutionStatus === "NOT_YET_RESOLVED" || resolutionStatus === "RESOLVED_YES" || resolutionStatus === "RESOLVED_NO") {
    return resolutionStatus;
  }

  if (legacyState === "YES") {
    return "RESOLVED_YES";
  }

  if (legacyState === "NO") {
    return "RESOLVED_NO";
  }

  return undefined;
}

function fileSafeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
