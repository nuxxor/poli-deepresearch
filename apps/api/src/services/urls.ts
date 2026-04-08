import { type ProviderSearchResultItem } from "@polymarket/deep-research-contracts";

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "igshid",
  "ref_src",
  "ref_url"
]);

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();

    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }

    const normalizedParams = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) {
        return leftKey.localeCompare(rightKey);
      }

      return leftValue.localeCompare(rightValue);
    });
    parsed.search = "";
    for (const [key, value] of normalizedParams) {
      parsed.searchParams.append(key, value);
    }

    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function dedupeProviderSearchResults(results: ProviderSearchResultItem[]): ProviderSearchResultItem[] {
  const deduped = new Map<string, ProviderSearchResultItem>();

  for (const result of results) {
    const key = getSearchResultDedupKey(result);
    if (key === "") {
      continue;
    }

    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, normalizeSearchResult(result));
      continue;
    }

    deduped.set(key, preferRicherResult(existing, result));
  }

  return [...deduped.values()];
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (key === "" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

function getSearchResultDedupKey(result: ProviderSearchResultItem): string {
  if (result.url?.trim()) {
    return canonicalizeUrl(result.url);
  }

  const fallback = [result.title, result.snippet].filter(Boolean).join("|").trim().toLowerCase();
  return fallback;
}

function normalizeSearchResult(result: ProviderSearchResultItem): ProviderSearchResultItem {
  return {
    ...result,
    url: result.url?.trim() ? canonicalizeUrl(result.url) : result.url,
    title: result.title?.trim() || undefined,
    snippet: result.snippet?.trim() || undefined,
    source: result.source?.trim() || undefined,
    author: result.author?.trim() || undefined
  };
}

function preferRicherResult(
  left: ProviderSearchResultItem,
  right: ProviderSearchResultItem
): ProviderSearchResultItem {
  const normalizedLeft = normalizeSearchResult(left);
  const normalizedRight = normalizeSearchResult(right);
  const leftScore = scoreResult(normalizedLeft);
  const rightScore = scoreResult(normalizedRight);

  return rightScore > leftScore ? normalizedRight : normalizedLeft;
}

function scoreResult(result: ProviderSearchResultItem): number {
  return [
    result.title?.length ?? 0,
    result.snippet?.length ?? 0,
    result.publishedAt ? 25 : 0,
    result.author ? 10 : 0
  ].reduce((sum, value) => sum + value, 0);
}
