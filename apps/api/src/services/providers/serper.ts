import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, ensureProviderKey, fetchWithRetry, isoDateOrUndefined, PROVIDER_RETRIEVAL_PRICE_USD } from "./shared.js";

type SerperOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

export async function runSerperSearch(query: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("serper", env.SERPER_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: "serper-search",
      query,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const response = await fetchWithRetry("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": env.SERPER_API_KEY
      },
      body: JSON.stringify({
        q: query,
        num: maxResults,
        gl: "us",
        hl: "en"
      })
    });

    const payload = (await response.json()) as {
      message?: string;
      organic?: SerperOrganicResult[];
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: "serper-search",
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.message ?? `serper request failed with HTTP ${response.status}`
      });
    }

    const results = (payload.organic ?? []).slice(0, maxResults).map((result) => ({
      title: result.title,
      url: result.link,
      snippet: clipText(result.snippet),
      publishedAt: isoDateOrUndefined(result.date),
      source: "serper"
    }));

    return buildSuccessRun({
      provider: "serper-search",
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: PROVIDER_RETRIEVAL_PRICE_USD.serper,
      httpStatus: response.status,
      results
    });
  } catch (error) {
    return buildErrorRun({
      provider: "serper-search",
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown serper error"
    });
  }
}
