import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, ensureProviderKey, fetchWithRetry, isoDateOrUndefined, PROVIDER_RETRIEVAL_PRICE_USD } from "./shared.js";

type ParallelResult = {
  title?: string;
  url?: string;
  publish_date?: string;
  excerpts?: string[];
};

type ParallelBasisCitation = {
  title?: string;
  url?: string;
  excerpts?: string[];
};

type ParallelBasis = {
  citations?: ParallelBasisCitation[];
  reasoning?: string;
  confidence?: string;
};

type ParallelChatOptions = {
  responseFormat?: "opinion_json";
};

const OPINION_CASE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "bullets"],
  properties: {
    headline: { type: "string" },
    bullets: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "citationUrls"],
        properties: {
          text: { type: "string" },
          citationUrls: {
            type: "array",
            items: { type: "string" },
            maxItems: 4
          }
        }
      }
    }
  }
} as const;

const PARALLEL_OPINION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "polymarket_opinion",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "resolutionStatus",
        "resolutionConfidence",
        "lean",
        "leanConfidence",
        "yesCase",
        "noCase",
        "historicalContext",
        "whatToWatch",
        "modelTake",
        "why"
      ],
      properties: {
        resolutionStatus: {
          type: "string",
          enum: ["NOT_YET_RESOLVED", "RESOLVED_YES", "RESOLVED_NO"]
        },
        resolutionConfidence: { type: "number", minimum: 0, maximum: 1 },
        lean: {
          type: "string",
          enum: ["STRONG_NO", "LEAN_NO", "TOSSUP", "LEAN_YES", "STRONG_YES"]
        },
        leanConfidence: { type: "number", minimum: 0, maximum: 1 },
        yesCase: OPINION_CASE_SCHEMA,
        noCase: OPINION_CASE_SCHEMA,
        historicalContext: {
          type: "object",
          additionalProperties: false,
          required: ["narrative", "priors"],
          properties: {
            narrative: { type: "string" },
            priors: {
              type: "array",
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "detail"],
                properties: {
                  label: { type: "string" },
                  detail: { type: "string" }
                }
              }
            }
          }
        },
        whatToWatch: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string" }
        },
        modelTake: { type: "string" },
        nextCheckAt: { type: "string" },
        why: { type: "string" }
      }
    }
  }
} as const;

export async function runParallelSearch(query: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("parallel", env.PARALLEL_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: "parallel-search",
      query,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const response = await fetchWithRetry("https://api.parallel.ai/v1beta/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.PARALLEL_API_KEY
      },
      body: JSON.stringify({
        objective: `Find fresh official or tier-1 sources for: ${query}`,
        search_queries: [query],
        mode: "fast",
        max_results: maxResults,
        excerpts: {
          max_chars_per_result: 1200
        }
      })
    }, {
      maxAttempts: 1,
      timeoutMs: 12000
    });

    const payload = (await response.json()) as {
      errors?: string[];
      warnings?: string[] | null;
      usage?: Array<{ name: string; count: number }>;
      search_id?: string;
      results?: ParallelResult[];
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: "parallel-search",
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.errors?.join("; ") ?? `parallel request failed with HTTP ${response.status}`
      });
    }

    const results = (payload.results ?? []).slice(0, maxResults).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: clipText(result.excerpts?.[0]),
      publishedAt: isoDateOrUndefined(result.publish_date),
      source: "parallel"
    }));

    return buildSuccessRun({
      provider: "parallel-search",
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: PROVIDER_RETRIEVAL_PRICE_USD.parallel,
      httpStatus: response.status,
      results,
      meta: {
        searchId: payload.search_id ?? null,
        usage: payload.usage ?? [],
        warnings: payload.warnings ?? []
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: "parallel-search",
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown parallel error"
    });
  }
}

export async function runParallelChat(
  prompt: string,
  maxResults: number,
  model: "base" | "core",
  options?: ParallelChatOptions
): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("parallel", env.PARALLEL_API_KEY);
  const provider = model === "base" ? "parallel-chat-base" : "parallel-chat-core";

  if (missing) {
    return buildErrorRun({
      provider,
      query: prompt,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const response = await fetchWithRetry("https://api.parallel.ai/v1beta/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.PARALLEL_API_KEY
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        stream: false,
        ...(options?.responseFormat === "opinion_json"
          ? {
              response_format: PARALLEL_OPINION_RESPONSE_FORMAT
            }
          : {})
      })
    }, {
      maxAttempts: 1,
      timeoutMs: 150000
    });

    const payload = (await response.json()) as {
      error?: { message?: string } | string;
      choices?: Array<{ message?: { content?: string } }>;
      basis?: ParallelBasis[];
    };

    if (!response.ok) {
      return buildErrorRun({
        provider,
        query: prompt,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error:
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message ?? `parallel chat request failed with HTTP ${response.status}`
      });
    }

    const message = payload.choices?.[0]?.message?.content;
    const citations = (payload.basis ?? []).flatMap((entry) => entry.citations ?? []);
    const results = citations.slice(0, maxResults).map((citation) => ({
      title: citation.title,
      url: citation.url,
      snippet: clipText(citation.excerpts?.[0]),
      source: "parallel"
    }));

    return buildSuccessRun({
      provider,
      query: prompt,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: model === "base" ? 0.01 : 0.025,
      httpStatus: response.status,
      results,
      meta: {
        answer: clipText(message, 16000),
        basis: payload.basis ?? []
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider,
      query: prompt,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown parallel chat error"
    });
  }
}
