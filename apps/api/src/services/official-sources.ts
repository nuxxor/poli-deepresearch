import { type MarketContext, type ProviderSearchResultItem } from "@polymarket/deep-research-contracts";
import { canonicalizeUrl, dedupeStrings } from "./urls.js";

type OfficialDomainRule = {
  pattern: RegExp;
  domains: string[];
};

const OFFICIAL_DOMAIN_RULES: OfficialDomainRule[] = [
  { pattern: /\bamazon\b|\babout amazon\b|\bir\.aboutamazon\.com\b/i, domains: ["aboutamazon.com", "ir.aboutamazon.com", "amazon.com", "www.amazon.com"] },
  { pattern: /\bapplovin\b|\bir\.applovin\.com\b/i, domains: ["applovin.com", "www.applovin.com", "ir.applovin.com"] },
  { pattern: /\btiktok\b|\bbytedance\b|\bnewsroom\.tiktok\.com\b/i, domains: ["newsroom.tiktok.com", "tiktok.com", "www.tiktok.com", "bytedance.com", "www.bytedance.com"] },
  { pattern: /\bopenai\b|\bgpt-6\b|\bchatgpt\b/i, domains: ["openai.com", "www.openai.com"] },
  { pattern: /\btesla\b|\boptimus\b/i, domains: ["tesla.com", "www.tesla.com", "ir.tesla.com"] },
  { pattern: /\bfannie mae\b|\bfhfa\b/i, domains: ["fanniemae.com", "www.fanniemae.com", "fhfa.gov", "www.fhfa.gov"] },
  { pattern: /\brockstar games?\b/i, domains: ["rockstargames.com", "www.rockstargames.com"] },
  { pattern: /\btake-two interactive\b|\btake-two\b/i, domains: ["take2games.com", "www.take2games.com"] },
  { pattern: /\bwhite house\b/i, domains: ["whitehouse.gov", "www.whitehouse.gov"] },
  { pattern: /\btrump\b|\bbiden\b|\bpresidential pardon\b|\bcommutation\b|\breprieve\b|\bclemency\b|\bpardon\b/i, domains: ["whitehouse.gov", "www.whitehouse.gov", "justice.gov", "www.justice.gov"] },
  { pattern: /\bdepartment of justice\b|\bdoj\b|\boffice of the pardon attorney\b/i, domains: ["justice.gov", "www.justice.gov"] },
  { pattern: /\bcongress\b|\bsenate\b|\bhouse of representatives\b|\bhouse committee\b/i, domains: ["congress.gov", "www.congress.gov", "senate.gov", "www.senate.gov", "house.gov", "www.house.gov"] },
  { pattern: /\bsupreme court\b|\bscotus\b/i, domains: ["supremecourt.gov", "www.supremecourt.gov"] },
  { pattern: /\bdemocratic party\b|\bdemocratic nomination\b|\bdemocratic presidential nomination\b|\bdnc\b/i, domains: ["democrats.org", "www.democrats.org"] },
  { pattern: /\brepublican party\b|\bgop\b|\brepublican nomination\b|\brnc\b/i, domains: ["gop.com", "www.gop.com"] },
  { pattern: /\bgavin newsom\b/i, domains: ["gov.ca.gov", "www.gov.ca.gov"] },
  { pattern: /\bukraine\b|\bzelensky\b|\bkyiv\b/i, domains: ["president.gov.ua", "www.president.gov.ua", "mfa.gov.ua", "www.mfa.gov.ua"] },
  { pattern: /\brussia\b|\bputin\b|\bkremlin\b/i, domains: ["kremlin.ru", "en.kremlin.ru", "government.ru", "www.government.ru"] },
  { pattern: /\bceasefire\b|\bunited nations\b|\bun\b|\bnato\b|\bstate department\b/i, domains: ["un.org", "www.un.org", "nato.int", "www.nato.int", "state.gov", "www.state.gov"] },
  { pattern: /\bsec\b|\bsecurities and exchange commission\b/i, domains: ["sec.gov", "www.sec.gov"] },
  { pattern: /\bnasdaq\b/i, domains: ["nasdaq.com", "www.nasdaq.com"] },
  { pattern: /\bnyse\b|\bnew york stock exchange\b/i, domains: ["nyse.com", "www.nyse.com"] },
  { pattern: /\bnba\b/i, domains: ["nba.com", "www.nba.com"] },
  { pattern: /\bufc\b/i, domains: ["ufc.com", "www.ufc.com"] },
  { pattern: /\bairbnb investors\b|\binvestors\.airbnb\.com\b/i, domains: ["investors.airbnb.com"] },
  { pattern: /\bfred\b|\bst\. louis fed\b|\bfederal reserve economic data\b/i, domains: ["fred.stlouisfed.org"] },
  { pattern: /\bbls\b|\bbureau of labor statistics\b/i, domains: ["bls.gov", "www.bls.gov"] },
  { pattern: /\bbea\b|\bbureau of economic analysis\b/i, domains: ["bea.gov", "www.bea.gov"] },
  { pattern: /\bfederal reserve\b|\bfed\b/i, domains: ["federalreserve.gov", "www.federalreserve.gov"] },
  { pattern: /\bnber\b|\bnational bureau of economic research\b|\brecession dating\b/i, domains: ["nber.org", "www.nber.org"] },
  { pattern: /\bmegaeth\b/i, domains: ["megaeth.com", "www.megaeth.com", "docs.megaeth.com"] },
  { pattern: /\bspotify\b|\bapple music\b|\bstreaming or download site\b|\bofficially available for download or streaming\b/i, domains: ["spotify.com", "open.spotify.com", "music.apple.com"] },
  { pattern: /\brihanna\b|\bplayboi carti\b/i, domains: ["spotify.com", "open.spotify.com", "music.apple.com"] }
];

const GTA_VI_COMPARATOR_DOMAINS = new Set([
  "rockstargames.com",
  "www.rockstargames.com",
  "take2games.com",
  "www.take2games.com"
]);

export function cleanResolutionTopic(title: string): string {
  return title
    .replace(/^will\s+/i, "")
    .replace(/\?+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractResolutionFocusTopic(title: string): string {
  const clause = cleanResolutionTopic(title).split(/\b(before|after|by|on|at)\b/i)[0]?.trim();
  return clause && clause.length >= 6 ? clause : cleanResolutionTopic(title);
}

export function filterDistractorOfficialDomains(
  market: MarketContext,
  domains: string[],
  topic = extractResolutionFocusTopic(market.canonicalMarket.title)
): string[] {
  const loweredTitle = market.canonicalMarket.title.toLowerCase();
  const loweredTopic = topic.toLowerCase();

  if (/\bbefore gta vi\b/.test(loweredTitle) && !/\bgta vi\b/.test(loweredTopic)) {
    return domains.filter((domain) => !GTA_VI_COMPARATOR_DOMAINS.has(domain.toLowerCase()));
  }

  return domains;
}

export function filterDistractorOfficialUrls(
  market: MarketContext,
  urls: string[],
  topic = extractResolutionFocusTopic(market.canonicalMarket.title)
): string[] {
  const allowedDomains = new Set(filterDistractorOfficialDomains(market, extractOfficialDomainsForMarket(market, topic), topic));

  return urls.filter((url) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return allowedDomains.size === 0 || allowedDomains.has(hostname) || [...allowedDomains].some((domain) => hostname.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  });
}

export function extractOfficialDomainsFromText(input: string | undefined): string[] {
  if (!input) {
    return [];
  }

  const urlDomains = extractUrlsFromText(input)
    .map((url) => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));
  const hintedDomains = OFFICIAL_DOMAIN_RULES
    .filter((rule) => rule.pattern.test(input))
    .flatMap((rule) => rule.domains);

  return dedupeStrings([...urlDomains, ...hintedDomains]);
}

export function extractOfficialDomainsForMarket(market: MarketContext, topic = extractResolutionFocusTopic(market.canonicalMarket.title)): string[] {
  const domains = dedupeStrings(
    [
      market.canonicalMarket.resolutionSourceText,
      market.canonicalMarket.rulesText,
      market.canonicalMarket.additionalContext,
      market.canonicalMarket.description,
      market.canonicalMarket.title
    ].flatMap((text) => extractOfficialDomainsFromText(text))
  );

  return dedupeStrings(filterDistractorOfficialDomains(market, domains, topic));
}

export function extractOfficialUrlsForMarket(market: MarketContext, topic = extractResolutionFocusTopic(market.canonicalMarket.title)): string[] {
  const urls = dedupeStrings(
    [
      market.canonicalMarket.resolutionSourceText,
      market.canonicalMarket.rulesText,
      market.canonicalMarket.additionalContext,
      market.canonicalMarket.description
    ].flatMap((text) => extractUrlsFromText(text))
  );

  return dedupeStrings(filterDistractorOfficialUrls(market, urls, topic));
}

export function isOfficialUrlForMarket(url: string, market: MarketContext): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (
    hostname.endsWith(".gov") ||
    hostname === "sec.gov" ||
    hostname === "www.sec.gov" ||
    hostname === "whitehouse.gov" ||
    hostname === "www.whitehouse.gov" ||
    hostname === "nba.com" ||
    hostname === "www.nba.com" ||
    hostname === "ufc.com" ||
    hostname === "www.ufc.com"
  ) {
    return true;
  }

  const domains = extractOfficialDomainsForMarket(market);
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function prioritizeExtractionTargets(
  market: MarketContext,
  citations: ProviderSearchResultItem[],
  maxUrls: number
): Array<{ url: string; origin: "official_direct" | "official_citation" | "citation" }> {
  const officialDirect = extractOfficialUrlsForMarket(market).map((url) => ({
    url,
    origin: "official_direct" as const
  }));
  const officialCitations = citations
    .filter((item): item is ProviderSearchResultItem & { url: string } => Boolean(item.url))
    .filter((item) => isOfficialUrlForMarket(item.url, market))
    .map((item) => ({
      url: item.url,
      origin: "official_citation" as const
    }));
  const generalCitations = citations
    .filter((item): item is ProviderSearchResultItem & { url: string } => Boolean(item.url))
    .map((item) => ({
      url: item.url,
      origin: "citation" as const
    }));

  const seen = new Set<string>();
  const ordered = [...officialDirect, ...officialCitations, ...generalCitations].filter((item) => {
    const key = canonicalizeUrl(item.url);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return ordered.slice(0, maxUrls);
}

export function extractUrlsFromText(input: string | undefined): string[] {
  if (!input) {
    return [];
  }

  const matches = [...input.matchAll(/https?:\/\/[^\s)>\]]+/gi)];
  return dedupeStrings(matches.map((match) => trimUrl(match[0] ?? "")));
}

function trimUrl(url: string): string {
  return url.replace(/[).,;]+$/g, "");
}
