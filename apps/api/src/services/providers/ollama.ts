import { type ProviderSearchRun } from "@polymarket/deep-research-contracts";

import { env } from "../../config.js";
import { buildErrorRun, buildSuccessRun, clipText, fetchWithRetry } from "./shared.js";

type OllamaGenerateResponse = {
  response?: string;
  done?: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
};

type OllamaTag = {
  name?: string;
  model?: string;
};

type OllamaTagsResponse = {
  models?: OllamaTag[];
};

export type OllamaTaskResult = {
  ok: boolean;
  responseText: string;
  durationMs: number;
  httpStatus?: number;
  error?: string;
  model: string;
  meta: Record<string, unknown>;
};

export async function runOllamaChat(prompt: string, maxResults: number): Promise<ProviderSearchRun> {
  const task = await runOllamaGenerateTask(prompt, {
    model: env.OLLAMA_MODEL_PRIMARY
  });

  if (!task.ok) {
    return buildErrorRun({
      provider: "ollama-chat-primary",
      query: prompt,
      durationMs: task.durationMs,
      httpStatus: task.httpStatus,
      error: task.error ?? "ollama task failed"
    });
  }

  return buildSuccessRun({
    provider: "ollama-chat-primary",
    query: prompt,
    durationMs: task.durationMs,
    resultCount: 0,
    estimatedRetrievalCostUsd: 0,
    httpStatus: task.httpStatus,
    results: [],
    meta: {
      answer: clipText(task.responseText, 2000),
      model: task.model,
      maxResults,
      ...task.meta
    }
  });
}

export async function checkOllamaAvailability(): Promise<boolean> {
  try {
    const response = await fetchWithRetry(new URL("tags", withTrailingSlash(env.OLLAMA_BASE_URL)), {
      headers: {
        Accept: "application/json"
      }
    }, {
      maxAttempts: 1
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    return (payload.models ?? []).some((model) => model.name === env.OLLAMA_MODEL_PRIMARY || model.model === env.OLLAMA_MODEL_PRIMARY);
  } catch {
    return false;
  }
}

export async function runOllamaGenerateTask(
  prompt: string,
  options?: {
    model?: string;
    format?: "json" | Record<string, unknown>;
    temperature?: number;
    timeoutMs?: number;
  }
): Promise<OllamaTaskResult> {
  const startedAt = Date.now();
  const model = options?.model ?? env.OLLAMA_MODEL_PRIMARY;

  try {
    const response = await fetchWithRetry(new URL("generate", withTrailingSlash(env.OLLAMA_BASE_URL)), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: options?.format ?? "json",
        options: {
          temperature: options?.temperature ?? 0.2
        }
      })
    }, {
      maxAttempts: 1,
      timeoutMs: options?.timeoutMs ?? 12000
    });

    const payload = (await response.json()) as OllamaGenerateResponse & { error?: string };

    if (!response.ok) {
      return {
        ok: false,
        responseText: "",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        error: payload.error ?? `ollama request failed with HTTP ${response.status}`,
        model,
        meta: {}
      };
    }

    return {
      ok: true,
      responseText: payload.response ?? "",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model,
      meta: {
        totalDurationNs: payload.total_duration ?? null,
        promptEvalCount: payload.prompt_eval_count ?? null,
        evalCount: payload.eval_count ?? null
      }
    };
  } catch (error) {
    return {
      ok: false,
      responseText: "",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown ollama error",
      model,
      meta: {}
    };
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
