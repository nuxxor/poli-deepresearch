import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText } from "./shared.js";

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

const GDELT_MIN_INTERVAL_MS = 5500;
const GDELT_RETRY_DELAY_MS = 6000;

let gdeltQueue: Promise<void> = Promise.resolve();
let gdeltNextAllowedAt = 0;

export async function runGdeltDocSearch(query: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const waitMs = await waitForGdeltSlot();

  try {
    const url = new URL(env.GDELT_DOC_API_BASE);
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "ArtList");
    url.searchParams.set("maxrecords", String(Math.min(Math.max(maxResults, 1), 10)));
    url.searchParams.set("timespan", "7d");
    url.searchParams.set("sort", "DateDesc");
    url.searchParams.set("format", "json");

    let response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

    let rawText = await response.text();
    let retried = false;

    if (response.status === 429) {
      retried = true;
      gdeltNextAllowedAt = Math.max(gdeltNextAllowedAt, Date.now() + GDELT_RETRY_DELAY_MS);
      await sleep(GDELT_RETRY_DELAY_MS);
      response = await fetch(url, {
        headers: {
          accept: "application/json"
        }
      });
      rawText = await response.text();
    }

    if (!response.ok) {
      return buildErrorRun({
        provider: "gdelt",
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: clipText(rawText, 240) ?? `gdelt request failed with HTTP ${response.status}`,
        meta: {
          politeDelayMs: waitMs,
          retried
        }
      });
    }

    const payload = JSON.parse(rawText) as {
      articles?: GdeltArticle[];
    };

    const results = (payload.articles ?? []).slice(0, maxResults).map((article) => ({
      title: article.title,
      url: article.url,
      snippet: clipText(
        [article.domain, article.language, article.sourcecountry].filter(Boolean).join(" | "),
        220
      ),
      publishedAt: gdeltSeenDateToIso(article.seendate),
      source: "gdelt",
      author: article.domain
    }));

    return buildSuccessRun({
      provider: "gdelt",
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      httpStatus: response.status,
      estimatedRetrievalCostUsd: 0,
      results,
      meta: {
        politeDelayMs: waitMs,
        retried
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: "gdelt",
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown gdelt error",
      meta: {
        politeDelayMs: waitMs
      }
    });
  }
}

function gdeltSeenDateToIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
  );

  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
}

async function waitForGdeltSlot(): Promise<number> {
  const previous = gdeltQueue;
  let release!: () => void;
  gdeltQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;

  const now = Date.now();
  const waitMs = Math.max(0, gdeltNextAllowedAt - now);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  gdeltNextAllowedAt = Date.now() + GDELT_MIN_INTERVAL_MS;
  release();
  return waitMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
