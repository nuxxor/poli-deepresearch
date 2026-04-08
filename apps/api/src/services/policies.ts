import {
  AppliedPolicySchema,
  PolicyPackSchema,
  PromptTemplateSchema,
  type AppliedPolicy,
  type MarketContext,
  type PolicyPack,
  type PromptTemplate
} from "@polymarket/deep-research-contracts";

const RESEARCH_PROMPT_TEMPLATE = PromptTemplateSchema.parse({
  id: "market-research-summary",
  version: "v2",
  kind: "research",
  summary: "Pack-driven market research summary prompt with source priorities and decisive rules."
});

const OPINION_PROMPT_TEMPLATE = PromptTemplateSchema.parse({
  id: "market-opinion-json",
  version: "v1",
  kind: "opinion",
  summary: "Opinion-mode analyst prompt: directional lean with yes/no cases, historical context, and what-to-watch."
});

const DEFAULT_PACK = makePack({
  id: "default-official-announcement",
  category: "default",
  resolutionArchetype: "official_announcement_by_deadline",
  sourcePriority: ["official statement", "regulator or institution", "Reuters/AP/Bloomberg", "major media"],
  queryFocusTerms: ["official statement", "announcement", "confirmed", "deadline"],
  decisiveYesRules: ["YES requires a public official announcement or equally decisive institutional confirmation before the deadline."],
  decisiveNoRules: ["If the deadline has not passed, prefer UNRESOLVED unless the rules explicitly allow an early NO or the event becomes impossible."],
  contradictionRules: ["If a credible official source and credible top-tier source conflict, mark CONTRADICTORY."],
  escalationRules: ["Escalate when official evidence is missing, conflicting, or only social coverage exists."]
});

const DEFAULT_WINNER_PACK = makePack({
  id: "default-winner-of-event",
  category: "default",
  resolutionArchetype: "winner_of_event",
  sourcePriority: ["official event or league results", "official scoreboard", "AP/Reuters", "major event coverage"],
  queryFocusTerms: ["official results", "winner", "scoreboard", "final result"],
  decisiveYesRules: ["YES requires an official result showing the named side as winner or that the stated threshold condition was met."],
  decisiveNoRules: ["NO requires an official result showing another side won or the named threshold was not met by the deadline."],
  contradictionRules: ["Ignore commentary and previews once official results exist."],
  escalationRules: ["Escalate only if official result sources disagree or remain unavailable after the event."]
});

const DEFAULT_RELEASE_PACK = makePack({
  id: "default-release-or-launch",
  category: "default",
  resolutionArchetype: "release_or_launch",
  sourcePriority: ["official issuer/publisher/league source", "regulator or exchange page", "Reuters/AP/Bloomberg", "major trade press"],
  queryFocusTerms: ["official release", "available now", "launch", "listing", "official announcement"],
  decisiveYesRules: ["YES requires official public availability, an official release/listing announcement, or another rule-consistent launch confirmation."],
  decisiveNoRules: ["NO requires a superseding official delay beyond the deadline, or the deadline passing without the qualifying launch/release."],
  contradictionRules: ["Teasers, rumors, and marketing hints are not decisive without official release channels."],
  escalationRules: ["Escalate when official and major-media framing differ on whether a qualifying launch actually occurred."]
});

const DEFAULT_LEGAL_PACK = makePack({
  id: "default-legal-outcome",
  category: "default",
  resolutionArchetype: "legal_outcome",
  sourcePriority: ["court record", "official prosecutor or agency statement", "AP/Reuters", "major legal press"],
  queryFocusTerms: ["court filing", "judgment", "charge filed", "official legal record"],
  decisiveYesRules: ["YES requires an official court, prosecutor, or agency record matching the legal outcome in the market."],
  decisiveNoRules: ["NO requires the deadline to pass without the legal event, or an official record establishing the opposite outcome."],
  contradictionRules: ["Commentary and third-party summaries do not outweigh the official legal record."],
  escalationRules: ["Escalate when the legal question depends on procedural nuance or overlapping proceedings."]
});

const DEFAULT_REGULATORY_PACK = makePack({
  id: "default-regulatory-approval",
  category: "default",
  resolutionArchetype: "regulatory_approval",
  sourcePriority: ["official regulator or agency", "court record if applicable", "Reuters/AP/Bloomberg", "major trade press"],
  queryFocusTerms: ["official approval", "agency filing", "order", "authorization", "approval date"],
  decisiveYesRules: ["YES requires an official regulator or agency action matching the market terms."],
  decisiveNoRules: ["NO requires an official denial, a non-qualifying decision, or the deadline passing without approval."],
  contradictionRules: ["Summaries and leaks do not outweigh the official agency record."],
  escalationRules: ["Escalate when the relevant agency action is unclear or only partially reported."]
});

const DEFAULT_NUMERIC_THRESHOLD_PACK = makePack({
  id: "default-numeric-threshold",
  category: "default",
  resolutionArchetype: "numeric_threshold",
  sourcePriority: ["official primary data source", "official result tables", "Reuters/AP/Bloomberg", "major domain press"],
  queryFocusTerms: ["official result", "final value", "threshold", "official table", "published figure"],
  decisiveYesRules: ["YES requires the official value to meet the stated threshold under the market rules."],
  decisiveNoRules: ["NO requires the official value to miss the threshold, or the deadline to pass without the threshold being met."],
  contradictionRules: ["Estimates and commentary never outweigh the official value or final result table."],
  escalationRules: ["Escalate when the official measurement source or threshold methodology is unclear."]
});

const POLICY_PACKS: PolicyPack[] = [
  DEFAULT_PACK,
  DEFAULT_WINNER_PACK,
  DEFAULT_RELEASE_PACK,
  DEFAULT_LEGAL_PACK,
  DEFAULT_REGULATORY_PACK,
  DEFAULT_NUMERIC_THRESHOLD_PACK,
  makePack({
    id: "politics-appointment",
    category: "politics",
    resolutionArchetype: "appointment_or_resignation",
    sourcePriority: ["White House or official government site", "campaign statement", "court filing", "Reuters/AP/Bloomberg"],
    queryFocusTerms: ["official resignation", "White House", "executive order", "25th amendment", "Congress"],
    decisiveYesRules: ["YES requires a formal resignation, removal, death, or another rule-consistent official loss of office."],
    decisiveNoRules: ["Before the deadline, do not force NO unless the event is clearly impossible under the rules."],
    contradictionRules: ["Commentary and rumor never outweigh an official filing or institutional statement."],
    escalationRules: ["Escalate when the market hinges on legal interpretation or unofficial reporting."]
  }),
  makePack({
    id: "crypto-threshold",
    category: "crypto",
    resolutionArchetype: "numeric_threshold",
    sourcePriority: ["resolution exchange/source", "issuer or regulator", "Reuters/Bloomberg", "major crypto trade press"],
    queryFocusTerms: ["price threshold", "official market data", "exchange close", "spot price"],
    decisiveYesRules: ["YES requires the threshold to be met by the specified official source or price methodology."],
    decisiveNoRules: ["NO requires the deadline to pass without the threshold, or a rule-consistent impossible condition."],
    contradictionRules: ["Ignore blogs or screenshots when official market data exists."],
    escalationRules: ["Escalate when source methodology is unclear or multiple price sources disagree."]
  }),
  makePack({
    id: "macro-threshold",
    category: "macro",
    resolutionArchetype: "numeric_threshold",
    sourcePriority: ["FRED/BLS/BEA/Federal Reserve", "official release calendar", "Reuters/Bloomberg", "major macro press"],
    queryFocusTerms: ["official economic data", "release", "reported value", "fred series"],
    decisiveYesRules: ["YES requires the threshold to be met by the official macro data series or release methodology described by the market."],
    decisiveNoRules: ["NO requires the official release to print outside the threshold, or the deadline to pass without the condition being met."],
    contradictionRules: ["Prefer official series data over commentary, previews, and analyst estimates."],
    escalationRules: ["Escalate when the exact indicator methodology, reference month, or transformation is unclear."]
  }),
  makePack({
    id: "sports-winner",
    category: "sports",
    resolutionArchetype: "winner_of_event",
    sourcePriority: ["league site", "official scoreboard", "team site", "AP/Reuters"],
    queryFocusTerms: ["official results", "scoreboard", "final", "series result"],
    decisiveYesRules: ["YES requires the official league result showing the team or player as winner."],
    decisiveNoRules: ["NO requires the official league result showing another winner or elimination."],
    contradictionRules: ["Ignore fan/social chatter when official league data exists."],
    escalationRules: ["Escalate only if official scoreboard is unavailable or clearly inconsistent."]
  }),
  makePack({
    id: "entertainment-release",
    category: "entertainment",
    resolutionArchetype: "release_or_launch",
    sourcePriority: ["official artist/studio/publisher", "IR or publisher release", "Reuters/AP/Bloomberg", "major entertainment press"],
    queryFocusTerms: ["official release date", "publisher announcement", "launch", "available now"],
    decisiveYesRules: ["YES requires public availability or an official release announcement matching the market rules."],
    decisiveNoRules: ["NO requires a superseding official delay beyond the deadline or the deadline passing without release."],
    contradictionRules: ["Teasers, rumors, and interviews about working on a project are not decisive release evidence."],
    escalationRules: ["Escalate when marketing hints conflict with official release channels."]
  }),
  makePack({
    id: "legal-outcome",
    category: "legal",
    resolutionArchetype: "legal_outcome",
    sourcePriority: ["court record", "official prosecutor or court statement", "Reuters/AP", "major legal press"],
    queryFocusTerms: ["court order", "sentencing", "official court record", "judgment"],
    decisiveYesRules: ["YES requires an official court outcome or equivalent authoritative legal record."],
    decisiveNoRules: ["NO requires the deadline to pass without the legal outcome, or a contrary official court result."],
    contradictionRules: ["Older cases or overturned outcomes should not be treated as current decisive evidence."],
    escalationRules: ["Escalate when the matter depends on procedural nuance, appeals, or overlapping cases."]
  }),
  makePack({
    id: "world-announcement",
    category: "world",
    resolutionArchetype: "official_announcement_by_deadline",
    sourcePriority: ["official government statement", "UN or treaty body", "Reuters/AP/Bloomberg", "major international press"],
    queryFocusTerms: ["official statement", "confirmed", "government announcement", "ceasefire", "invasion"],
    decisiveYesRules: ["YES requires a clear official confirmation of the geopolitical event described by the market."],
    decisiveNoRules: ["Before the deadline, prefer UNRESOLVED unless rules clearly permit an early NO."],
    contradictionRules: ["War rumors and analyst commentary are not decisive without official confirmation or overwhelming tier-1 consensus."],
    escalationRules: ["Escalate when wartime claims are conflicting or rely on partisan or social sources."]
  }),
  makePack({
    id: "technology-release",
    category: "technology",
    resolutionArchetype: "release_or_launch",
    sourcePriority: ["official company site", "official docs or blog", "company newsroom", "Reuters/Bloomberg", "major tech press"],
    queryFocusTerms: ["official release", "availability", "launch", "product page", "company announcement"],
    decisiveYesRules: ["YES requires public availability, an official launch announcement, or another rule-consistent company confirmation."],
    decisiveNoRules: ["NO requires a formal delay beyond the deadline, a clearly non-qualifying release, or the deadline passing without launch."],
    contradictionRules: ["Rumors, leaks, and model speculation are not decisive without official release channels."],
    escalationRules: ["Escalate when official blogs, docs, and media coverage diverge on whether a true public release happened."]
  }),
  makePack({
    id: "business-transaction",
    category: "business",
    resolutionArchetype: "official_announcement_by_deadline",
    sourcePriority: ["company IR or official newsroom", "counterparty official statement", "regulator filing", "Reuters/Bloomberg", "major business press"],
    queryFocusTerms: ["official announcement", "investor relations", "press release", "merger", "acquisition"],
    decisiveYesRules: ["YES requires an official company, counterparty, or regulator announcement matching the market terms."],
    decisiveNoRules: ["Before the deadline, prefer UNRESOLVED unless the event becomes impossible under the rules or a contrary official announcement settles it."],
    contradictionRules: ["Rumor coverage and anonymous sourcing do not outweigh issuer, counterparty, or filing-based evidence."],
    escalationRules: ["Escalate when official company language and media framing differ on whether a qualifying deal announcement occurred."]
  }),
  makePack({
    id: "business-negative-deadline",
    category: "business",
    resolutionArchetype: "negative_occurrence_by_deadline",
    sourcePriority: ["company IR or official newsroom", "regulator filing", "exchange listing page", "Reuters/Bloomberg", "major business press"],
    queryFocusTerms: ["official filing", "listing", "IPO", "investor relations", "exchange"],
    decisiveYesRules: ["YES usually requires the deadline to pass without the event, unless the rules allow an earlier impossible-state determination."],
    decisiveNoRules: ["NO requires an official launch, listing, or company/regulator confirmation that the event happened before the deadline."],
    contradictionRules: ["Speculation about future listing plans is not decisive without an official filing, listing page, or company statement."],
    escalationRules: ["Escalate when exchange pages, filings, and issuer language disagree on whether a qualifying listing or launch occurred."]
  }),
  makePack({
    id: "business-launch",
    category: "business",
    resolutionArchetype: "release_or_launch",
    sourcePriority: ["company IR or official site", "regulator filing", "Reuters/Bloomberg", "major trade press"],
    queryFocusTerms: ["official release", "IR", "earnings call", "company announcement"],
    decisiveYesRules: ["YES requires an official company release, IR statement, or equally authoritative launch confirmation."],
    decisiveNoRules: ["NO requires a formal delay or the deadline passing without launch or closing."],
    contradictionRules: ["Marketing chatter, leaks, and affiliate posts are not decisive."],
    escalationRules: ["Escalate when company IR and media framing diverge."]
  })
];

export function resolveAppliedPolicy(market: MarketContext): AppliedPolicy {
  const { category, resolutionArchetype } = market.canonicalMarket;
  const exact = POLICY_PACKS.find(
    (pack) => pack.category === category && pack.resolutionArchetype === resolutionArchetype
  );
  const categoryFallback = POLICY_PACKS.find(
    (pack) => pack.category === category && pack.resolutionArchetype === "official_announcement_by_deadline"
  );
  const archetypeFallback = POLICY_PACKS.find(
    (pack) => pack.category === "default" && pack.resolutionArchetype === resolutionArchetype
  );

  return AppliedPolicySchema.parse({
    pack: exact ?? categoryFallback ?? archetypeFallback ?? DEFAULT_PACK,
    researchPrompt: RESEARCH_PROMPT_TEMPLATE,
    opinionPrompt: OPINION_PROMPT_TEMPLATE
  });
}

function makePack(input: Omit<PolicyPack, "version" | "officialSourceRequired" | "earlyNoAllowed"> & Partial<Pick<PolicyPack, "version" | "officialSourceRequired" | "earlyNoAllowed">>): PolicyPack {
  return PolicyPackSchema.parse({
    version: "v1",
    officialSourceRequired: true,
    earlyNoAllowed: false,
    ...input
  });
}
