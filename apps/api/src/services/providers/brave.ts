import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, ensureProviderKey, fetchWithRetry, isoDateOrUndefined, PROVIDER_RETRIEVAL_PRICE_USD } from "./shared.js";

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  extra_snippets?: string[];
};

export async function runBraveSearch(query: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("brave", env.BRAVE_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: "brave-search",
      query,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));
    url.searchParams.set("extra_snippets", "true");

    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": env.BRAVE_API_KEY
      }
    });

    const payload = (await response.json()) as {
      error?: { detail?: string };
      web?: { results?: BraveWebResult[] };
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: "brave-search",
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.error?.detail ?? `brave request failed with HTTP ${response.status}`
      });
    }

    const results = (payload.web?.results ?? []).slice(0, maxResults).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: clipText(result.extra_snippets?.[0] ?? result.description),
      publishedAt: isoDateOrUndefined(result.age),
      source: "brave"
    }));

    return buildSuccessRun({
      provider: "brave-search",
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: PROVIDER_RETRIEVAL_PRICE_USD.brave,
      httpStatus: response.status,
      results
    });
  } catch (error) {
    return buildErrorRun({
      provider: "brave-search",
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown brave error"
    });
  }
}
