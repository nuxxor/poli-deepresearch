import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, ensureProviderKey, fetchWithRetry } from "./shared.js";

type XaiAnnotation = {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
};

type XaiContentItem = {
  type?: string;
  text?: string;
  annotations?: XaiAnnotation[];
};

type XaiOutputItem = {
  type?: string;
  action?: {
    query?: string;
    sources?: unknown[];
  };
  content?: XaiContentItem[];
};

type XaiUsage = {
  cost_in_usd_ticks?: number;
  server_side_tool_usage_details?: {
    web_search_calls?: number;
    x_search_calls?: number;
  };
};

/**
 * xAI annotation start_index/end_index point into the *model's response text*,
 * not into source page content. When the model emits a structured opinion JSON
 * (which is the common path for us), slicing around the index produces JSON
 * markup like `**JSON Output:** ```json {"resolutionStatus": ...}` instead of
 * the actual source page excerpt. Detect that case so we can drop the snippet
 * rather than show garbage. The URL + title still carry full citation value.
 */
function looksLikeStructuredOpinion(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  if (/```\s*json/i.test(text)) {
    return true;
  }
  if (/"resolutionStatus"\s*:/i.test(text)) {
    return true;
  }
  if (/"yesCase"\s*:/i.test(text) || /"noCase"\s*:/i.test(text)) {
    return true;
  }
  return false;
}

export async function runXaiWebSearch(query: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("xai", env.XAI_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: "xai-web-search",
      query,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const response = await fetchWithRetry("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "grok-4.20-reasoning",
        input: [
          {
            role: "user",
            content: `Find the freshest official or tier-1 sources for this Polymarket research topic: ${query}. Return a short answer with citations.`
          }
        ],
        tools: [
          {
            type: "web_search"
          }
        ]
      })
    }, {
      maxAttempts: 1,
      timeoutMs: 60000
    });

    const payload = (await response.json()) as {
      error?: { message?: string } | string;
      usage?: XaiUsage;
      output?: XaiOutputItem[];
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: "xai-web-search",
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error:
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message ?? `xai request failed with HTTP ${response.status}`
      });
    }

    const messageItems = (payload.output ?? []).filter((item) => item.type === "message");
    const outputTexts = messageItems.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text");
    const combinedText = outputTexts.map((item) => item.text ?? "").join("\n");

    const citations = new Map<string, { title?: string; snippet?: string }>();

    for (const item of outputTexts) {
      const contaminated = looksLikeStructuredOpinion(item.text);
      for (const annotation of item.annotations ?? []) {
        if (annotation.type !== "url_citation" || !annotation.url) {
          continue;
        }

        let snippet: string | undefined;
        if (!contaminated) {
          const start = Math.max(0, (annotation.start_index ?? 0) - 120);
          const end = Math.min((item.text ?? "").length, (annotation.end_index ?? 0) + 120);
          snippet = clipText(item.text?.slice(start, end));
        }

        citations.set(annotation.url, {
          title: annotation.title,
          snippet
        });
      }
    }

    const results = [...citations.entries()].slice(0, maxResults).map(([url, value]) => ({
      title: value.title,
      url,
      snippet: value.snippet,
      source: "xai"
    }));

    const webSearchCalls = payload.usage?.server_side_tool_usage_details?.web_search_calls ?? 0;
    const totalCostUsd =
      payload.usage?.cost_in_usd_ticks != null
        ? payload.usage.cost_in_usd_ticks / 10_000_000_000
        : webSearchCalls * 0.005;

    return buildSuccessRun({
      provider: "xai-web-search",
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: totalCostUsd,
      httpStatus: response.status,
      results,
      meta: {
        summary: clipText(combinedText, 16000),
        toolCalls: (payload.output ?? [])
          .filter((item) => item.type === "web_search_call")
          .map((item) => item.action?.query)
          .filter(Boolean),
        usage: payload.usage ?? null
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: "xai-web-search",
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown xai error"
    });
  }
}
