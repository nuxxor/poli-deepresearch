import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CalibrationSummarySchema,
  type Lean,
  type CalibrationSummary,
  type MarketContext,
  type ProbabilisticForecast
} from "@polymarket/deep-research-contracts";

import { PROJECT_ROOT } from "../paths.js";
import { loadArchivedRunSnapshots, type ArchivedRunSnapshot } from "./archive-runs.js";
import { applyCalibratedProbability } from "./probabilistic-forecast.js";

const GOLD_DATASET_PATH = resolve(PROJECT_ROOT, "evals", "resolved-gold-set.v2.json");

export type CalibrationCase = {
  category?: string;
  resolutionArchetype?: string;
  correct: boolean;
  direction: "YES" | "NO";
  confidence: number;
  source: "archived_run";
};

export async function calibrateForecast(
  market: MarketContext,
  forecast: ProbabilisticForecast
): Promise<{ forecast: ProbabilisticForecast; summary: CalibrationSummary }> {
  const cases = await loadCalibrationCases();
  return calibrateForecastWithCases(market, forecast, cases);
}

export function calibrateForecastWithCases(
  market: MarketContext,
  forecast: ProbabilisticForecast,
  cases: CalibrationCase[]
): { forecast: ProbabilisticForecast; summary: CalibrationSummary } {
  const direction = forecast.calibratedYesProbability >= 0.5 ? "YES" : "NO";
  const rawDirectionalConfidence = Math.abs(forecast.calibratedYesProbability - 0.5) * 2;

  if (cases.length === 0) {
    const summary = CalibrationSummarySchema.parse({
      status: "insufficient",
      sampleSize: 0,
      bucketAccuracy: 0.5,
      adjustment: 0,
      notes: ["no_labeled_history"]
    });
    return { forecast, summary };
  }

  const exact = pickCases(cases, market.canonicalMarket.category, market.canonicalMarket.resolutionArchetype, direction);
  const categoryOnly = pickCases(cases, market.canonicalMarket.category, undefined, direction);
  const directionOnly = cases.filter((item) => item.direction === direction);

  const chosen = exact.length >= 2 ? exact : categoryOnly.length >= 2 ? categoryOnly : directionOnly;
  const bucketAccuracy = smoothedAccuracy(chosen);
  const categoryAccuracy = categoryOnly.length > 0 ? smoothedAccuracy(categoryOnly) : undefined;
  const archetypeAccuracy = exact.length > 0 ? smoothedAccuracy(exact) : undefined;
  const fallbackAccuracy = defaultAccuracyForLean(forecast.lean);
  const referenceAccuracy = chosen.length > 0 ? bucketAccuracy : fallbackAccuracy;
  const calibratedYesProbability = deriveCalibratedYesProbability(
    forecast.calibratedYesProbability,
    referenceAccuracy
  );

  const notes = [
    `direction=${direction.toLowerCase()}`,
    `raw_confidence=${rawDirectionalConfidence.toFixed(3)}`,
    `bucket_accuracy=${referenceAccuracy.toFixed(3)}`,
    chosen.length > 0 ? `bucket_size=${chosen.length}` : "fallback_prior_used"
  ];

  const summary = CalibrationSummarySchema.parse({
    status: chosen.length > 0 ? "empirical" : "fallback",
    sampleSize: chosen.length,
    bucketAccuracy: referenceAccuracy,
    categoryAccuracy,
    archetypeAccuracy,
    adjustment: round3(calibratedYesProbability - forecast.posteriorYesProbability),
    notes
  });

  return {
    forecast: applyCalibratedProbability(
      forecast,
      clamp(0.02, 0.98, calibratedYesProbability),
      `Calibration adjusted confidence using ${chosen.length > 0 ? `${chosen.length} labeled archived cases` : "a fallback prior"}.`
    ),
    summary
  };
}

export function deriveCalibratedYesProbability(baseYesProbability: number, bucketAccuracy: number): number {
  const direction = baseYesProbability >= 0.5 ? "YES" : "NO";
  const rawDirectionalConfidence = Math.abs(baseYesProbability - 0.5) * 2;
  const calibratedDirectionalConfidence = clamp(
    0,
    0.98,
    rawDirectionalConfidence * 0.65 + (bucketAccuracy - 0.5) * 2 * 0.35
  );

  return direction === "YES"
    ? 0.5 + calibratedDirectionalConfidence / 2
    : 0.5 - calibratedDirectionalConfidence / 2;
}

async function loadCalibrationCases(): Promise<CalibrationCase[]> {
  const goldCases = await loadGoldCaseMap();
  const archivedRuns = await loadArchivedRunSnapshots(300);

  return archivedRuns
    .map((snapshot) => toCalibrationCase(snapshot, goldCases))
    .filter((value): value is CalibrationCase => value !== null);
}

async function loadGoldCaseMap(): Promise<Map<string, "YES" | "NO">> {
  try {
    const payload = await readFile(GOLD_DATASET_PATH, "utf8");
    const parsed = JSON.parse(payload) as { cases?: Array<{ slug?: string; expectedState?: "YES" | "NO" }> };
    return new Map(
      (parsed.cases ?? [])
        .filter((item): item is { slug: string; expectedState: "YES" | "NO" } => Boolean(item.slug && item.expectedState))
        .map((item) => [item.slug, item.expectedState])
    );
  } catch {
    return new Map();
  }
}

function toCalibrationCase(
  snapshot: ArchivedRunSnapshot,
  goldCases: Map<string, "YES" | "NO">
): CalibrationCase | null {
  if (!snapshot.slug || !snapshot.lean || snapshot.lean === "TOSSUP") {
    return null;
  }

  const expected = goldCases.get(snapshot.slug);
  if (!expected) {
    return null;
  }

  const direction = snapshot.lean === "LEAN_YES" || snapshot.lean === "STRONG_YES" ? "YES" : "NO";
  const confidence = clamp(0.05, 0.99, snapshot.leanConfidence ?? defaultConfidenceForLean(snapshot.lean));

  return {
    category: snapshot.category,
    resolutionArchetype: snapshot.resolutionArchetype,
    correct: direction === expected,
    direction,
    confidence,
    source: "archived_run"
  };
}

function pickCases(
  cases: CalibrationCase[],
  category: string | undefined,
  resolutionArchetype: string | undefined,
  direction: "YES" | "NO"
): CalibrationCase[] {
  return cases.filter((item) => {
    if (item.direction !== direction) {
      return false;
    }
    if (category && item.category !== category) {
      return false;
    }
    if (resolutionArchetype && item.resolutionArchetype !== resolutionArchetype) {
      return false;
    }
    return true;
  });
}

function smoothedAccuracy(cases: CalibrationCase[]): number {
  if (cases.length === 0) {
    return 0.5;
  }

  const weightedCorrect = cases.reduce((sum, item) => sum + (item.correct ? item.confidence : 0), 0);
  const weightedTotal = cases.reduce((sum, item) => sum + item.confidence, 0);
  return clamp(0.5, 0.95, (weightedCorrect + 1.2) / (weightedTotal + 2));
}

function defaultAccuracyForLean(lean: Lean): number {
  switch (lean) {
    case "STRONG_YES":
    case "STRONG_NO":
      return 0.76;
    case "LEAN_YES":
    case "LEAN_NO":
      return 0.63;
    case "TOSSUP":
      return 0.5;
  }
}

function defaultConfidenceForLean(lean: ArchivedRunSnapshot["lean"]): number {
  switch (lean) {
    case "STRONG_YES":
    case "STRONG_NO":
      return 0.8;
    case "LEAN_YES":
    case "LEAN_NO":
      return 0.62;
    case "TOSSUP":
    case undefined:
      return 0.5;
  }
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
