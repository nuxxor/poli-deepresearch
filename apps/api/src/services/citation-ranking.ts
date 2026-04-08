import { type ProviderSearchResultItem } from "@polymarket/deep-research-contracts";

/**
 * Domain-tier based citation ranking.
 *
 * Tier 3 (rank 3): Primary/official sources — government, regulatory filings, newswires,
 *   flagship financial press. Always prefer these.
 * Tier 2 (rank 2): Mainstream quality press, tier-1 tech/business press, Wikipedia,
 *   academic preprints, major exchanges.
 * Tier 1 (rank 1): Everything else that isn't junk — niche blogs, aggregators, etc.
 * Tier 0 (rank 0): Junk we drop entirely — short-form social video, generic forums,
 *   off-topic pages, pinterest, content mills.
 *
 * Market-specific official domains (from extractOfficialDomainsForMarket) are boosted
 * to tier 4 so they always win ranking against generic tier-3 domains.
 */

const TIER_3_DOMAINS = new Set<string>([
  // Governments & regulators
  "sec.gov",
  "cftc.gov",
  "federalreserve.gov",
  "treasury.gov",
  "whitehouse.gov",
  "supremecourt.gov",
  "congress.gov",
  "senate.gov",
  "house.gov",
  "justice.gov",
  "state.gov",
  "uscourts.gov",
  "bls.gov",
  "bea.gov",
  "cdc.gov",
  "fda.gov",
  "ftc.gov",
  "nasa.gov",
  "nih.gov",
  "europa.eu",
  "ecb.europa.eu",
  "imf.org",
  "worldbank.org",
  "oecd.org",
  "un.org",
  "who.int",
  "bankofengland.co.uk",
  "gov.uk",

  // Financial newswires / flagship press
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",

  // Primary data / official market infra
  "polymarket.com",
  "gamma-api.polymarket.com",
  "clob.polymarket.com",
  "binance.com",
  "coinbase.com",
  "nyse.com",
  "nasdaq.com"
]);

const TIER_2_DOMAINS = new Set<string>([
  // Tech / business press
  "theinformation.com",
  "theverge.com",
  "techcrunch.com",
  "arstechnica.com",
  "wired.com",
  "cnbc.com",
  "cnn.com",
  "bbc.com",
  "bbc.co.uk",
  "politico.com",
  "axios.com",
  "forbes.com",
  "fortune.com",
  "businessinsider.com",
  "yahoo.com",
  "finance.yahoo.com",
  "marketwatch.com",
  "fool.com",
  "morningstar.com",
  "seekingalpha.com",

  // Crypto / prediction markets
  "coindesk.com",
  "theblock.co",
  "cointelegraph.com",
  "decrypt.co",
  "bitcoinmagazine.com",

  // Sports
  "espn.com",
  "theathletic.com",
  "nhl.com",
  "nba.com",
  "nfl.com",
  "mlb.com",
  "fifa.com",

  // General knowledge / academic
  "wikipedia.org",
  "arxiv.org",
  "nature.com",
  "science.org",
  "pnas.org"
]);

const TIER_0_DOMAINS = new Set<string>([
  // Short-form social video / image feeds
  "instagram.com",
  "tiktok.com",
  "pinterest.com",
  "snapchat.com",

  // Generic UGC / low-signal
  "quora.com",
  "answers.com",
  "ehow.com",
  "wikihow.com",
  "fandom.com",
  "wattpad.com",

  // Content mills / SEO farms commonly surfaced by broad web search
  "ask.com",
  "chegg.com"
]);

const TIER_0_PATH_PATTERNS: RegExp[] = [
  /youtube\.com\/shorts\//i,
  /facebook\.com\/reel/i,
  /\/reel\//i,
  /\/shorts\//i
];

/**
 * Snippets that direct-resolver generates as placeholders when it only has a
 * domain hint and couldn't fetch a real page. Real tier-3 content (SEC filings,
 * Reuters articles) always has a content-bearing snippet — so these should
 * rank below real research content.
 */
const STUB_SNIPPET_PATTERNS: RegExp[] = [
  /^Official issuer,?\s/i,
  /^Official issuer or\s/i,
  /^Resolution source page for\s/i,
  /checked for .* listing and IPO signals/i,
  /Official .* page checked/i
];

type CitationRankInput = {
  citation: ProviderSearchResultItem;
  officialDomains: string[];
};

export type RankedCitation = {
  citation: ProviderSearchResultItem;
  rank: number;
  isJunk: boolean;
};

function getHostname(url: string | undefined): string | null {
  if (!url || typeof url !== "string") {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string, domainSet: Set<string>): boolean {
  if (domainSet.has(host)) {
    return true;
  }
  for (const domain of domainSet) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return true;
    }
  }
  return false;
}

function isJunkUrl(url: string): boolean {
  for (const pattern of TIER_0_PATH_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

function isStubCitation(citation: ProviderSearchResultItem): boolean {
  const snippet = (citation.snippet ?? "").trim();
  if (snippet === "") {
    // Empty snippet is not a stub — xAI citations legitimately have no excerpt
    // when the model returned structured JSON output. The URL + title still
    // carry full citation value, and the domain tier is the real signal.
    return false;
  }
  for (const pattern of STUB_SNIPPET_PATTERNS) {
    if (pattern.test(snippet)) {
      return true;
    }
  }
  return false;
}

function officialDomainHosts(officialDomains: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const raw of officialDomains) {
    const host = getHostname(raw.startsWith("http") ? raw : `https://${raw}`);
    if (host) {
      hosts.add(host);
    }
  }
  return hosts;
}

export function rankCitation(input: CitationRankInput): RankedCitation {
  const { citation, officialDomains } = input;
  const url = citation.url ?? "";
  const host = getHostname(url);

  if (!host || url === "") {
    return { citation, rank: 0, isJunk: true };
  }

  if (isJunkUrl(url) || hostMatches(host, TIER_0_DOMAINS)) {
    return { citation, rank: 0, isJunk: true };
  }

  const stub = isStubCitation(citation);
  const officialHosts = officialDomainHosts(officialDomains);
  const isOfficialHost = officialHosts.size > 0 && hostMatches(host, officialHosts);

  // Stub citations (direct-resolver placeholders, empty-snippet stubs) carry
  // no user-facing research content even when they live on an official domain.
  // Rank them at tier 1 so real content with snippets always wins.
  if (stub) {
    return { citation, rank: 1, isJunk: false };
  }

  if (isOfficialHost) {
    return { citation, rank: 4, isJunk: false };
  }

  if (hostMatches(host, TIER_3_DOMAINS)) {
    return { citation, rank: 3, isJunk: false };
  }

  if (hostMatches(host, TIER_2_DOMAINS)) {
    return { citation, rank: 2, isJunk: false };
  }

  return { citation, rank: 1, isJunk: false };
}

/**
 * Drop junk, then stable-sort by rank descending. Within the same rank tier,
 * original order is preserved so provider-level ordering (parallel first,
 * then xai, then direct) still influences ties.
 */
export function rankAndFilterCitations(
  citations: ProviderSearchResultItem[],
  officialDomains: string[]
): ProviderSearchResultItem[] {
  const ranked = citations.map((citation, index) => ({
    ranked: rankCitation({ citation, officialDomains }),
    index
  }));

  return ranked
    .filter((entry) => !entry.ranked.isJunk)
    .sort((a, b) => {
      if (b.ranked.rank !== a.ranked.rank) {
        return b.ranked.rank - a.ranked.rank;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.ranked.citation);
}
