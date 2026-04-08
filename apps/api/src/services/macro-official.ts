import {
  type MarketContext,
  type MacroOfficialContext
} from "@polymarket/deep-research-contracts";

import { mapMarketToFredSeries } from "./fred-mapper.js";
import { fetchFredSeriesWindow } from "./providers/fred.js";

export async function buildMacroOfficialContext(
  market: MarketContext
): Promise<MacroOfficialContext | null> {
  const mapping = mapMarketToFredSeries(market);
  if (!mapping) {
    return null;
  }

  const marketText = [
    market.canonicalMarket.title,
    market.canonicalMarket.rulesText,
    market.canonicalMarket.description ?? "",
    market.canonicalMarket.additionalContext ?? ""
  ].join("\n");
  const targetPeriod = parseTargetPeriod(marketText, market.canonicalMarket.endTimeUtc);
  const targetThreshold = parseMacroThreshold(marketText);
  const targetWindow = targetPeriod ? buildTargetObservationWindow(targetPeriod, mapping.transform) : null;

  const [window, targetedWindow] = await Promise.all([
    fetchFredSeriesWindow(mapping.seriesId, 15),
    targetWindow
      ? fetchFredSeriesWindow(mapping.seriesId, targetWindow.limit, {
          observationStart: targetWindow.observationStart,
          observationEnd: targetWindow.observationEnd,
          sortOrder: "desc"
        }).catch(() => null)
      : Promise.resolve(null)
  ]);

  const numericObservations = mergeObservations(window, targetedWindow)
    .map((item) => ({
      date: item.date,
      value: parseObservationValue(item.value)
    }))
    .filter((item): item is { date: string; value: number } => item.value != null);

  const latest = numericObservations[0];
  if (!latest) {
    throw new Error(`FRED series ${mapping.seriesId} returned no numeric observations`);
  }

  const comparison = findComparisonObservation(
    numericObservations,
    latest.date,
    mapping.transform,
    window.frequency
  );

  const transformedValue = computeTransformedValue(mapping.transform, latest.value, comparison?.value);
  const notes = [...mapping.notes];
  const estimatedReleaseAt = estimateMacroObservationReadyAt(market);

  const targetObservation = targetPeriod
    ? findObservationForTargetPeriod(numericObservations, targetPeriod)
    : undefined;
  const targetComparison = targetObservation
    ? findComparisonObservation(
        numericObservations,
        targetObservation.date,
        mapping.transform,
        window.frequency
      )
    : undefined;
  const targetTransformedValue = targetObservation
    ? computeTransformedValue(mapping.transform, targetObservation.value, targetComparison?.value)
    : undefined;
  const targetMetricValue =
    targetObservation == null
      ? undefined
      : mapping.transform === "level"
      ? targetObservation.value
      : targetTransformedValue;
  const targetThresholdSatisfied =
    targetMetricValue == null || targetThreshold == null
      ? undefined
      : evaluateMacroThreshold(targetMetricValue, targetThreshold);

  if (targetPeriod) {
    notes.push(`Target period parsed as ${targetPeriod.label}`);
  }

  if (targetThreshold) {
    notes.push(`Threshold parsed as ${formatThresholdLabel(targetThreshold)}`);
  }

  if (mapping.transform !== "level" && !comparison) {
    notes.push("Comparison observation not found for requested transform");
  }

  if (targetPeriod && !targetObservation) {
    notes.push("Target-period official observation is not available yet");
  }

  return {
    provider: "fred",
    seriesId: mapping.seriesId,
    title: window.title,
    transform: mapping.transform,
    officialDomain: mapping.officialDomain,
    officialUrl: `https://fred.stlouisfed.org/series/${mapping.seriesId}`,
    units: window.units,
    frequency: window.frequency,
    latestObservationDate: latest.date,
    latestObservationValue: latest.value,
    comparisonObservationDate: comparison?.date,
    comparisonObservationValue: comparison?.value,
    transformedValue,
    transformedLabel: buildTransformedLabel(mapping.transform),
    targetPeriodLabel: targetPeriod?.label,
    targetPeriodStatus: !targetPeriod
      ? "no_target_period"
      : targetObservation
      ? "target_available"
      : "target_not_available",
    targetObservationDate: targetObservation?.date,
    targetObservationValue: targetObservation?.value,
    targetComparisonObservationDate: targetComparison?.date,
    targetComparisonObservationValue: targetComparison?.value,
    targetTransformedValue,
    targetThresholdLabel: targetThreshold ? formatThresholdLabel(targetThreshold) : undefined,
    targetThresholdSatisfied,
    estimatedReleaseAt: estimatedReleaseAt ?? undefined,
    releaseEstimateSource: estimatedReleaseAt ? "heuristic" : undefined,
    notes
  } satisfies MacroOfficialContext;
}

export function estimateMacroObservationReadyAt(market: MarketContext): string | null {
  const mapping = mapMarketToFredSeries(market);
  if (!mapping) {
    return null;
  }

  const marketText = [
    market.canonicalMarket.title,
    market.canonicalMarket.rulesText,
    market.canonicalMarket.description ?? "",
    market.canonicalMarket.additionalContext ?? ""
  ].join("\n");
  const targetPeriod = parseTargetPeriod(marketText, market.canonicalMarket.endTimeUtc);
  if (!targetPeriod) {
    return null;
  }

  const estimate = estimateReleaseAt(mapping.seriesId, targetPeriod);
  return estimate ? new Date(estimate).toISOString() : null;
}

type ParsedTargetPeriod = {
  granularity: "month" | "quarter" | "date";
  label: string;
  year: number;
  monthIndex: number;
  day?: number;
};

type MacroThreshold =
  | {
      kind: "between";
      min: number;
      max: number;
      upperInclusive: boolean;
    }
  | {
      kind: "above";
      threshold: number;
      inclusive: boolean;
    }
  | {
      kind: "below";
      threshold: number;
      inclusive: boolean;
    };

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
] as const;

function parseObservationValue(value: string): number | null {
  if (value.trim() === "." || value.trim() === "") {
    return null;
  }

  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function computeTransformedValue(
  transform: MacroOfficialContext["transform"],
  latestValue: number,
  comparisonValue: number | undefined
): number {
  if (transform === "level") {
    return latestValue;
  }

  if (comparisonValue == null || comparisonValue === 0) {
    return latestValue;
  }

  return ((latestValue - comparisonValue) / comparisonValue) * 100;
}

function buildTransformedLabel(transform: MacroOfficialContext["transform"]): string {
  switch (transform) {
    case "mom_pct":
      return "month_over_month_pct";
    case "yoy_pct":
      return "year_over_year_pct";
    default:
      return "level";
  }
}

function parseTargetPeriod(text: string, endTimeUtc: string): ParsedTargetPeriod | null {
  const lowered = text.toLowerCase();
  const weekEndingMatch = lowered.match(
    new RegExp(
      `\\bweek\\s+ending\\s+(?:on\\s+)?(${MONTH_NAMES.join("|")})\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?`,
      "i"
    )
  );
  if (weekEndingMatch?.[1] && weekEndingMatch[2]) {
    const monthName = weekEndingMatch[1].toLowerCase();
    const monthIndex = MONTH_NAMES.indexOf(monthName as (typeof MONTH_NAMES)[number]);
    if (monthIndex >= 0) {
      const fallbackYear = inferReferenceYear(endTimeUtc);
      const day = Number.parseInt(weekEndingMatch[2], 10);
      const explicitYear = weekEndingMatch[3] ? Number.parseInt(weekEndingMatch[3], 10) : undefined;
      const year = explicitYear ?? inferYearForMonth(monthIndex, fallbackYear.year, fallbackYear.monthIndex);
      return {
        granularity: "date",
        label: `Week ending ${capitalize(monthName)} ${day}, ${year}`,
        year,
        monthIndex,
        day
      };
    }
  }

  const fromToPattern = new RegExp(
    `\\bfrom\\s+(${MONTH_NAMES.join("|")})(?:\\s+(20\\d{2}))?\\s+to\\s+(${MONTH_NAMES.join("|")})(?:\\s+(20\\d{2}))?`,
    "i"
  );
  const fromToMatch = lowered.match(fromToPattern);
  if (fromToMatch?.[3]) {
    const targetMonthName = fromToMatch[3].toLowerCase();
    const monthIndex = MONTH_NAMES.indexOf(targetMonthName as (typeof MONTH_NAMES)[number]);
    if (monthIndex >= 0) {
      const fallbackYear = inferReferenceYear(endTimeUtc);
      const explicitYear = fromToMatch[4] ? Number.parseInt(fromToMatch[4], 10) : undefined;
      const year = explicitYear ?? inferYearForMonth(monthIndex, fallbackYear.year, fallbackYear.monthIndex);
      return {
        granularity: "month",
        label: `${capitalize(targetMonthName)} ${year}`,
        year,
        monthIndex
      };
    }
  }

  const quarterMatch = lowered.match(/\bq([1-4])(?:\s+(20\d{2}))?\b/i);
  if (quarterMatch?.[1]) {
    const quarter = Number.parseInt(quarterMatch[1], 10);
    const monthIndex = (quarter - 1) * 3;
    const fallbackYear = inferReferenceYear(endTimeUtc);
    const year = quarterMatch[2]
      ? Number.parseInt(quarterMatch[2], 10)
      : inferQuarterYear(quarter, fallbackYear.year, fallbackYear.monthIndex);
    return {
      granularity: "quarter",
      label: `Q${quarter} ${year}`,
      year,
      monthIndex
    };
  }

  const monthPattern = new RegExp(`\\b(${MONTH_NAMES.join("|")})\\b(?:\\s+(20\\d{2}))?`, "i");
  const match = lowered.match(monthPattern);

  if (!match?.[1]) {
    return null;
  }

  const monthName = match[1].toLowerCase();
  const monthIndex = MONTH_NAMES.indexOf(monthName as (typeof MONTH_NAMES)[number]);
  if (monthIndex < 0) {
    return null;
  }

  const fallbackYear = inferReferenceYear(endTimeUtc);
  const year = match[2]
    ? Number.parseInt(match[2], 10)
    : inferYearForMonth(monthIndex, fallbackYear.year, fallbackYear.monthIndex);

  return {
    granularity: "month",
    label: `${capitalize(monthName)} ${year}`,
    year,
    monthIndex
  };
}

function parseMacroThreshold(text: string): MacroThreshold | null {
  const normalized = text.replace(/,/g, "");
  const valuePattern = "(-?\\d+(?:\\.\\d+)?(?:[kmb])?)";

  const betweenMatch = normalized.match(new RegExp(`\\bbetween\\s+\\$?${valuePattern}%?\\s+(?:and|to)\\s+\\$?${valuePattern}%?`, "i"));
  if (betweenMatch?.[1] && betweenMatch[2]) {
    const min = parseMetricNumber(betweenMatch[1]);
    const max = parseMetricNumber(betweenMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return {
        kind: "between",
        min,
        max,
        upperInclusive: false
      };
    }
  }

  const aboveEqMatch = normalized.match(new RegExp(`\\b(?:at\\s+or\\s+above|greater than or equal to|more than or equal to|>=)\\s+\\$?${valuePattern}%?`, "i"));
  if (aboveEqMatch?.[1]) {
    const threshold = parseMetricNumber(aboveEqMatch[1]);
    if (Number.isFinite(threshold)) {
      return {
        kind: "above",
        threshold,
        inclusive: true
      };
    }
  }

  const leadingValueAboveMatch = normalized.match(new RegExp(`\\b${valuePattern}%?\\s+or\\s+(?:more|higher)\\b`, "i"));
  if (leadingValueAboveMatch?.[1]) {
    const threshold = parseMetricNumber(leadingValueAboveMatch[1]);
    if (Number.isFinite(threshold)) {
      return {
        kind: "above",
        threshold,
        inclusive: true
      };
    }
  }

  const aboveMatch = normalized.match(new RegExp(`\\b(above|over|greater than|more than|at least)\\s+\\$?${valuePattern}%?`, "i"));
  if (aboveMatch?.[1] && aboveMatch[2]) {
    const threshold = parseMetricNumber(aboveMatch[2]);
    if (Number.isFinite(threshold)) {
      return {
        kind: "above",
        threshold,
        inclusive: /at least/i.test(aboveMatch[1])
      };
    }
  }

  const belowEqMatch = normalized.match(new RegExp(`\\b(?:at\\s+or\\s+below|less than or equal to|<=)\\s+\\$?${valuePattern}%?`, "i"));
  if (belowEqMatch?.[1]) {
    const threshold = parseMetricNumber(belowEqMatch[1]);
    if (Number.isFinite(threshold)) {
      return {
        kind: "below",
        threshold,
        inclusive: true
      };
    }
  }

  const leadingValueBelowMatch = normalized.match(new RegExp(`\\b${valuePattern}%?\\s+or\\s+(?:less|lower)\\b`, "i"));
  if (leadingValueBelowMatch?.[1]) {
    const threshold = parseMetricNumber(leadingValueBelowMatch[1]);
    if (Number.isFinite(threshold)) {
      return {
        kind: "below",
        threshold,
        inclusive: true
      };
    }
  }

  const belowMatch = normalized.match(new RegExp(`\\b(below|under|less than|at most)\\s+\\$?${valuePattern}%?`, "i"));
  if (belowMatch?.[1] && belowMatch[2]) {
    const threshold = parseMetricNumber(belowMatch[2]);
    if (Number.isFinite(threshold)) {
      return {
        kind: "below",
        threshold,
        inclusive: /at most/i.test(belowMatch[1])
      };
    }
  }

  return null;
}

function findObservationForTargetPeriod(
  observations: Array<{ date: string; value: number }>,
  target: ParsedTargetPeriod
): { date: string; value: number } | undefined {
  return observations.find((candidate) => {
    const date = new Date(candidate.date);
    if (target.granularity === "date") {
      return (
        !Number.isNaN(date.getTime()) &&
        date.getUTCFullYear() === target.year &&
        date.getUTCMonth() === target.monthIndex &&
        date.getUTCDate() === target.day
      );
    }

    return (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === target.year &&
      date.getUTCMonth() === target.monthIndex
    );
  });
}

function evaluateMacroThreshold(value: number, threshold: MacroThreshold): boolean {
  switch (threshold.kind) {
    case "between":
      return value >= threshold.min && (threshold.upperInclusive ? value <= threshold.max : value < threshold.max);
    case "above":
      return threshold.inclusive ? value >= threshold.threshold : value > threshold.threshold;
    case "below":
      return threshold.inclusive ? value <= threshold.threshold : value < threshold.threshold;
  }
}

function formatThresholdLabel(threshold: MacroThreshold): string {
  switch (threshold.kind) {
    case "between":
      return `between ${threshold.min} and ${threshold.max}`;
    case "above":
      return threshold.inclusive ? `at least ${threshold.threshold}` : `above ${threshold.threshold}`;
    case "below":
      return threshold.inclusive ? `at most ${threshold.threshold}` : `below ${threshold.threshold}`;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseMetricNumber(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  const suffix = trimmed.slice(-1);
  const base = Number.parseFloat(trimmed.replace(/[kmb]$/i, ""));
  if (!Number.isFinite(base)) {
    return Number.NaN;
  }

  if (suffix === "k") {
    return base * 1_000;
  }

  if (suffix === "m") {
    return base * 1_000_000;
  }

  if (suffix === "b") {
    return base * 1_000_000_000;
  }

  return base;
}

function mergeObservations(
  latestWindow: { observations: Array<{ date: string; value: string }> },
  targetedWindow: { observations: Array<{ date: string; value: string }> } | null
): Array<{ date: string; value: string }> {
  const merged = new Map<string, { date: string; value: string }>();

  for (const item of [...latestWindow.observations, ...(targetedWindow?.observations ?? [])]) {
    if (!merged.has(item.date)) {
      merged.set(item.date, item);
    }
  }

  return [...merged.values()].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

function buildTargetObservationWindow(
  targetPeriod: ParsedTargetPeriod,
  transform: MacroOfficialContext["transform"]
): { observationStart: string; observationEnd: string; limit: number } {
  if (targetPeriod.granularity === "date" && targetPeriod.day != null) {
    const targetDate = new Date(Date.UTC(targetPeriod.year, targetPeriod.monthIndex, targetPeriod.day));
    const start = new Date(targetDate.getTime() - 35 * 24 * 60 * 60 * 1000);
    const end = new Date(targetDate.getTime() + 8 * 24 * 60 * 60 * 1000);
    return {
      observationStart: toIsoDateOnly(start),
      observationEnd: toIsoDateOnly(end),
      limit: 12
    };
  }

  const startOffsetMonths = transform === "yoy_pct" ? -12 : transform === "mom_pct" ? -1 : 0;
  const start = new Date(Date.UTC(targetPeriod.year, targetPeriod.monthIndex + startOffsetMonths, 1));
  const end = new Date(
    Date.UTC(
      targetPeriod.year,
      targetPeriod.monthIndex + (transform === "yoy_pct" ? 2 : 1),
      1
    )
  );

  return {
    observationStart: toIsoDateOnly(start),
    observationEnd: toIsoDateOnly(end),
    limit: transform === "yoy_pct" ? 18 : 8
  };
}

function toIsoDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferReferenceYear(endTimeUtc: string): { year: number; monthIndex: number } {
  const deadline = new Date(endTimeUtc);
  return Number.isNaN(deadline.getTime())
    ? { year: new Date().getUTCFullYear(), monthIndex: new Date().getUTCMonth() }
    : { year: deadline.getUTCFullYear(), monthIndex: deadline.getUTCMonth() };
}

function inferYearForMonth(monthIndex: number, referenceYear: number, referenceMonthIndex: number): number {
  return monthIndex > referenceMonthIndex ? referenceYear - 1 : referenceYear;
}

function inferQuarterYear(quarter: number, referenceYear: number, referenceMonthIndex: number): number {
  const quarterStartMonth = (quarter - 1) * 3;
  return quarterStartMonth > referenceMonthIndex ? referenceYear - 1 : referenceYear;
}

function estimateReleaseAt(seriesId: string, targetPeriod: ParsedTargetPeriod): number | null {
  const year = targetPeriod.year;
  const monthIndex = targetPeriod.monthIndex;

  switch (seriesId) {
    case "CPIAUCSL":
    case "CPILFESL": {
      const next = nextMonthYear(year, monthIndex);
      return Date.UTC(next.year, next.monthIndex, 15, 15, 0, 0);
    }
    case "PCEPI":
    case "PCEPILFE": {
      const next = nextMonthYear(year, monthIndex);
      const lastDay = new Date(Date.UTC(next.year, next.monthIndex + 1, 0, 15, 0, 0));
      return lastDay.getTime();
    }
    case "UNRATE":
    case "PAYEMS": {
      const next = nextMonthYear(year, monthIndex);
      return Date.UTC(next.year, next.monthIndex, 8, 15, 0, 0);
    }
    case "FEDFUNDS": {
      const next = nextMonthYear(year, monthIndex);
      return Date.UTC(next.year, next.monthIndex, 15, 15, 0, 0);
    }
    case "ICSA": {
      if (targetPeriod.granularity !== "date" || targetPeriod.day == null) {
        return null;
      }
      const releaseDate = new Date(Date.UTC(year, monthIndex, targetPeriod.day));
      releaseDate.setUTCDate(releaseDate.getUTCDate() + 5);
      releaseDate.setUTCHours(12, 30, 0, 0);
      return releaseDate.getTime();
    }
    case "GDPC1": {
      const quarterEndMonth = Math.floor(monthIndex / 3) * 3 + 2;
      const nextMonth = nextMonthYear(year, quarterEndMonth);
      return Date.UTC(nextMonth.year, nextMonth.monthIndex, 30, 15, 0, 0);
    }
    case "A191RL1Q225SBEA": {
      const quarterEndMonth = Math.floor(monthIndex / 3) * 3 + 2;
      const nextMonth = nextMonthYear(year, quarterEndMonth);
      return Date.UTC(nextMonth.year, nextMonth.monthIndex, 30, 15, 0, 0);
    }
    default:
      return null;
  }
}

function nextMonthYear(year: number, monthIndex: number): { year: number; monthIndex: number } {
  if (monthIndex === 11) {
    return { year: year + 1, monthIndex: 0 };
  }

  return { year, monthIndex: monthIndex + 1 };
}

function findComparisonObservation(
  observations: Array<{ date: string; value: number }>,
  latestDate: string,
  transform: MacroOfficialContext["transform"],
  frequency: string | undefined
): { date: string; value: number } | undefined {
  if (transform === "level") {
    return findPreviousObservation(observations, latestDate);
  }

  if (transform === "mom_pct") {
    return findPreviousObservation(observations, latestDate);
  }

  const latest = new Date(latestDate);
  if (Number.isNaN(latest.getTime())) {
    return observations.find((_, index) => index >= 4);
  }

  const normalizedFrequency = (frequency ?? "").toLowerCase();

  if (normalizedFrequency.includes("quarter")) {
    const exact = observations.find((candidate) => {
      const date = new Date(candidate.date);
      return (
        !Number.isNaN(date.getTime()) &&
        date.getUTCFullYear() === latest.getUTCFullYear() - 1 &&
        date.getUTCMonth() === latest.getUTCMonth()
      );
    });
    return exact ?? observations[4];
  }

  if (normalizedFrequency.includes("year") || normalizedFrequency.includes("annual")) {
    const exact = observations.find((candidate) => {
      const date = new Date(candidate.date);
      return (
        !Number.isNaN(date.getTime()) &&
        date.getUTCFullYear() === latest.getUTCFullYear() - 1
      );
    });
    return exact ?? observations[1];
  }

  const exact = observations.find((candidate) => {
    const date = new Date(candidate.date);
    return (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === latest.getUTCFullYear() - 1 &&
      date.getUTCMonth() === latest.getUTCMonth()
    );
  });
  return exact ?? observations[12];
}

function findPreviousObservation(
  observations: Array<{ date: string; value: number }>,
  referenceDate: string
): { date: string; value: number } | undefined {
  const referenceTs = Date.parse(referenceDate);
  if (Number.isNaN(referenceTs)) {
    return undefined;
  }

  return observations
    .filter((candidate) => {
      const ts = Date.parse(candidate.date);
      return !Number.isNaN(ts) && ts < referenceTs;
    })
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0];
}
