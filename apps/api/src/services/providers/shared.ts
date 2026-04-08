import {
  ProviderSearchRunSchema,
  type ProviderName,
  type ProviderSearchResultItem,
  type ProviderSearchRun
} from "@polymarket/deep-research-contracts";
import { recordProviderHealth } from "../provider-health.js";
import { dedupeProviderSearchResults } from "../urls.js";

export const PROVIDER_RETRIEVAL_PRICE_USD: Partial<Record<ProviderName, number>> = {
  serper: 0.001,
  brave: 0.005,
  exa: 0.007,
  parallel: 0.005
};

export function clipText(value: string | undefined, maxLength = 320): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function buildSuccessRun(input: {
  provider: string;
  query: string;
  durationMs: number;
  resultCount: number;
  estimatedRetrievalCostUsd?: number;
  httpStatus?: number;
  results: ProviderSearchResultItem[];
  meta?: Record<string, unknown>;
}): ProviderSearchRun {
  const run = ProviderSearchRunSchema.parse({
    provider: input.provider,
    ok: true,
    query: input.query,
    durationMs: input.durationMs,
    resultCount: input.resultCount,
    estimatedRetrievalCostUsd: input.estimatedRetrievalCostUsd,
    httpStatus: input.httpStatus,
    results: dedupeResults(input.results),
    meta: input.meta ?? {}
  });

  recordProviderHealth({
    provider: input.provider,
    ok: true,
    durationMs: run.durationMs,
    httpStatus: run.httpStatus
  });

  return run;
}

export function buildErrorRun(input: {
  provider: string;
  query: string;
  durationMs: number;
  error: string;
  httpStatus?: number;
  meta?: Record<string, unknown>;
}): ProviderSearchRun {
  const run = ProviderSearchRunSchema.parse({
    provider: input.provider,
    ok: false,
    query: input.query,
    durationMs: input.durationMs,
    resultCount: 0,
    httpStatus: input.httpStatus,
    error: input.error,
    results: [],
    meta: input.meta ?? {}
  });

  recordProviderHealth({
    provider: input.provider,
    ok: false,
    durationMs: run.durationMs,
    httpStatus: run.httpStatus,
    error: run.error
  });

  return run;
}

export function ensureProviderKey(provider: ProviderName, value: string): string | null {
  return value.trim() === "" ? `${provider} provider is not configured` : null;
}

export function isoDateOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toISOString();
}

function dedupeResults(results: ProviderSearchResultItem[]): ProviderSearchResultItem[] {
  return dedupeProviderSearchResults(results);
}

type FetchWithRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  retryOnStatuses?: number[];
  timeoutMs?: number;
};

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const baseDelayMs = Math.max(100, options.baseDelayMs ?? 1200);
  const retryOnStatuses = new Set(options.retryOnStatuses ?? [408, 425, 429, 500, 502, 503, 504]);
  const timeoutMs = options.timeoutMs ?? 0;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeoutId =
      controller && timeoutMs > 0 ? setTimeout(() => controller.abort(new Error("fetch timeout")), timeoutMs) : null;

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller?.signal ?? init.signal
      });
      if (attempt < maxAttempts && retryOnStatuses.has(response.status)) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        await sleep(baseDelayMs * attempt);
        continue;
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return response;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      lastError = error;
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry exhausted");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
