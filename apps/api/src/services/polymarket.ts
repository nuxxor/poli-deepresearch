import {
  CanonicalMarketSchema,
  MarketContextSchema,
  PolymarketMarketSchema,
  type CanonicalMarket,
  type MarketContext,
  type PolymarketMarket
} from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { fetchWithRetry } from "./providers/shared.js";

function parseStringArray(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.map(String);
  }

  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function extractPrimaryClause(question: string): string {
  return question
    .replace(/^will\s+/i, "")
    .split(/\b(before|after|by|on|at)\b/i)[0]
    ?.replace(/\?+$/, "")
    .trim() || question;
}

function normalizeCategory(fallback: string): string {
  const value = fallback.trim().toLowerCase();

  if (value === "") {
    return "unknown";
  }

  const aliases: Record<string, string> = {
    business: "business",
    companies: "business",
    crypto: "crypto",
    cryptocurrency: "crypto",
    entertainment: "entertainment",
    legal: "legal",
    law: "legal",
    macro: "macro",
    economy: "macro",
    economics: "macro",
    finance: "macro",
    politics: "politics",
    "us-current-affairs": "politics",
    "us current affairs": "politics",
    sports: "sports",
    sport: "sports",
    technology: "technology",
    tech: "technology",
    weather: "weather",
    climate: "weather",
    world: "world",
    geopolitics: "world"
  };

  return aliases[value] ?? value;
}

export function inferCategory(question: string, description: string, fallback: string): string {
  const primaryClause = extractPrimaryClause(question);
  const focusText = primaryClause.toLowerCase();
  const text = `${primaryClause}\n${description}`.toLowerCase();
  const normalizedFallback = normalizeCategory(fallback);
  let detected = "unknown";
  const businessListingSignals =
    /\b(acquire|acquisition|merger|merged with|ipo|initial public offering|direct listing|publicly trading|public trading|begin publicly trading|shares begin trading|stock starts trading|first day of trading|investor relations)\b|\bir\./.test(text);
  const macroSignals =
    /\b(cpi|inflation|core pce|pce|unemployment rate|jobless claims|initial claims|nonfarm payroll|payrolls|fed funds|federal funds|interest rate|gdp|consumer price index|rate[- ]cut|rate[- ]cuts|fomc|target range|policy rate)\b/.test(text) ||
    (/\bfed\b/.test(text) && /\bbasis points?\b/.test(text)) ||
    /\bexact amount of cuts\b/.test(text);
  const worldSignals = /\b(ceasefire|invade|war|ukraine|russia|china|taiwan|military)\b/.test(focusText);

  if (worldSignals) {
    detected = "world";
  } else if (/(president|prime minister|election|senate|congress|white house|campaign|candidate|putin|trump|biden)/.test(text)) {
    detected = "politics";
  } else if (/\b(ceasefire|invade|war|ukraine|russia|china|taiwan|military)\b/.test(text)) {
    detected = "world";
  } else if (macroSignals) {
    detected = "macro";
  } else if (/(court|sentence|lawsuit|legal|convict|indict|acquit|harvey weinstein)/.test(text)) {
    detected = "legal";
  } else if (/\b(?:nba|nfl|mlb|nhl|championship|finals|warriors|match|league|score|stanley cup)\b/.test(text)) {
    detected = "sports";
  } else if (/\b(hurricane|landfall|nhc|weather|gistemp|nasa)\b|national hurricane center|hottest year|temperature index/.test(text)) {
    detected = "weather";
  } else if (/\b(bitcoin|btc|ethereum|eth|crypto|etf|token|fdv|coin|altcoin)\b|fully diluted valuation|market cap.*(token|coin|crypto|btc|eth)/.test(text)) {
    detected = "crypto";
  } else if (businessListingSignals) {
    detected = "business";
  } else if (/\b(gpt-\d|openai|chatgpt|tesla|optimus|anthropic|claude|gemini|xai|grok|llm|ai model|artificial intelligence)\b/.test(text)) {
    detected = "technology";
  } else if (/(album|song|movie|tv|actor|actress|rihanna|celebrity|gta)/.test(text)) {
    detected = "entertainment";
  }

  if (detected !== "unknown") {
    return detected;
  }

  return normalizedFallback;
}

function inferResolutionArchetype(question: string, description: string): CanonicalMarket["resolutionArchetype"] {
  const focus = extractPrimaryClause(question);
  const questionText = question.toLowerCase();
  const focusText = focus.toLowerCase();
  const numericText = `${question}\n${focus}`.toLowerCase();
  const text = `${question}\n${focus}\n${description}`.toLowerCase();
  const numericBetweenPattern = /\bbetween\s+(?:\$?\d|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/;
  const binanceHighThresholdSignals =
    /\bbinance\b/.test(text) &&
    /\b1 minute candle\b/.test(text) &&
    /\b(high|close)\b/.test(text) &&
    /(hit|reach|above|below|over|under|at least|at most|greater than|less than|more than|higher than|lower than|exceed|or more|or less|\$|%|percent|equal to or greater than)/.test(text);

  if (/(not ipo\b|no ipo\b|not publicly trading\b|not public by\b|not be released\b|won't be released\b|will not be released)/.test(questionText)) {
    return "negative_occurrence_by_deadline";
  }

  if (binanceHighThresholdSignals) {
    return "numeric_threshold";
  }

  if (/(launch|release|released|ship|rollout|debut|publicly trading|public trading|direct listing|begin trading|begins trading|start trading|starts trading|listing on|ipo\b|initial public offering)/.test(questionText)) {
    return "release_or_launch";
  }

  if (/(pardon|pardoned|commutation|reprieve|clemency)/.test(text)) {
    return "official_announcement_by_deadline";
  }

  if (/(ceasefire|invade|war|military|return before)/.test(focusText)) {
    return "official_announcement_by_deadline";
  }

  if (/\balbum\b|\bsong\b|\bmovie\b|\bshow\b|\bseason\b/.test(focusText)) {
    return "release_or_launch";
  }

  if (/(drop out|out as president|withdraw|resign|resignation|appoint|appointment|nominee)/.test(text)) {
    return "appointment_or_resignation";
  }

  if (/(approve|approval|authorized|authorize|sec|etf)/.test(text)) {
    return "regulatory_approval";
  }

  if (/(launch|release|released|ship|rollout|debut|publicly trading|public trading|direct listing|begin trading|begins trading|start trading|starts trading|listing on)/.test(text)) {
    return "release_or_launch";
  }

  if (/(appoint|appointment|resign|resignation|drop out|withdraw|nominee)/.test(text)) {
    return "appointment_or_resignation";
  }

  if (/(convict|sentence|court|lawsuit|legal|acquit|indict)/.test(text)) {
    return "legal_outcome";
  }

  if (/(win|winner|beat|defeat|vs\.?|match|championship|final|game)/.test(text)) {
    return "winner_of_event";
  }

  if (
    numericBetweenPattern.test(numericText) ||
    /(price|close|hit|reach|above|below|over|under|at least|at most|greater than|less than|more than|higher than|lower than|exceed|or more|or less|\$|%|percent|bps)/.test(numericText)
  ) {
    return "numeric_threshold";
  }

  if (/(not happen|won't happen|no\b.+by\b|without)/.test(text)) {
    return "negative_occurrence_by_deadline";
  }

  return "official_announcement_by_deadline";
}

function buildCanonicalMarket(rawMarket: PolymarketMarket): CanonicalMarket {
  const primaryEvent = rawMarket.events?.[0];
  const description = rawMarket.description ?? primaryEvent?.description ?? "";
  const resolutionSourceText =
    rawMarket.resolutionSource ?? primaryEvent?.resolutionSource ?? undefined;
  const category = inferCategory(rawMarket.question, description, rawMarket.category ?? primaryEvent?.category ?? "unknown");
  const subcategory = rawMarket.subcategory ?? primaryEvent?.subcategory ?? "general";
  const resolutionArchetype = inferResolutionArchetype(rawMarket.question, description);

  return CanonicalMarketSchema.parse({
    marketId: String(rawMarket.conditionId),
    eventId: String(primaryEvent?.id ?? rawMarket.id),
    title: rawMarket.question,
    slug: rawMarket.slug,
    description,
    rulesText: description || rawMarket.question,
    additionalContext: primaryEvent?.description,
    endTimeUtc: rawMarket.endDate ?? primaryEvent?.endDate ?? new Date(0).toISOString(),
    resolutionSourceText,
    category,
    subcategory: subcategory ?? "general",
    tags: [],
    relatedTags: [],
    resolutionArchetype,
    officialSourceRequired: true,
    earlyNoAllowed: false,
    priceBlind: true
  });
}

async function fetchGammaMarkets(params: Record<string, string>): Promise<PolymarketMarket[]> {
  const url = new URL("/markets", env.POLYMARKET_GAMMA_API_URL);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithRetry(url, {
        headers: {
          accept: "application/json"
        }
      }, {
        maxAttempts: 3,
        baseDelayMs: 1200
      });

      if (!response.ok) {
        throw new Error(`Gamma market lookup failed with HTTP ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        throw new Error("Gamma market lookup returned a non-array payload");
      }

      return payload.map((item) => PolymarketMarketSchema.parse(item));
    } catch (error) {
      lastError = error;
      if (attempt >= 3) {
        break;
      }

      await sleep(600 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gamma market lookup failed");
}

export async function fetchMarketContextBySlug(slug: string): Promise<MarketContext> {
  const markets = await fetchGammaMarkets({
    slug,
    limit: "1"
  });

  if (markets.length === 0) {
    throw new Error(`No market found for slug "${slug}"`);
  }

  const rawMarket = markets[0]!;
  const tokenIds = parseStringArray(rawMarket.clobTokenIds);
  const canonicalMarket = buildCanonicalMarket(rawMarket);

  return MarketContextSchema.parse({
    rawMarket,
    canonicalMarket,
    tokenIds
  });
}

export async function fetchMarketContextByConditionId(conditionId: string): Promise<MarketContext> {
  const markets = await fetchGammaMarkets({
    condition_ids: conditionId,
    limit: "1"
  });

  if (markets.length === 0) {
    throw new Error(`No market found for condition id "${conditionId}"`);
  }

  const rawMarket = markets[0]!;
  const tokenIds = parseStringArray(rawMarket.clobTokenIds);
  const canonicalMarket = buildCanonicalMarket(rawMarket);

  return MarketContextSchema.parse({
    rawMarket,
    canonicalMarket,
    tokenIds
  });
}

export async function fetchActiveMarketSlugs(limit: number): Promise<string[]> {
  const markets = await fetchGammaMarkets({
    active: "true",
    closed: "false",
    limit: String(Math.max(limit * 3, limit))
  });

  const slugs = markets
    .map((market) => market.slug)
    .filter((slug): slug is string => typeof slug === "string" && slug.trim() !== "");

  return [...new Set(slugs)].slice(0, limit);
}

export type RelatedMarketCandidate = {
  slug: string;
  title: string;
  category: string;
  resolutionArchetype: string;
};

export async function fetchRelatedMarketCandidates(
  market: MarketContext,
  limit: number
): Promise<RelatedMarketCandidate[]> {
  const eventId = market.rawMarket.events?.[0]?.id ?? market.canonicalMarket.eventId;
  const queryTokens = extractRelatedSearchTokens(market.canonicalMarket.title).slice(0, 2);

  const requests: Array<Promise<PolymarketMarket[]>> = [];
  if (eventId != null && String(eventId).trim() !== "") {
    requests.push(
      fetchGammaMarkets({
        event_id: String(eventId),
        limit: String(Math.max(limit * 2, 8))
      }).catch(() => [])
    );
  }

  for (const token of queryTokens) {
    requests.push(
      fetchGammaMarkets({
        search: token,
        limit: String(Math.max(limit * 2, 8))
      }).catch(() => [])
    );
  }

  if (requests.length === 0) {
    return [];
  }

  const rawMarkets = (await Promise.all(requests)).flat();
  const currentSlug = market.canonicalMarket.slug;
  const currentMarketId = market.canonicalMarket.marketId;
  const seen = new Set<string>();
  const items: RelatedMarketCandidate[] = [];

  for (const rawMarket of rawMarkets) {
    const candidate = buildCanonicalMarket(rawMarket);
    const slug = candidate.slug ?? rawMarket.slug;
    if (!slug || slug === currentSlug || candidate.marketId === currentMarketId) {
      continue;
    }

    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    items.push({
      slug,
      title: candidate.title,
      category: candidate.category,
      resolutionArchetype: candidate.resolutionArchetype
    });
  }

  return items.slice(0, Math.max(limit, 1));
}

function extractRelatedSearchTokens(title: string): string[] {
  const stopwords = new Set([
    "will",
    "the",
    "a",
    "an",
    "before",
    "after",
    "by",
    "on",
    "at",
    "of",
    "to",
    "and",
    "or",
    "be",
    "is",
    "are",
    "for",
    "with",
    "who",
    "what",
    "when"
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopwords.has(token))
    .sort((left, right) => right.length - left.length)
    .filter((token, index, items) => items.indexOf(token) === index);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
