import {
  ProviderHealthResponseSchema,
  type ProviderHealthEntry,
  type ProviderHealthResponse
} from "@polymarket/deep-research-contracts";

type MutableProviderHealthEntry = ProviderHealthEntry;

const healthByProvider = new Map<string, MutableProviderHealthEntry>();

export function recordProviderHealth(input: {
  provider: string;
  ok: boolean;
  durationMs: number;
  httpStatus?: number;
  error?: string;
}): void {
  const current = healthByProvider.get(input.provider) ?? {
    provider: input.provider,
    total: 0,
    successes: 0,
    failures: 0,
    successRate: 0,
    consecutiveFailures: 0,
    averageDurationMs: 0
  };

  current.total += 1;
  current.successes += input.ok ? 1 : 0;
  current.failures += input.ok ? 0 : 1;
  current.successRate = current.total === 0 ? 0 : current.successes / current.total;
  current.consecutiveFailures = input.ok ? 0 : current.consecutiveFailures + 1;
  current.averageDurationMs =
    current.total === 1
      ? input.durationMs
      : (current.averageDurationMs * (current.total - 1) + input.durationMs) / current.total;
  current.lastStatus = input.ok ? "ok" : "error";
  current.lastHttpStatus = input.httpStatus;
  current.lastError = input.error;
  current.lastDurationMs = input.durationMs;
  current.lastSeenAt = new Date().toISOString();

  healthByProvider.set(input.provider, current);
}

export function getProviderHealthSnapshot(): ProviderHealthResponse {
  const providers = [...healthByProvider.values()].sort((left, right) => left.provider.localeCompare(right.provider));
  return ProviderHealthResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    providers
  });
}
