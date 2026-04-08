export const API_BASE = "http://127.0.0.1:4010";

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

export async function fetchHealthStatus() {
  return fetchJson("/v1/health");
}

export async function fetchMarketContext(slug) {
  return fetchJson(`/v1/markets/slug/${encodeURIComponent(slug)}/context`);
}

export async function fetchResearchProduct(slug, options = {}) {
  const params = new URLSearchParams({
    bypassCache: options.bypassCache ? "true" : "false"
  });
  return fetchJson(`/v1/research/slug/${encodeURIComponent(slug)}/product?${params.toString()}`);
}

export async function fetchResearchLatest(slug, options = {}) {
  const params = new URLSearchParams({
    bypassCache: options.bypassCache ? "true" : "false"
  });
  return fetchJson(`/v1/research/slug/${encodeURIComponent(slug)}/latest?${params.toString()}`);
}
