import {
  FredSeriesLatestResponseSchema,
  FredSeriesSearchResponseSchema,
  type FredSeriesLatestResponse,
  type FredSeriesSearchResponse
} from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { recordProviderHealth } from "../provider-health.js";
import { clipText, ensureProviderKey, fetchWithRetry } from "./shared.js";

type FredSearchSeries = {
  id?: string;
  title?: string;
  units?: string;
  frequency?: string;
  popularity?: number | string;
  observation_start?: string;
  observation_end?: string;
  last_updated?: string;
  notes?: string;
};

type FredSeriesSearchPayload = {
  seriess?: FredSearchSeries[];
};

type FredSeriesMeta = {
  id?: string;
  title?: string;
  units?: string;
  frequency?: string;
  last_updated?: string;
  notes?: string;
};

type FredSeriesMetaPayload = {
  seriess?: FredSeriesMeta[];
};

type FredObservation = {
  date?: string;
  value?: string;
};

type FredObservationsPayload = {
  observations?: FredObservation[];
};

export type FredSeriesWindow = {
  seriesId: string;
  title: string;
  units?: string;
  frequency?: string;
  lastUpdated?: string;
  notes?: string;
  observations: Array<{
    date: string;
    value: string;
  }>;
};

type FredWindowOptions = {
  observationStart?: string;
  observationEnd?: string;
  sortOrder?: "asc" | "desc";
};

export async function searchFredSeries(query: string, limit: number): Promise<FredSeriesSearchResponse> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("fred", env.FRED_API_KEY);

  if (missing) {
    recordProviderHealth({
      provider: "fred",
      ok: false,
      durationMs: Date.now() - startedAt,
      error: missing
    });
    throw new Error(missing);
  }

  try {
    const url = new URL("https://api.stlouisfed.org/fred/series/search");
    url.searchParams.set("api_key", env.FRED_API_KEY);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("search_text", query);
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set("order_by", "search_rank");
    url.searchParams.set("sort_order", "asc");

    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json"
      }
    });
    const payload = (await response.json()) as FredSeriesSearchPayload & { error_message?: string };

    if (!response.ok) {
      recordProviderHealth({
        provider: "fred",
        ok: false,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.error_message ?? `fred search failed with HTTP ${response.status}`
      });
      throw new Error(payload.error_message ?? `fred search failed with HTTP ${response.status}`);
    }

    const parsed = FredSeriesSearchResponseSchema.parse({
      query,
      count: payload.seriess?.length ?? 0,
      items: (payload.seriess ?? []).map((item) => ({
        seriesId: item.id ?? "",
        title: item.title ?? "",
        units: item.units,
        frequency: item.frequency,
        popularity: parseIntMaybe(item.popularity),
        observationStart: item.observation_start,
        observationEnd: item.observation_end,
        lastUpdated: item.last_updated,
        notes: clipText(item.notes, 300)
      }))
    });

    recordProviderHealth({
      provider: "fred",
      ok: true,
      durationMs: Date.now() - startedAt,
      httpStatus: response.status
    });

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown FRED search error");
  }
}

export async function fetchFredSeriesLatest(seriesId: string): Promise<FredSeriesLatestResponse> {
  const window = await fetchFredSeriesWindow(seriesId, 2);
  const current = window.observations[0];
  const previous = window.observations[1];

  if (!current?.date || current.value == null) {
    throw new Error("FRED returned incomplete series data");
  }

  return FredSeriesLatestResponseSchema.parse({
    seriesId,
    title: window.title,
    units: window.units,
    frequency: window.frequency,
    observationDate: current.date,
    observationValue: current.value,
    previousDate: previous?.date,
    previousValue: previous?.value,
    lastUpdated: window.lastUpdated,
    notes: window.notes
  });
}

export async function fetchFredSeriesWindow(
  seriesId: string,
  limit: number,
  options: FredWindowOptions = {}
): Promise<FredSeriesWindow> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("fred", env.FRED_API_KEY);

  if (missing) {
    recordProviderHealth({
      provider: "fred",
      ok: false,
      durationMs: Date.now() - startedAt,
      error: missing
    });
    throw new Error(missing);
  }

  try {
    const safeLimit = Math.min(Math.max(limit, 1), 24);
    const [metaResponse, observationsResponse] = await Promise.all([
      fetchWithRetry(buildFredUrl("series", { series_id: seriesId }), {
        headers: { Accept: "application/json" }
      }),
      fetchWithRetry(buildFredUrl("series/observations", {
        series_id: seriesId,
        sort_order: options.sortOrder ?? "desc",
        ...(options.observationStart ? { observation_start: options.observationStart } : {}),
        ...(options.observationEnd ? { observation_end: options.observationEnd } : {}),
        limit: String(safeLimit)
      }), {
        headers: { Accept: "application/json" }
      })
    ]);

    const metaPayload = (await metaResponse.json()) as FredSeriesMetaPayload & { error_message?: string };
    const observationsPayload = (await observationsResponse.json()) as FredObservationsPayload & { error_message?: string };

    if (!metaResponse.ok) {
      recordProviderHealth({
        provider: "fred",
        ok: false,
        durationMs: Date.now() - startedAt,
        httpStatus: metaResponse.status,
        error: metaPayload.error_message ?? `fred series metadata failed with HTTP ${metaResponse.status}`
      });
      throw new Error(metaPayload.error_message ?? `fred series metadata failed with HTTP ${metaResponse.status}`);
    }

    if (!observationsResponse.ok) {
      recordProviderHealth({
        provider: "fred",
        ok: false,
        durationMs: Date.now() - startedAt,
        httpStatus: observationsResponse.status,
        error: observationsPayload.error_message ?? `fred observations failed with HTTP ${observationsResponse.status}`
      });
      throw new Error(observationsPayload.error_message ?? `fred observations failed with HTTP ${observationsResponse.status}`);
    }

    const meta = metaPayload.seriess?.[0];
    const observations = (observationsPayload.observations ?? []).filter(
      (item): item is { date: string; value: string } =>
        typeof item.date === "string" && item.date.trim() !== "" && typeof item.value === "string" && item.value.trim() !== ""
    );

    if (!meta || observations.length === 0) {
      recordProviderHealth({
        provider: "fred",
        ok: false,
        durationMs: Date.now() - startedAt,
        error: "FRED returned incomplete series data"
      });
      throw new Error("FRED returned incomplete series data");
    }

    const parsed = {
      seriesId,
      title: meta.title ?? seriesId,
      units: meta.units,
      frequency: meta.frequency,
      lastUpdated: meta.last_updated,
      notes: clipText(meta.notes, 400),
      observations
    } satisfies FredSeriesWindow;

    recordProviderHealth({
      provider: "fred",
      ok: true,
      durationMs: Date.now() - startedAt,
      httpStatus: 200
    });

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown FRED latest error");
  }
}

function buildFredUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
  url.searchParams.set("api_key", env.FRED_API_KEY);
  url.searchParams.set("file_type", "json");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function parseIntMaybe(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}
