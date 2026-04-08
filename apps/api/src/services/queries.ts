import {
  SearchQueryPlanSchema,
  type CrossMarketContext,
  type AppliedPolicy,
  type MacroOfficialContext,
  type MarketContext,
  type SearchQueryPlan
} from "@polymarket/deep-research-contracts";

import { mapMarketToFredSeries } from "./fred-mapper.js";
import {
  extractOfficialDomainsForMarket,
  extractOfficialDomainsFromText,
  extractResolutionFocusTopic,
  filterDistractorOfficialDomains
} from "./official-sources.js";
import { resolveAppliedPolicy } from "./policies.js";

export function extractOfficialDomains(input: string | undefined): string[] {
  return extractOfficialDomainsFromText(input);
}

function buildSiteClause(domains: string[], maxDomains = 3): string {
  const cleaned = dedupeStrings(domains).slice(0, maxDomains);
  if (cleaned.length === 0) {
    return "";
  }

  if (cleaned.length === 1) {
    return `site:${cleaned[0]}`;
  }

  return `(${cleaned.map((domain) => `site:${domain}`).join(" OR ")})`;
}

function prioritizeOfficialDomains(
  market: MarketContext,
  domains: string[],
  topic: string
): string[] {
  const topicDomains = extractOfficialDomainsFromText(topic);
  const titleDomains = extractOfficialDomainsFromText(market.canonicalMarket.title);
  const preferred = dedupeStrings([...topicDomains, ...titleDomains]);
  const filtered = filterDistractorOfficialDomains(market, domains, topic);

  if (preferred.length === 0) {
    return filtered;
  }

  const domainSet = new Set(filtered);
  const focused = preferred.filter((domain) => domainSet.has(domain));
  return focused.length > 0 ? focused : filtered;
}

function buildOfficialQuery(
  market: MarketContext,
  topic: string,
  officialDomains: string[],
  focusTerms: string
): string {
  const siteClause = buildSiteClause(officialDomains);
  const { category, resolutionArchetype } = market.canonicalMarket;

  if (category === "business" && resolutionArchetype === "official_announcement_by_deadline") {
    return [topic, "(acquisition OR merger OR investor relations OR press release OR official announcement)", siteClause]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "business" && resolutionArchetype === "negative_occurrence_by_deadline") {
    return [topic, "(IPO OR listing OR direct listing OR first day of trading OR investor relations OR sec filing)", siteClause || "site:sec.gov"]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "business" && resolutionArchetype === "release_or_launch") {
    return [topic, "(official release OR product page OR investor relations OR company announcement)", siteClause]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "politics" && resolutionArchetype === "official_announcement_by_deadline") {
    return [
      topic,
      "(official statement OR White House OR DOJ OR executive order OR pardon OR commutation OR Congress OR court filing)",
      siteClause || "(site:whitehouse.gov OR site:justice.gov OR site:congress.gov)"
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "politics" && resolutionArchetype === "appointment_or_resignation") {
    return [
      topic,
      "(official statement OR resignation OR removal OR death OR 25th Amendment OR White House OR Congress OR court filing)",
      siteClause || "(site:whitehouse.gov OR site:congress.gov OR site:supremecourt.gov)"
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "world" && resolutionArchetype === "official_announcement_by_deadline") {
    return [
      topic,
      "(official ceasefire agreement OR mutual ceasefire OR presidency statement OR foreign ministry OR Kremlin OR UN OR NATO OR Reuters OR AP)",
      buildSiteClause(officialDomains, 6) || "(site:president.gov.ua OR site:mfa.gov.ua OR site:kremlin.ru OR site:government.ru OR site:un.org OR site:nato.int)"
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "macro") {
    const text = `${market.canonicalMarket.title}\n${market.canonicalMarket.rulesText}`.toLowerCase();
    if (/\brecession\b|\bnber\b|\btwo consecutive quarters\b/.test(text)) {
      return [
        topic,
        "(official release OR recession dating OR GDP advance estimate OR NBER OR BEA)",
        siteClause || "(site:bea.gov OR site:www.bea.gov OR site:nber.org OR site:www.nber.org OR site:fred.stlouisfed.org)"
      ]
        .filter(Boolean)
        .join(" ");
    }

    return [
      topic,
      "(official release OR FOMC OR target range OR policy statement OR Federal Reserve OR BLS OR BEA)",
      siteClause || "(site:federalreserve.gov OR site:fred.stlouisfed.org OR site:bls.gov OR site:bea.gov)"
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "technology") {
    return [topic, "(official release OR launch OR available now OR docs OR blog OR announcement)", buildSiteClause(officialDomains, 4)]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "crypto" && resolutionArchetype === "release_or_launch") {
    return [
      topic,
      "(official launch OR token launch OR TGE OR listing OR trading OR docs OR blog OR announcement)",
      buildSiteClause(officialDomains, 4)
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (category === "entertainment" && resolutionArchetype === "release_or_launch") {
    return [
      topic,
      "(official album release OR available now OR streaming now OR Apple Music OR Spotify OR label announcement)",
      buildSiteClause(officialDomains, 4) || "(site:spotify.com OR site:open.spotify.com OR site:music.apple.com)"
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (siteClause) {
    return `${topic} ${focusTerms} ${siteClause}`;
  }

  return `${topic} ${focusTerms} official source`;
}

function buildContradictionQuery(
  market: MarketContext,
  topic: string
): string {
  const { category, resolutionArchetype } = market.canonicalMarket;

  if (category === "business" && resolutionArchetype === "official_announcement_by_deadline") {
    return `${topic} denied OR no deal OR no acquisition OR rumor OR unconfirmed`;
  }

  if (category === "business" && resolutionArchetype === "negative_occurrence_by_deadline") {
    return `${topic} IPO OR listing OR direct listing OR starts trading OR first day of trading`;
  }

  if (category === "technology") {
    return `${topic} delayed OR not released OR limited preview OR beta only OR unavailable`;
  }

  if (category === "politics") {
    return `${topic} denied OR not considering OR no official action OR unconfirmed OR false`;
  }

  if (category === "world") {
    return `${topic} denied OR no agreement OR no ceasefire OR unconfirmed OR false`;
  }

  if (category === "entertainment") {
    return `${topic} teaser OR rumor OR snippet OR unreleased OR no album OR no streaming release`;
  }

  if (category === "macro") {
    const text = `${market.canonicalMarket.title}\n${market.canonicalMarket.rulesText}`.toLowerCase();
    if (/\brecession\b|\bnber\b|\btwo consecutive quarters\b/.test(text)) {
      return `${topic} no recession OR no NBER announcement OR GDP positive OR official release`;
    }

    return `${topic} no rate cut OR target range unchanged OR official release OR statement`;
  }

  return `${topic} denied OR contradicted OR false OR delayed`;
}

function toTwitterSinceDate(isoDate: string): string {
  const date = new Date(isoDate);
  const fallback = new Date();
  const reference = Number.isNaN(date.getTime()) ? fallback : date.getTime() > Date.now() ? fallback : date;
  const target = new Date(reference.getTime() - 1000 * 60 * 60 * 24 * 90);

  const year = target.getUTCFullYear();
  const month = String(target.getUTCMonth() + 1).padStart(2, "0");
  const day = String(target.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}_00:00:00_UTC`;
}

function buildWebQuery(
  market: MarketContext,
  topic: string,
  focusTerms: string
): string {
  const { category, resolutionArchetype } = market.canonicalMarket;

  if (category === "world" && resolutionArchetype === "official_announcement_by_deadline") {
    return `${topic} official ceasefire agreement Reuters AP`;
  }

  if (category === "entertainment" && resolutionArchetype === "release_or_launch") {
    return `${topic} album release Spotify Apple Music Billboard`;
  }

  if (category === "legal") {
    return `${topic} sentencing court order Reuters AP`;
  }

  return `${topic} ${focusTerms}`;
}

export function buildSearchQueryPlan(market: MarketContext): SearchQueryPlan {
  const appliedPolicy = resolveAppliedPolicy(market);
  const { canonicalMarket } = market;
  const topic = extractResolutionFocusTopic(canonicalMarket.title);
  const fredMapping = mapMarketToFredSeries(market);
  const officialDomains = prioritizeOfficialDomains(market, dedupeStrings([
    ...extractOfficialDomainsForMarket(market),
    ...(fredMapping ? [fredMapping.officialDomain] : [])
  ]), topic);
  const officialDomain = officialDomains[0];
  const focusTerms = appliedPolicy.pack.queryFocusTerms.slice(0, 3).join(" ");
  const officialQuery = fredMapping
    ? `${topic} ${fredMapping.seriesId} ${fredMapping.title} ${fredMapping.transform} site:${fredMapping.officialDomain}`
    : buildOfficialQuery(market, topic, officialDomains, focusTerms);
  const webQuery = buildWebQuery(market, topic, focusTerms);
  const contradictionQuery = buildContradictionQuery(market, topic);
  const socialQuery = `"${topic}" ${appliedPolicy.pack.queryFocusTerms.slice(0, 2).join(" ")} since:${toTwitterSinceDate(canonicalMarket.endTimeUtc)}`;
  const queryNotes = [
    `resolution_archetype=${canonicalMarket.resolutionArchetype}`,
    `category=${canonicalMarket.category}`,
    `policy_pack=${appliedPolicy.pack.id}@${appliedPolicy.pack.version}`,
    officialDomain ? `official_domain=${officialDomain}` : "official_domain=unknown",
    ...(fredMapping
      ? [
          `fred_series=${fredMapping.seriesId}`,
          `fred_transform=${fredMapping.transform}`,
          ...fredMapping.notes
        ]
      : [])
  ];

  return SearchQueryPlanSchema.parse({
    topic,
    webQuery,
    officialQuery,
    socialQuery,
    contradictionQuery,
    officialDomains,
    queryNotes,
    policyPackId: appliedPolicy.pack.id,
    promptVersion: appliedPolicy.researchPrompt.version
  });
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    items.push(trimmed);
  }

  return items;
}

export function buildResearchPrompt(market: MarketContext): string {
  const appliedPolicy = resolveAppliedPolicy(market);
  return buildPackAwarePrompt(market, appliedPolicy, "research");
}

export function buildOpinionPrompt(
  market: MarketContext,
  queryPlan?: SearchQueryPlan,
  macroOfficialContext?: MacroOfficialContext,
  crossMarketContext?: CrossMarketContext
): string {
  const appliedPolicy = resolveAppliedPolicy(market);
  return buildPackAwarePrompt(market, appliedPolicy, "opinion", queryPlan, macroOfficialContext, crossMarketContext);
}

function buildPackAwarePrompt(
  market: MarketContext,
  appliedPolicy: AppliedPolicy,
  mode: "research" | "opinion",
  queryPlan?: SearchQueryPlan,
  macroOfficialContext?: MacroOfficialContext,
  crossMarketContext?: CrossMarketContext
): string {
  const { canonicalMarket } = market;
  const officialDomains = queryPlan?.officialDomains?.length
    ? queryPlan.officialDomains
    : extractOfficialDomainsForMarket(market);
  const lines = [
    mode === "opinion"
      ? "You are a Polymarket research analyst, not a judge. The user wants your view, not a refusal."
      : "You are a Polymarket research planner and summarizer.",
    `Prompt template: ${(mode === "opinion" ? appliedPolicy.opinionPrompt : appliedPolicy.researchPrompt).id}@${(mode === "opinion" ? appliedPolicy.opinionPrompt : appliedPolicy.researchPrompt).version}`,
    `Policy pack: ${appliedPolicy.pack.id}@${appliedPolicy.pack.version}`,
    `Category: ${canonicalMarket.category}`,
    `Resolution archetype: ${canonicalMarket.resolutionArchetype}`,
    `Market title: ${canonicalMarket.title}`,
    `Market deadline (UTC): ${canonicalMarket.endTimeUtc}`,
    `Rules text: ${compactRulesText(canonicalMarket.rulesText)}`,
    `Source priority: ${appliedPolicy.pack.sourcePriority.join(" > ")}`,
    `Query focus terms: ${appliedPolicy.pack.queryFocusTerms.join(", ")}`
  ];

  if (officialDomains.length > 0) {
    lines.push(`Preferred official domains: ${officialDomains.join(", ")}`);
  }

  if (canonicalMarket.additionalContext) {
    lines.push(`Additional context: ${canonicalMarket.additionalContext}`);
  }

  if (canonicalMarket.resolutionSourceText) {
    lines.push(`Resolution source text: ${canonicalMarket.resolutionSourceText}`);
  }

  lines.push(`Decisive YES rules: ${appliedPolicy.pack.decisiveYesRules.join(" ")}`);
  lines.push(`Decisive NO rules: ${appliedPolicy.pack.decisiveNoRules.join(" ")}`);
  lines.push(`Contradiction rules: ${appliedPolicy.pack.contradictionRules.join(" ")}`);
  lines.push(`Escalation rules: ${appliedPolicy.pack.escalationRules.join(" ")}`);

  if (queryPlan) {
    lines.push(`Planner official query: ${queryPlan.officialQuery}`);
    lines.push(`Planner web query: ${queryPlan.webQuery}`);
    lines.push(`Planner contradiction query: ${queryPlan.contradictionQuery}`);
  }

  if (macroOfficialContext) {
    lines.push(
      `Official macro context: ${macroOfficialContext.seriesId} (${macroOfficialContext.title}) via ${macroOfficialContext.officialUrl}`
    );
    lines.push(
      `Latest official observation: ${macroOfficialContext.latestObservationDate} value=${macroOfficialContext.latestObservationValue}`
    );
    if (macroOfficialContext.comparisonObservationDate && macroOfficialContext.comparisonObservationValue != null) {
      lines.push(
        `Comparison observation: ${macroOfficialContext.comparisonObservationDate} value=${macroOfficialContext.comparisonObservationValue}`
      );
    }
    lines.push(
      `Derived official metric: ${macroOfficialContext.transformedLabel}=${macroOfficialContext.transformedValue}`
    );
    if (macroOfficialContext.targetPeriodLabel) {
      lines.push(
        `Target period status: ${macroOfficialContext.targetPeriodLabel} -> ${macroOfficialContext.targetPeriodStatus}`
      );
    }
    if (macroOfficialContext.targetObservationDate && macroOfficialContext.targetTransformedValue != null) {
      lines.push(
        `Target period official metric: ${macroOfficialContext.targetObservationDate} ${macroOfficialContext.transformedLabel}=${macroOfficialContext.targetTransformedValue}`
      );
    }
    if (macroOfficialContext.targetThresholdLabel) {
      lines.push(`Target threshold: ${macroOfficialContext.targetThresholdLabel}`);
    }
    if (macroOfficialContext.targetThresholdSatisfied != null) {
      lines.push(`Target threshold satisfied: ${macroOfficialContext.targetThresholdSatisfied}`);
    }
  }

  if (crossMarketContext && crossMarketContext.markets.length > 0) {
    lines.push(`Cross-market context: ${crossMarketContext.summary}`);
    for (const relatedMarket of crossMarketContext.markets.slice(0, 3)) {
      lines.push(
        `Related archived market: ${relatedMarket.title} | relation=${relatedMarket.relation} | overlap=${relatedMarket.overlapScore.toFixed(2)} | why=${relatedMarket.why}`
      );
    }
  }

  if (mode === "opinion") {
    lines.push(
      "You are a fair, source-cited research analyst. Your job is to give the user a directional opinion plus the strongest case for each side, NOT to refuse or escalate."
    );
    lines.push(
      "DO NOT default to UNRESOLVED. If the market deadline has not passed, set resolutionStatus to NOT_YET_RESOLVED — but you MUST still produce a directional `lean` (one of STRONG_NO, LEAN_NO, TOSSUP, LEAN_YES, STRONG_YES) based on current evidence plus historical base rates from your training data."
    );
    lines.push(
      "If the deadline has passed AND the resolution is clearly known, set resolutionStatus to RESOLVED_YES or RESOLVED_NO and pick the matching STRONG_* lean."
    );
    lines.push(
      "For yesCase, present the strongest 2-4 reasons a fair analyst could argue YES, each with a 1-line bullet and citation URLs from the live web search results."
    );
    lines.push(
      "For noCase, present the strongest 2-4 reasons a fair analyst could argue NO, each with a 1-line bullet and citation URLs from the live web search results."
    );
    lines.push(
      "For historicalContext, draw on your training-data knowledge of similar past events. Be concrete: name past base rates, name comparable past markets/incidents, name what tends to happen when similar conditions held."
    );
    lines.push(
      "For whatToWatch, list 2-4 specific, observable signals that, if they flip, would shift your lean. These are flip triggers, not generic uncertainty."
    );
    lines.push(
      "modelTake is your one-paragraph analyst voice — your synthesized read of the situation. why is one short sentence summarizing the lean."
    );
    lines.push(
      "leanConfidence reflects how confident you are in the lean direction. resolutionConfidence reflects how confident you are about whether the market is or isn't resolved yet."
    );
    lines.push(
      "Do NOT use Polymarket market price as evidence. Cite only fresh, source-backed material from the live web results."
    );
    lines.push(
      "Return ONLY valid JSON matching the response_format schema. Every bullet citation URL must come from the search results you actually saw."
    );
  } else {
    lines.push("Goal: identify the most decisive current evidence, explain what would resolve the market, and prefer official and top-tier sources.");
  }

  return lines.join("\n");
}

function compactRulesText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 1400) {
    return normalized;
  }

  return `${normalized.slice(0, 1399)}…`;
}
