import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, ensureProviderKey, fetchWithRetry, isoDateOrUndefined } from "./shared.js";

type TwitterApiTweet = {
  url?: string;
  twitterUrl?: string;
  text?: string;
  createdAt?: string;
  author?: {
    userName?: string;
    name?: string;
  };
};

export async function runTwitterApiSearch(query: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("twitterapi", env.TWITTERAPI_KEY);

  if (missing) {
    return buildErrorRun({
      provider: "twitterapi",
      query,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
    url.searchParams.set("query", query);
    url.searchParams.set("queryType", "Latest");

    const response = await fetchWithRetry(url, {
      headers: {
        "x-api-key": env.TWITTERAPI_KEY
      }
    });

    const payload = (await response.json()) as {
      message?: string;
      has_next_page?: boolean;
      next_cursor?: string;
      tweets?: TwitterApiTweet[];
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: "twitterapi",
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.message ?? `twitterapi request failed with HTTP ${response.status}`
      });
    }

    const results = (payload.tweets ?? []).slice(0, maxResults).map((tweet) => ({
      title: tweet.author?.userName ? `@${tweet.author.userName}` : tweet.author?.name,
      url: tweet.url ?? tweet.twitterUrl,
      snippet: clipText(tweet.text),
      publishedAt: isoDateOrUndefined(tweet.createdAt),
      source: "twitterapi",
      author: tweet.author?.userName ?? tweet.author?.name
    }));

    return buildSuccessRun({
      provider: "twitterapi",
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      httpStatus: response.status,
      results,
      meta: {
        hasNextPage: payload.has_next_page ?? false,
        nextCursor: payload.next_cursor ?? null
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: "twitterapi",
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown twitterapi error"
    });
  }
}
