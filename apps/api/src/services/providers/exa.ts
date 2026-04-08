import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, ensureProviderKey, fetchWithRetry, isoDateOrUndefined, PROVIDER_RETRIEVAL_PRICE_USD } from "./shared.js";

type ExaResult = {
  title?: string;
  url?: string;
  text?: string;
  snippet?: string;
  publishedDate?: string;
};

type ExaCitation = {
  title?: string;
  url?: string;
  snippet?: string;
  publishedDate?: string;
  text?: string;
};

type ExaResearchModel = "exa-research-fast" | "exa-research" | "exa-research-pro";

type ExaResearchTask = {
  researchId: string;
  status: "pending" | "running" | "completed" | "canceled" | "failed";
  output?: {
    content?: string;
  };
  citations?: ExaCitation[];
  costDollars?: {
    total?: number;
    numPages?: number;
    numSearches?: number;
    reasoningTokens?: number;
  };
  error?: string;
};

export async function runExaSearch(
  query: string,
  maxResults: number,
  mode: "exa-search" | "exa-deep-search" = "exa-search"
): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("exa", env.EXA_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: mode,
      query,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const response = await fetchWithRetry("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.EXA_API_KEY
      },
      body: JSON.stringify({
        query,
        numResults: maxResults,
        text: true,
        type: mode === "exa-deep-search" ? "deep" : "auto"
      })
    });

    const payload = (await response.json()) as {
      error?: string;
      results?: ExaResult[];
      costDollars?: { total?: number };
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: mode,
        query,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.error ?? `exa request failed with HTTP ${response.status}`
      });
    }

    const results = (payload.results ?? []).slice(0, maxResults).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: clipText(result.text ?? result.snippet),
      publishedAt: isoDateOrUndefined(result.publishedDate),
      source: "exa"
    }));

    return buildSuccessRun({
      provider: mode,
      query,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd:
        payload.costDollars?.total ??
        (mode === "exa-deep-search" ? 0.012 : PROVIDER_RETRIEVAL_PRICE_USD.exa),
      httpStatus: response.status,
      results,
      meta: {
        costDollars: payload.costDollars ?? null,
        mode
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: mode,
      query,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown exa error"
    });
  }
}

export async function runExaAnswer(prompt: string, maxResults: number): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("exa", env.EXA_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: "exa-answer",
      query: prompt,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const response = await fetchWithRetry("https://api.exa.ai/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.EXA_API_KEY
      },
      body: JSON.stringify({
        query: prompt,
        text: true
      })
    });

    const payload = (await response.json()) as {
      error?: string;
      answer?: string;
      citations?: ExaCitation[];
      costDollars?: { total?: number };
    };

    if (!response.ok) {
      return buildErrorRun({
        provider: "exa-answer",
        query: prompt,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.error ?? `exa answer request failed with HTTP ${response.status}`
      });
    }

    const results = (payload.citations ?? []).slice(0, maxResults).map((citation) => ({
      title: citation.title,
      url: citation.url,
      snippet: clipText(citation.snippet ?? citation.text),
      publishedAt: isoDateOrUndefined(citation.publishedDate),
      source: "exa"
    }));

    return buildSuccessRun({
      provider: "exa-answer",
      query: prompt,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: payload.costDollars?.total ?? 0.005,
      httpStatus: response.status,
      results,
      meta: {
        answer: clipText(payload.answer, 1500),
        costDollars: payload.costDollars ?? null
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: "exa-answer",
      query: prompt,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown exa answer error"
    });
  }
}

export async function runExaResearch(
  prompt: string,
  maxResults: number,
  model: ExaResearchModel
): Promise<ProviderSearchRun> {
  const startedAt = Date.now();
  const missing = ensureProviderKey("exa", env.EXA_API_KEY);

  if (missing) {
    return buildErrorRun({
      provider: model,
      query: prompt,
      durationMs: Date.now() - startedAt,
      error: missing
    });
  }

  try {
    const createResponse = await fetchWithRetry("https://api.exa.ai/research/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.EXA_API_KEY
      },
      body: JSON.stringify({
        instructions: prompt,
        model
      })
    });

    const createPayload = (await createResponse.json()) as ExaResearchTask;

    if (!createResponse.ok || !createPayload.researchId) {
      return buildErrorRun({
        provider: model,
        query: prompt,
        durationMs: Date.now() - startedAt,
        httpStatus: createResponse.status,
        error: createPayload.error ?? `exa research create failed with HTTP ${createResponse.status}`
      });
    }

    const completedTask = await pollExaResearchTask(createPayload.researchId);

    if (completedTask.status !== "completed") {
      return buildErrorRun({
        provider: model,
        query: prompt,
        durationMs: Date.now() - startedAt,
        error: completedTask.error ?? `exa research finished with status ${completedTask.status}`
      });
    }

    const results = (completedTask.citations ?? []).slice(0, maxResults).map((citation) => ({
      title: citation.title,
      url: citation.url,
      snippet: clipText(citation.snippet ?? citation.text),
      publishedAt: isoDateOrUndefined(citation.publishedDate),
      source: "exa"
    }));

    return buildSuccessRun({
      provider: model,
      query: prompt,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      estimatedRetrievalCostUsd: completedTask.costDollars?.total,
      results,
      meta: {
        answer: clipText(completedTask.output?.content, 2000),
        costDollars: completedTask.costDollars ?? null,
        researchId: completedTask.researchId
      }
    });
  } catch (error) {
    return buildErrorRun({
      provider: model,
      query: prompt,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown exa research error"
    });
  }
}

async function pollExaResearchTask(researchId: string): Promise<ExaResearchTask> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetchWithRetry(`https://api.exa.ai/research/v1/${researchId}`, {
      headers: {
        "x-api-key": env.EXA_API_KEY
      }
    });

    const payload = (await response.json()) as ExaResearchTask;

    if (!response.ok) {
      throw new Error(payload.error ?? `exa research poll failed with HTTP ${response.status}`);
    }

    if (payload.status === "completed" || payload.status === "failed" || payload.status === "canceled") {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return {
    researchId,
    status: "failed",
    error: "exa research poll timed out"
  };
}
