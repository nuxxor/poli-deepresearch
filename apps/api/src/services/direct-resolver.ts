import {
  ProviderResearchJudgmentSchema,
  type MarketContext,
  type MacroOfficialContext,
  type ProviderResearchJudgment,
  type ProviderSearchResultItem,
  type ProviderSearchRun,
  type ResolutionStatus
} from "@polymarket/deep-research-contracts";

import { env } from "../config.js";
import { buildMacroOfficialContext, estimateMacroObservationReadyAt } from "./macro-official.js";
import {
  extractOfficialDomainsForMarket,
  extractOfficialUrlsForMarket,
  extractResolutionFocusTopic
} from "./official-sources.js";
import { fetchFredSeriesWindow } from "./providers/fred.js";
import { buildSuccessRun, fetchWithRetry } from "./providers/shared.js";
import { dedupeStrings } from "./urls.js";

const ONE_MINUTE_MS = 60_000;
const DIRECT_PROVIDER = "direct-official-feed";
const PUBLIC_DATA_HEADERS = {
  Accept: "text/plain, application/json;q=0.9, */*;q=0.8",
  "User-Agent": "polymarket-deep-research/0.1 (+https://polymarket.com)"
};

const POLYMARKET_RESOLUTION_YES_THRESHOLD = 0.995;
const POLYMARKET_RESOLUTION_NO_THRESHOLD = 0.005;

type DirectLegacyState = "YES" | "NO" | "UNRESOLVED" | "CONTRADICTORY" | "NEEDS_HUMAN";

type DirectJudgmentInput = {
  provider?: string;
  ok?: boolean;
  parseMode?: string;
  state: DirectLegacyState;
  researchConfidence: number;
  why: string;
  citations: ProviderSearchResultItem[];
  rawAnswer: string;
  raw: ProviderSearchRun;
  // Legacy / ignored — accepted to keep call sites intact:
  officialSourceUsed?: boolean;
  contradictionDetected?: boolean;
  needsEscalation?: boolean;
  decisiveEvidence?: string[];
  missingEvidence?: string[];
};

function buildDirectJudgment(args: DirectJudgmentInput): ProviderResearchJudgment {
  const resolutionStatus: ResolutionStatus =
    args.state === "YES" ? "RESOLVED_YES" : args.state === "NO" ? "RESOLVED_NO" : "NOT_YET_RESOLVED";

  return ProviderResearchJudgmentSchema.parse({
    provider: DIRECT_PROVIDER,
    ok: true,
    parseMode: "direct",
    resolutionStatus,
    resolutionConfidence: args.researchConfidence,
    reasoning: args.why,
    why: args.why,
    citations: args.citations,
    rawAnswer: args.rawAnswer,
    raw: args.raw
  });
}

export type DirectOfficialResolution = {
  primary: ProviderResearchJudgment;
  nextCheckAt?: string;
  macroOfficialContext?: MacroOfficialContext;
};

type ThresholdSpec =
  | {
      kind: "range";
      min: number;
      max: number;
      lowerInclusive: boolean;
      upperInclusive: boolean;
    }
  | {
      kind: "above";
      threshold: number;
      inclusive: boolean;
    }
  | {
      kind: "below";
      threshold: number;
      inclusive: boolean;
    };

type BinanceDirectSpec = {
  symbol: string;
  interval: "1m";
  targetOpenTimeMs: number;
  resolutionReadyAtMs: number;
  threshold: ThresholdSpec;
  officialTradeUrl: string;
  klineUrl: string;
};

type BinanceHighDirectSpec = {
  symbol: string;
  threshold: number;
  deadlineMs: number;
  officialTradeUrl: string;
  historyUrl: string;
  startTimeMs: number;
};

type CryptoLaunchMetricDirectSpec = {
  projectName: string;
  deadlineMs: number;
  officialUrls: string[];
};

type KlineRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

type NhlStandingsPayload = {
  standingsDateTimeUtc?: string;
  standings?: Array<{
    clinchIndicator?: string | null;
    leagueSequence?: number;
    points?: number;
    teamName?: {
      default?: string;
    };
    teamCommonName?: {
      default?: string;
    };
    teamAbbrev?: {
      default?: string;
    };
  }>;
};

type NhlBracketPayload = {
  bracketTitle?: {
    default?: string;
  };
  series?: Array<{
    playoffRound?: number;
    topSeedWins?: number;
    bottomSeedWins?: number;
    topSeedTeam?: {
      abbrev?: string;
      name?: {
        default?: string;
      };
    };
    bottomSeedTeam?: {
      abbrev?: string;
      name?: {
        default?: string;
      };
    };
  }>;
};

type NhcCurrentStormsPayload = {
  activeStorms?: unknown[];
};

type CompanyIpoDirectSpec = {
  companyName: string;
  deadlineMs: number;
  officialUrls: string[];
};

type CompanyReleaseDirectSpec = {
  companyName?: string;
  releaseTopic: string;
  deadlineMs: number;
  officialUrls: string[];
  category: string;
};

type EntertainmentAlbumDirectSpec = {
  artistName: string;
  baselineReleasedAfterMs: number;
  deadlineMs: number;
  officialSearchUrl: string;
};

type AppleAlbumSearchResult = {
  artistName?: string;
  collectionName?: string;
  collectionViewUrl?: string;
  releaseDate?: string;
  collectionType?: string;
  trackCount?: number;
};

type CompanyTransactionDirectSpec = {
  companyName: string;
  targetName: string;
  deadlineMs: number;
  officialUrls: string[];
};

type FedCutsDirectSpec = {
  targetYear: number;
  targetCuts: number;
  deadlineMs: number;
  upperSeriesId: "DFEDTARU";
  officialCalendarUrl: string;
  officialOpenMarketUrl: string;
};

type PresidentOutDirectSpec = {
  personName: string;
  deadlineMs: number;
  administrationUrl: string;
  authorityName: string;
};

type PardonDirectSpec = {
  principalName: string;
  subjectName: string;
  deadlineMs: number;
  officialSearchUrl: string;
};

type PartyNominationDirectSpec = {
  candidateName: string;
  partyName: "Democratic" | "Republican";
  targetYear: number;
  deadlineMs: number;
  officialPartyUrl: string;
};

type PresidentialElectionDirectSpec = {
  candidateName: string;
  targetYear: number;
  deadlineMs: number;
  officialElectionUrl: string;
};

type WorldOfficialSignalDirectSpec = {
  eventKind: "ceasefire" | "invasion";
  eventLabel: string;
  subjectAliases: string[];
  deadlineMs: number;
  officialUrls: string[];
};

type RecessionQuarter = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  index: number;
};

type RecessionDirectSpec = {
  startQuarter: RecessionQuarter;
  endQuarter: RecessionQuarter;
  deadlineMs: number;
  beaUrl: string;
  nberUrl: string;
};

export async function tryResolveDirectOfficialMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const polymarketClosedResolution = tryResolveClosedPolymarketBinaryMarket(market);
  if (polymarketClosedResolution) {
    return polymarketClosedResolution;
  }

  const binanceHighResolution = await tryResolveBinanceHighDirectMarket(market);
  if (binanceHighResolution) {
    return binanceHighResolution;
  }

  const binanceResolution = await tryResolveBinanceDirectMarket(market);
  if (binanceResolution) {
    return binanceResolution;
  }

  const fedCutsResolution = await tryResolveFedCutsDirectMarket(market);
  if (fedCutsResolution) {
    return fedCutsResolution;
  }

  const recessionResolution = await tryResolveRecessionDirectMarket(market);
  if (recessionResolution) {
    return recessionResolution;
  }

  const cryptoLaunchMetricResolution = await tryResolveCryptoLaunchMetricDirectMarket(market);
  if (cryptoLaunchMetricResolution) {
    return cryptoLaunchMetricResolution;
  }

  const macroResolution = await tryResolveMacroDirectMarket(market);
  if (macroResolution) {
    return macroResolution;
  }

  const sportsResolution = await tryResolveNhlCupDirectMarket(market);
  if (sportsResolution) {
    return sportsResolution;
  }

  const companyIpoResolution = await tryResolveCompanyIpoDirectMarket(market);
  if (companyIpoResolution) {
    return companyIpoResolution;
  }

  const companyReleaseResolution = await tryResolveCompanyReleaseDirectMarket(market);
  if (companyReleaseResolution) {
    return companyReleaseResolution;
  }

  const entertainmentAlbumResolution = await tryResolveEntertainmentAlbumDirectMarket(market);
  if (entertainmentAlbumResolution) {
    return entertainmentAlbumResolution;
  }

  const companyTransactionResolution = await tryResolveCompanyTransactionDirectMarket(market);
  if (companyTransactionResolution) {
    return companyTransactionResolution;
  }

  const presidentOutResolution = await tryResolvePresidentOutDirectMarket(market);
  if (presidentOutResolution) {
    return presidentOutResolution;
  }

  const pardonResolution = await tryResolvePardonDirectMarket(market);
  if (pardonResolution) {
    return pardonResolution;
  }

  const worldOfficialSignalResolution = await tryResolveWorldOfficialSignalDirectMarket(market);
  if (worldOfficialSignalResolution) {
    return worldOfficialSignalResolution;
  }

  const partyNominationResolution = await tryResolvePartyNominationDirectMarket(market);
  if (partyNominationResolution) {
    return partyNominationResolution;
  }

  const presidentialElectionResolution = await tryResolvePresidentialElectionDirectMarket(market);
  if (presidentialElectionResolution) {
    return presidentialElectionResolution;
  }

  const weatherResolution = await tryResolveWeatherDirectMarket(market);
  if (weatherResolution) {
    return weatherResolution;
  }

  return null;
}

function tryResolveClosedPolymarketBinaryMarket(
  market: MarketContext
): DirectOfficialResolution | null {
  if (market.rawMarket.closed !== true) {
    return null;
  }

  const outcomes = parseStringArray(market.rawMarket.outcomes);
  const prices = parseNumberArray(market.rawMarket.outcomePrices);
  if (outcomes.length !== 2 || prices.length !== 2) {
    return null;
  }

  const yesIndex = outcomes.findIndex((label) => /^yes$/i.test(label.trim()));
  const noIndex = outcomes.findIndex((label) => /^no$/i.test(label.trim()));
  if (yesIndex === -1 || noIndex === -1) {
    return null;
  }

  const yesPrice = prices[yesIndex];
  const noPrice = prices[noIndex];
  if (yesPrice == null || noPrice == null) {
    return null;
  }

  const resolvedState =
    yesPrice >= POLYMARKET_RESOLUTION_YES_THRESHOLD && noPrice <= POLYMARKET_RESOLUTION_NO_THRESHOLD
      ? "YES"
      : noPrice >= POLYMARKET_RESOLUTION_YES_THRESHOLD && yesPrice <= POLYMARKET_RESOLUTION_NO_THRESHOLD
        ? "NO"
        : null;

  if (!resolvedState) {
    return null;
  }

  const marketUrl = market.canonicalMarket.slug
    ? `https://polymarket.com/event/${market.canonicalMarket.slug}`
    : `https://polymarket.com/market/${market.canonicalMarket.marketId}`;
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query: `Resolve ${market.canonicalMarket.title} from closed Polymarket settlement state.`,
    durationMs: 0,
    resultCount: 1,
    estimatedRetrievalCostUsd: 0,
    results: [
      {
        title: `Polymarket market page for ${market.canonicalMarket.title}`,
        url: marketUrl,
        snippet: `Closed Polymarket market with binary outcomes ${outcomes.join(" / ")} and prices ${prices.join(" / ")}.`,
        source: "official"
      }
    ],
    meta: {
      source: "polymarket-closed-market",
      closed: market.rawMarket.closed,
      active: market.rawMarket.active,
      outcomes,
      outcomePrices: prices
    }
  });

  return {
    primary: buildDirectJudgment({
      state: resolvedState,
      researchConfidence: 0.995,
      why:
        resolvedState === "YES"
          ? `This Polymarket market is already closed and its binary outcome prices are settled at YES=${yesPrice} / NO=${noPrice}, so the market resolves YES.`
          : `This Polymarket market is already closed and its binary outcome prices are settled at YES=${yesPrice} / NO=${noPrice}, so the market resolves NO.`,
      citations: run.results,
      rawAnswer: `Closed Polymarket settlement resolved the market ${resolvedState}.`,
      raw: run
    })
  };
}

export function estimateDirectMarketNextCheckAt(market: MarketContext): string | null {
  const binanceHighSpec = buildBinanceHighDirectSpec(market);
  if (binanceHighSpec) {
    return new Date(Math.min(binanceHighSpec.deadlineMs, Date.now() + 6 * 60 * 60 * 1000)).toISOString();
  }

  const binanceSpec = buildBinanceDirectSpec(market);
  if (binanceSpec) {
    return new Date(binanceSpec.resolutionReadyAtMs).toISOString();
  }

  const fedCutsSpec = parseFedCutsDirectSpec(market);
  if (fedCutsSpec) {
    return estimateFedCutsNextCheckAt(fedCutsSpec);
  }

  const recessionSpec = parseRecessionDirectSpec(market);
  if (recessionSpec) {
    return estimateRecessionNextCheckAt(recessionSpec, undefined);
  }

  const cryptoLaunchMetricSpec = parseCryptoLaunchMetricDirectSpec(market);
  if (cryptoLaunchMetricSpec) {
    return new Date(Math.min(cryptoLaunchMetricSpec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString();
  }

  const nhlSpec = parseNhlCupDirectSpec(market);
  if (nhlSpec) {
    return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  }

  const companyIpoSpec = parseCompanyIpoDirectSpec(market);
  if (companyIpoSpec) {
    return new Date(Math.min(companyIpoSpec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString();
  }

  const companyReleaseSpec = parseCompanyReleaseDirectSpec(market);
  if (companyReleaseSpec) {
    return new Date(Math.min(companyReleaseSpec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString();
  }

  const entertainmentAlbumSpec = parseEntertainmentAlbumDirectSpec(market);
  if (entertainmentAlbumSpec) {
    return new Date(Math.min(entertainmentAlbumSpec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString();
  }

  const companyTransactionSpec = parseCompanyTransactionDirectSpec(market);
  if (companyTransactionSpec) {
    return new Date(Math.min(companyTransactionSpec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString();
  }

  const presidentOutSpec = parsePresidentOutDirectSpec(market);
  if (presidentOutSpec) {
    return new Date(Math.min(presidentOutSpec.deadlineMs, Date.now() + 24 * 60 * 60 * 1000)).toISOString();
  }

  const pardonSpec = parsePardonDirectSpec(market);
  if (pardonSpec) {
    return new Date(Math.min(pardonSpec.deadlineMs, Date.now() + 24 * 60 * 60 * 1000)).toISOString();
  }

  const worldOfficialSignalSpec = parseWorldOfficialSignalDirectSpec(market);
  if (worldOfficialSignalSpec) {
    return new Date(Math.min(worldOfficialSignalSpec.deadlineMs, Date.now() + 6 * 60 * 60 * 1000)).toISOString();
  }

  const partyNominationSpec = parsePartyNominationDirectSpec(market);
  if (partyNominationSpec) {
    return new Date(Math.min(partyNominationSpec.deadlineMs, Date.UTC(partyNominationSpec.targetYear, 0, 1))).toISOString();
  }

  const presidentialElectionSpec = parsePresidentialElectionDirectSpec(market);
  if (presidentialElectionSpec) {
    return new Date(Math.min(presidentialElectionSpec.deadlineMs, Date.UTC(presidentialElectionSpec.targetYear, 0, 1))).toISOString();
  }

  const hottestYearSpec = parseNasaHotYearSpec(market);
  if (hottestYearSpec) {
    return estimateNasaAnnualReleaseAt(hottestYearSpec.targetYear);
  }

  const hurricaneSpec = parseNhcHurricaneLandfallSpec(market);
  if (hurricaneSpec) {
    return new Date(Math.min(hurricaneSpec.deadlineMs, Date.now() + 6 * 60 * 60 * 1000)).toISOString();
  }

  return estimateMacroObservationReadyAt(market);
}

async function tryResolveBinanceDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = buildBinanceDirectSpec(market);
  if (!spec) {
    return null;
  }

  const query = `Resolve ${market.canonicalMarket.title} from official Binance ${spec.symbol} ${spec.interval} kline data.`;
  const citations = buildDirectCitations(spec);

  if (Date.now() < spec.resolutionReadyAtMs) {
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: 0,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "binance-direct",
        symbol: spec.symbol,
        interval: spec.interval,
        targetOpenTimeUtc: new Date(spec.targetOpenTimeMs).toISOString(),
        resolutionReadyAtUtc: new Date(spec.resolutionReadyAtMs).toISOString(),
        threshold: describeThreshold(spec.threshold)
      }
    });

    return {
      nextCheckAt: new Date(spec.resolutionReadyAtMs).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.98,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `This market resolves from the official Binance ${spec.interval} candle labeled ${new Date(spec.targetOpenTimeMs).toISOString()}. That candle has not fully closed yet, so the market remains unresolved.`,
        decisiveEvidence: [
          `Official source is Binance ${spec.symbol} ${spec.interval} kline data.`,
          `Resolution becomes actionable after ${new Date(spec.resolutionReadyAtMs).toISOString()}.`
        ],
        missingEvidence: [
          `Official Binance ${spec.symbol} ${spec.interval} close price for the target candle`
        ],
        citations,
        rawAnswer: "Direct official resolver deferred until the target Binance candle is complete.",
        raw: run
      })
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetchWithRetry(spec.klineUrl, {
      headers: {
        Accept: "application/json"
      }
    }, {
      maxAttempts: 2,
      baseDelayMs: 750
    });

    const payload = (await response.json()) as unknown;
    if (!response.ok || !Array.isArray(payload)) {
      return null;
    }

    const klines = payload.filter(Array.isArray) as KlineRow[];
    const match = selectTargetKline(klines, spec.targetOpenTimeMs);
    if (!match) {
      return null;
    }

    const closePrice = Number.parseFloat(match.row[4]);
    if (!Number.isFinite(closePrice)) {
      return null;
    }

    const state = evaluateThreshold(closePrice, spec.threshold);
    const confidence = match.mode === "exact_open_time" ? 0.995 : 0.93;
    const decisiveEvidence = [
      `Official Binance ${spec.symbol} ${spec.interval} close price was ${closePrice.toLocaleString("en-US", {
        maximumFractionDigits: 8
      })}.`,
      `Threshold rule: ${describeThreshold(spec.threshold)}.`
    ];

    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "binance-direct",
        symbol: spec.symbol,
        interval: spec.interval,
        targetOpenTimeUtc: new Date(spec.targetOpenTimeMs).toISOString(),
        targetCloseTimeUtc: new Date(match.row[6] + 1).toISOString(),
        threshold: describeThreshold(spec.threshold),
        closePrice,
        openTimeUtc: new Date(match.row[0]).toISOString(),
        closeTimeUtc: new Date(match.row[6] + 1).toISOString(),
        selectionMode: match.mode
      }
    });

    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state,
        researchConfidence: confidence,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official Binance ${spec.symbol} ${spec.interval} kline data resolves this market ${state}. The observed close price was ${closePrice.toLocaleString("en-US", {
          maximumFractionDigits: 8
        })}, and the market condition is ${describeThreshold(spec.threshold)}.`,
        decisiveEvidence,
        missingEvidence: [],
        citations,
        rawAnswer: `Official Binance direct resolver returned ${state} from close price ${closePrice}.`,
        raw: run
      })
    };
  } catch {
    return null;
  }
}

async function tryResolveBinanceHighDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = buildBinanceHighDirectSpec(market);
  if (!spec) {
    return null;
  }

  const query = `Resolve ${market.canonicalMarket.title} from official Binance ${spec.symbol} high prices.`;
  const citations: ProviderSearchResultItem[] = [
    {
      title: `Binance ${spec.symbol} trading page`,
      url: spec.officialTradeUrl,
      snippet: `Official ${spec.symbol} market page used by the market rules.`,
      source: "official"
    },
    {
      title: `Binance ${spec.symbol} daily klines`,
      url: spec.historyUrl,
      snippet: "Official Binance market-data endpoint used to detect whether the threshold has already been hit.",
      source: "official"
    }
  ];

  const startedAt = Date.now();
  try {
    const response = await fetchWithRetry(spec.historyUrl, {
      headers: {
        Accept: "application/json"
      }
    }, {
      maxAttempts: 2,
      baseDelayMs: 750
    });

    const payload = (await response.json()) as unknown;
    if (!response.ok || !Array.isArray(payload)) {
      return null;
    }

    const klines = payload.filter(Array.isArray) as KlineRow[];
    const highs = klines
      .map((row) => Number.parseFloat(row[2]))
      .filter((value) => Number.isFinite(value));
    const maxHigh = highs.length > 0 ? Math.max(...highs) : null;
    if (maxHigh == null) {
      return null;
    }

    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "binance-high-direct",
        symbol: spec.symbol,
        threshold: spec.threshold,
        maxHigh,
        deadlineUtc: new Date(spec.deadlineMs).toISOString()
      }
    });

    if (maxHigh >= spec.threshold) {
      return {
        primary: buildDirectJudgment({
          provider: DIRECT_PROVIDER,
          ok: true,
          parseMode: "direct",
          state: "YES",
          researchConfidence: 0.99,
          officialSourceUsed: true,
          contradictionDetected: false,
          needsEscalation: false,
          why: `Official Binance high-price data already reached ${formatMetricValue(maxHigh)}, which is at or above the required threshold ${formatMetricValue(spec.threshold)}.`,
          decisiveEvidence: [
            `Official Binance ${spec.symbol} observed max high was ${formatMetricValue(maxHigh)}.`,
            `Threshold rule: any 1-minute candle high at or above ${formatMetricValue(spec.threshold)}.`
          ],
          missingEvidence: [],
          citations,
          rawAnswer: `Direct Binance high resolver returned YES because max observed high ${maxHigh} reached the threshold ${spec.threshold}.`,
          raw: run
        })
      };
    }

    if (Date.now() >= spec.deadlineMs) {
      return {
        primary: buildDirectJudgment({
          provider: DIRECT_PROVIDER,
          ok: true,
          parseMode: "direct",
          state: "NO",
          researchConfidence: 0.97,
          officialSourceUsed: true,
          contradictionDetected: false,
          needsEscalation: false,
          why: `Official Binance high-price data never reached the required threshold ${formatMetricValue(spec.threshold)} before the market deadline.`,
          decisiveEvidence: [
            `Official Binance ${spec.symbol} max high before deadline was ${formatMetricValue(maxHigh)}.`,
            `Threshold rule: any 1-minute candle high at or above ${formatMetricValue(spec.threshold)}.`
          ],
          missingEvidence: [],
          citations,
          rawAnswer: `Direct Binance high resolver returned NO because max observed high ${maxHigh} stayed below the threshold ${spec.threshold}.`,
          raw: run
        })
      };
    }

    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 6 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.97,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official Binance high-price data has not reached the required threshold ${formatMetricValue(spec.threshold)} yet. Before the deadline, this market remains unresolved.`,
        decisiveEvidence: [
          `Official Binance ${spec.symbol} max high so far is ${formatMetricValue(maxHigh)}.`,
          `Threshold rule: any 1-minute candle high at or above ${formatMetricValue(spec.threshold)}.`
        ],
        missingEvidence: [
          `Official Binance ${spec.symbol} high price at or above ${formatMetricValue(spec.threshold)} before the deadline`
        ],
        citations,
        rawAnswer: `Direct Binance high resolver kept the market unresolved because max observed high ${maxHigh} is still below threshold ${spec.threshold}.`,
        raw: run
      })
    };
  } catch {
    return null;
  }
}

async function tryResolveFedCutsDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseFedCutsDirectSpec(market);
  if (!spec || !env.FRED_API_KEY) {
    return null;
  }

  const observations = await fetchFredObservationsForFedCuts(spec).catch(() => null);
  if (!observations || observations.length < 2) {
    return null;
  }

  const events = countFedCutEvents(observations, spec.targetYear);
  const cutsSoFar = events.reduce((sum, event) => sum + event.cutCount, 0);
  const query = `Resolve ${market.canonicalMarket.title} from official Federal Reserve target range changes in ${spec.targetYear}.`;
  const citations = buildFedCutsDirectCitations(spec, events);

  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: 0,
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "fed-cuts-direct",
      targetYear: spec.targetYear,
      targetCuts: spec.targetCuts,
      cutsSoFar,
      events: events.map((event) => ({
        date: event.date,
        previousUpper: event.previousUpper,
        nextUpper: event.nextUpper,
        deltaBps: event.deltaBps,
        cutCount: event.cutCount
      }))
    }
  });

  if (cutsSoFar > spec.targetCuts) {
    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "NO",
        researchConfidence: 0.99,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official Federal Reserve target range data shows ${cutsSoFar} cuts in ${spec.targetYear} already, which is more than the market strike of ${spec.targetCuts}. That makes this market an early NO.`,
        decisiveEvidence: buildFedCutsEvidence(events, spec).slice(0, 3),
        missingEvidence: [],
        citations,
        rawAnswer: `Direct Fed-cuts resolver returned NO because ${cutsSoFar} cuts already exceed the strike ${spec.targetCuts}.`,
        raw: run
      })
    };
  }

  if (Date.now() >= spec.deadlineMs) {
    const state: DirectLegacyState = cutsSoFar === spec.targetCuts ? "YES" : "NO";
    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state,
        researchConfidence: 0.98,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `The official Federal Reserve target range recorded ${cutsSoFar} total cuts in ${spec.targetYear}. The market strike is ${spec.targetCuts}, so the market resolves ${state}.`,
        decisiveEvidence: buildFedCutsEvidence(events, spec).slice(0, 3),
        missingEvidence: [],
        citations,
        rawAnswer: `Direct Fed-cuts resolver returned ${state} from ${cutsSoFar} total cuts versus strike ${spec.targetCuts}.`,
        raw: run
      })
    };
  }

  return {
    nextCheckAt: estimateFedCutsNextCheckAt(spec),
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "UNRESOLVED",
      researchConfidence: 0.97,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `Official Federal Reserve target range data shows ${cutsSoFar} cuts so far in ${spec.targetYear}. The market only resolves early to NO if cuts exceed the strike, so it remains unresolved for now.`,
      decisiveEvidence: buildFedCutsEvidence(events, spec).slice(0, 3),
      missingEvidence: [
        `Additional official Federal Reserve target range changes through the end of ${spec.targetYear}`
      ],
      citations,
      rawAnswer: `Direct Fed-cuts resolver kept the market unresolved with ${cutsSoFar} cuts so far versus strike ${spec.targetCuts}.`,
      raw: run
    })
  };
}

async function tryResolveCryptoLaunchMetricDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseCryptoLaunchMetricDirectSpec(market);
  if (!spec || Date.now() >= spec.deadlineMs) {
    return null;
  }

  const citations: ProviderSearchResultItem[] = spec.officialUrls.map((url) => ({
    title: `Official ${spec.projectName} source`,
    url,
    snippet: `Official ${spec.projectName} source checked for token launch, TGE, listing, or trading signals.`,
    source: "official"
  }));
  const query = `Resolve ${market.canonicalMarket.title} from official ${spec.projectName} token launch sources.`;
  const signals = (
    await Promise.all(spec.officialUrls.slice(0, 4).map((url) => fetchCryptoLaunchSignal(url, spec.projectName)))
  ).filter((item): item is Awaited<ReturnType<typeof fetchCryptoLaunchSignal>> & { ok: true } => Boolean(item?.ok));

  if (signals.length === 0) {
    return null;
  }

  const positive = signals.find((signal) => signal.launchDetected);
  if (positive) {
    return null;
  }

  const checkedEvidence = signals.map((signal) => `${signal.url}: ${signal.summary}`);
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: signals.reduce((max, item) => Math.max(max, item.durationMs), 0),
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "crypto-launch-metric-direct",
      projectName: spec.projectName,
      checkedUrls: signals.map((item) => item.url)
    }
  });

  return {
    nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString(),
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "UNRESOLVED",
      researchConfidence: 0.88,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `Checked official ${spec.projectName} sources and found no clear token launch, TGE, listing, or live trading signal yet. Before the deadline, this post-launch FDV market remains unresolved.`,
      decisiveEvidence: checkedEvidence.slice(0, 3),
      missingEvidence: [
        `Official ${spec.projectName} confirmation of token launch or live trading before the deadline`,
        "A qualifying liquid price source one day after launch"
      ],
      citations,
      rawAnswer: `Direct crypto launch-metric resolver found no official launch signal yet for ${spec.projectName}; market remains unresolved before deadline.`,
      raw: run
    })
  };
}

async function tryResolveCompanyIpoDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseCompanyIpoDirectSpec(market);
  if (!spec) {
    return null;
  }

  const citations: ProviderSearchResultItem[] = spec.officialUrls.map((url) => ({
    title: `Official issuer source for ${spec.companyName}`,
    url,
    snippet: `Official issuer, investor-relations, or newsroom page checked for ${spec.companyName} listing and IPO signals.`,
    source: "official"
  }));
  const query = `Resolve ${market.canonicalMarket.title} from official issuer, IR, and listing announcement pages.`;

  const pageSignals = (
    await Promise.all(spec.officialUrls.slice(0, 4).map((url) => fetchCompanyOfficialSignal(url)))
  ).filter((item): item is Awaited<ReturnType<typeof fetchCompanyOfficialSignal>> & { ok: true } => Boolean(item?.ok));

  if (pageSignals.length === 0) {
    return null;
  }

  const positiveSignal = pageSignals.find((signal) => signal.listingDetected);
  const checkedEvidence = pageSignals.map((signal) => `${signal.url}: ${signal.summary}`);
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: pageSignals.reduce((max, item) => Math.max(max, item.durationMs), 0),
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "company-ipo-direct",
      companyName: spec.companyName,
      deadlineUtc: new Date(spec.deadlineMs).toISOString(),
      checkedUrls: pageSignals.map((item) => item.url),
      positiveSignal: positiveSignal?.url ?? null
    }
  });

  if (positiveSignal) {
    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "NO",
        researchConfidence: 0.95,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official issuer or investor-relations pages show that ${spec.companyName} has already entered public trading or announced a qualifying IPO/listing event, so this "not IPO" market resolves NO.`,
        decisiveEvidence: [
          positiveSignal.summary,
          ...checkedEvidence.slice(0, 2)
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct company IPO resolver found an official listing signal for ${spec.companyName}.`,
        raw: run
      })
    };
  }

  if (Date.now() < spec.deadlineMs) {
    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.86,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Checked official issuer and investor-relations pages for ${spec.companyName}; no qualifying IPO or listing signal was found yet, and the deadline has not passed.`,
        decisiveEvidence: checkedEvidence.slice(0, 3),
        missingEvidence: [
          `Official issuer, exchange, or regulator confirmation that ${spec.companyName} has begun trading before the deadline`
        ],
        citations,
        rawAnswer: `Direct company IPO resolver found no official listing signal yet for ${spec.companyName}; market remains unresolved before deadline.`,
        raw: run
      })
    };
  }

  return {
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "YES",
      researchConfidence: 0.9,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `The deadline has passed and official issuer, exchange, and investor-relations pages checked for ${spec.companyName} do not show a qualifying IPO or listing signal. This "not IPO" market therefore resolves YES.`,
      decisiveEvidence: checkedEvidence.slice(0, 3),
      missingEvidence: [],
      citations,
      rawAnswer: `Direct company IPO resolver returned YES after the deadline passed without an official listing signal for ${spec.companyName}.`,
      raw: run
    })
  };
}

async function tryResolveCompanyReleaseDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseCompanyReleaseDirectSpec(market);
  if (!spec) {
    return null;
  }

  const citations: ProviderSearchResultItem[] = spec.officialUrls.map((url) => ({
    title: `Official release source for ${spec.releaseTopic}`,
    url,
    snippet: `Official company, docs, blog, or newsroom page checked for ${spec.releaseTopic} release signals.`,
    source: "official"
  }));
  const query = `Resolve ${market.canonicalMarket.title} from official company release, docs, and product pages.`;

  const pageSignals = await collectOkSignals(
    spec.officialUrls,
    (url) => fetchCompanyReleaseSignal(url, spec),
    3
  );

  if (pageSignals.length === 0) {
    return null;
  }

  const positiveSignal = pageSignals.find((signal) => signal.releaseDetected);
  const checkedEvidence = pageSignals.map((signal) => `${signal.url}: ${signal.summary}`);
  const extractionCostUsd = pageSignals.reduce((sum, signal) => sum + signal.extractionCostUsd, 0);
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: pageSignals.reduce((max, item) => Math.max(max, item.durationMs), 0),
    resultCount: citations.length,
    estimatedRetrievalCostUsd: extractionCostUsd,
    results: citations,
    meta: {
      source: "company-release-direct",
      companyName: spec.companyName ?? null,
      releaseTopic: spec.releaseTopic,
      deadlineUtc: new Date(spec.deadlineMs).toISOString(),
      checkedUrls: pageSignals.map((item) => item.url),
      positiveSignal: positiveSignal?.url ?? null,
      extractionCostUsd
    }
  });

  if (positiveSignal) {
    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "YES",
        researchConfidence: 0.94,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official company release pages show a qualifying launch or public availability signal for ${spec.releaseTopic}, so this market resolves YES.`,
        decisiveEvidence: [
          positiveSignal.summary,
          ...checkedEvidence.slice(0, 2)
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct company release resolver found an official release signal for ${spec.releaseTopic}.`,
        raw: run
      })
    };
  }

  if (Date.now() < spec.deadlineMs) {
    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.84,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Checked official company release channels for ${spec.releaseTopic}; no qualifying public release or launch signal was found yet, and the deadline has not passed.`,
        decisiveEvidence: checkedEvidence.slice(0, 3),
        missingEvidence: [
          `Official company confirmation that ${spec.releaseTopic} is publicly released or available before the deadline`
        ],
        citations,
        rawAnswer: `Direct company release resolver found no official public release signal yet for ${spec.releaseTopic}; market remains unresolved before deadline.`,
        raw: run
      })
    };
  }

  return {
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "NO",
      researchConfidence: 0.9,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `The deadline has passed and official company release channels checked for ${spec.releaseTopic} do not show a qualifying public release or launch signal. This market therefore resolves NO.`,
      decisiveEvidence: checkedEvidence.slice(0, 3),
      missingEvidence: [],
      citations,
      rawAnswer: `Direct company release resolver returned NO after the deadline passed without an official launch signal for ${spec.releaseTopic}.`,
      raw: run
    })
  };
}

async function tryResolveCompanyTransactionDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseCompanyTransactionDirectSpec(market);
  if (!spec) {
    return null;
  }

  const citations: ProviderSearchResultItem[] = spec.officialUrls.map((url) => ({
    title: `Official transaction source for ${spec.companyName} / ${spec.targetName}`,
    url,
    snippet: `Official company or target page checked for acquisition or merger signals involving ${spec.companyName} and ${spec.targetName}.`,
    source: "official"
  }));
  const query = `Resolve ${market.canonicalMarket.title} from official company, counterparty, and newsroom pages.`;

  const pageSignals = await collectOkSignals(
    spec.officialUrls,
    (url) => fetchCompanyTransactionSignal(url, spec),
    3
  );

  if (pageSignals.length === 0) {
    return null;
  }

  const positiveSignal = pageSignals.find((signal) => signal.transactionDetected);
  const checkedEvidence = pageSignals.map((signal) => `${signal.url}: ${signal.summary}`);
  const extractionCostUsd = pageSignals.reduce((sum, signal) => sum + signal.extractionCostUsd, 0);
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: pageSignals.reduce((max, item) => Math.max(max, item.durationMs), 0),
    resultCount: citations.length,
    estimatedRetrievalCostUsd: extractionCostUsd,
    results: citations,
    meta: {
      source: "company-transaction-direct",
      companyName: spec.companyName,
      targetName: spec.targetName,
      deadlineUtc: new Date(spec.deadlineMs).toISOString(),
      checkedUrls: pageSignals.map((item) => item.url),
      positiveSignal: positiveSignal?.url ?? null,
      extractionCostUsd
    }
  });

  if (positiveSignal) {
    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "YES",
        researchConfidence: 0.95,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official company or target pages show a qualifying acquisition or merger announcement involving ${spec.companyName} and ${spec.targetName}, so this market resolves YES.`,
        decisiveEvidence: [
          positiveSignal.summary,
          ...checkedEvidence.slice(0, 2)
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct company transaction resolver found an official acquisition or merger signal for ${spec.companyName} and ${spec.targetName}.`,
        raw: run
      })
    };
  }

  if (Date.now() < spec.deadlineMs) {
    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.84,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Checked official company and target pages for a qualifying acquisition or merger announcement involving ${spec.companyName} and ${spec.targetName}; no official signal was found yet, and the deadline has not passed.`,
        decisiveEvidence: checkedEvidence.slice(0, 3),
        missingEvidence: [
          `Official company or target announcement confirming an acquisition or merger involving ${spec.companyName} and ${spec.targetName} before the deadline`
        ],
        citations,
        rawAnswer: `Direct company transaction resolver found no official deal announcement yet for ${spec.companyName} and ${spec.targetName}; market remains unresolved before deadline.`,
        raw: run
      })
    };
  }

  return {
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "NO",
      researchConfidence: 0.9,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `The deadline has passed and official company and target pages checked for ${spec.companyName} and ${spec.targetName} do not show a qualifying acquisition or merger announcement. This market therefore resolves NO.`,
      decisiveEvidence: checkedEvidence.slice(0, 3),
      missingEvidence: [],
      citations,
      rawAnswer: `Direct company transaction resolver returned NO after the deadline passed without an official qualifying deal announcement.`,
      raw: run
    })
  };
}

async function tryResolveEntertainmentAlbumDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseEntertainmentAlbumDirectSpec(market);
  if (!spec) {
    return null;
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithRetry(spec.officialSearchUrl, {
      headers: {
        Accept: "application/json"
      }
    }, {
      maxAttempts: 1,
      baseDelayMs: 500,
      timeoutMs: 5000
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { results?: AppleAlbumSearchResult[] };
    const results = Array.isArray(payload.results) ? payload.results : [];
    const qualifyingAlbum = findQualifyingEntertainmentAlbum(results, spec);

    const citations: ProviderSearchResultItem[] = [
      {
        title: `Official Apple catalog search for ${spec.artistName}`,
        url: spec.officialSearchUrl,
        snippet: `Official Apple catalog search used to check whether a new full-length album by ${spec.artistName} appeared after the market started.`,
        source: "official"
      }
    ];

    if (qualifyingAlbum?.collectionViewUrl) {
      citations.push({
        title: `${spec.artistName} official Apple Music album page`,
        url: qualifyingAlbum.collectionViewUrl,
        snippet: `Official Apple Music listing for ${qualifyingAlbum.collectionName} released ${qualifyingAlbum.releaseDate ?? "unknown date"}.`,
        source: "official"
      });
    }

    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query: `Resolve ${market.canonicalMarket.title} from official Apple catalog album search.`,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "apple-music-album-direct",
        artistName: spec.artistName,
        baselineReleasedAfterUtc: new Date(spec.baselineReleasedAfterMs).toISOString(),
        qualifyingAlbum: qualifyingAlbum?.collectionName ?? null,
        qualifyingAlbumReleaseDate: qualifyingAlbum?.releaseDate ?? null
      }
    });

    if (qualifyingAlbum?.collectionName && qualifyingAlbum.releaseDate) {
      return {
        primary: buildDirectJudgment({
          provider: DIRECT_PROVIDER,
          ok: true,
          parseMode: "direct",
          state: "YES",
          researchConfidence: 0.93,
          officialSourceUsed: true,
          contradictionDetected: false,
          needsEscalation: false,
          why: `Official Apple catalog results show a new full-length ${spec.artistName} album, ${qualifyingAlbum.collectionName}, released on ${qualifyingAlbum.releaseDate}. That is a qualifying official streaming/download listing after the market started.`,
          decisiveEvidence: [
            `Official Apple catalog lists ${qualifyingAlbum.collectionName} by ${spec.artistName} with release date ${qualifyingAlbum.releaseDate}.`
          ],
          missingEvidence: [],
          citations,
          rawAnswer: `Direct entertainment album resolver found a qualifying official Apple catalog album listing for ${spec.artistName}.`,
          raw: run
        })
      };
    }

    if (Date.now() < spec.deadlineMs) {
      return {
        nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 12 * 60 * 60 * 1000)).toISOString(),
        primary: buildDirectJudgment({
          provider: DIRECT_PROVIDER,
          ok: true,
          parseMode: "direct",
          state: "UNRESOLVED",
          researchConfidence: 0.9,
          officialSourceUsed: true,
          contradictionDetected: false,
          needsEscalation: false,
          why: `Official Apple catalog results do not yet show a qualifying new full-length ${spec.artistName} album released after the market started. Before the deadline, this market remains unresolved.`,
          decisiveEvidence: [
            `Official Apple catalog was checked for new ${spec.artistName} album listings released after ${new Date(spec.baselineReleasedAfterMs).toISOString()}.`
          ],
          missingEvidence: [
            `Official Apple Music or equivalent official streaming/download listing for a new full-length ${spec.artistName} album before the deadline`
          ],
          citations,
          rawAnswer: `Direct entertainment album resolver found no qualifying official Apple catalog album listing yet for ${spec.artistName}; market remains unresolved.`,
          raw: run
        })
      };
    }
  } catch {
    return null;
  }

  return {
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "NO",
      researchConfidence: 0.89,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `The deadline has passed and official Apple catalog results do not show a qualifying new full-length ${spec.artistName} album released after the market started. This market therefore resolves NO.`,
      decisiveEvidence: [
        `Official Apple catalog was checked for new ${spec.artistName} album listings released after ${new Date(spec.baselineReleasedAfterMs).toISOString()}.`
      ],
      missingEvidence: [],
      citations: [
        {
          title: `Official Apple catalog search for ${spec.artistName}`,
          url: spec.officialSearchUrl,
          snippet: `Official Apple catalog search used to verify whether a qualifying ${spec.artistName} album release occurred before the deadline.`,
          source: "official"
        }
      ],
      rawAnswer: `Direct entertainment album resolver returned NO after the deadline passed without a qualifying Apple catalog listing for ${spec.artistName}.`,
      raw: buildSuccessRun({
        provider: DIRECT_PROVIDER,
        query: `Resolve ${market.canonicalMarket.title} from official Apple catalog album search.`,
        durationMs: Date.now() - startedAt,
        resultCount: 1,
        estimatedRetrievalCostUsd: 0,
        results: [
          {
            title: `Official Apple catalog search for ${spec.artistName}`,
            url: spec.officialSearchUrl,
            snippet: `Official Apple catalog search used to verify whether a qualifying ${spec.artistName} album release occurred before the deadline.`,
            source: "official"
          }
        ],
        meta: {
          source: "apple-music-album-direct",
          artistName: spec.artistName,
          baselineReleasedAfterUtc: new Date(spec.baselineReleasedAfterMs).toISOString(),
          qualifyingAlbum: null,
          qualifyingAlbumReleaseDate: null
        }
      })
    })
  };
}

async function tryResolvePresidentOutDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parsePresidentOutDirectSpec(market);
  if (!spec) {
    return null;
  }

  if (Date.now() >= spec.deadlineMs) {
    return null;
  }

  const startedAt = Date.now();
  const query = `Resolve ${market.canonicalMarket.title} from the official ${spec.authorityName} page.`;
  const buildFallback = (summary: string): DirectOfficialResolution => {
    const citations: ProviderSearchResultItem[] = [
      {
        title: `Official ${spec.authorityName} page`,
        url: spec.administrationUrl,
        snippet: `Official ${spec.authorityName} source that should reflect any durable change in presidency status for ${spec.personName}.`,
        source: "official"
      }
    ];
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "president-direct-fallback",
        personName: spec.personName,
        authorityName: spec.authorityName,
        summary
      }
    });

    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 24 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.82,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `This market depends on official ${spec.authorityName} information for any durable removal from office. No qualifying removal signal has been established in this direct lane yet, so before the deadline the market remains unresolved.`,
        decisiveEvidence: [
          `Official source to monitor is the ${spec.authorityName} page for ${spec.personName}.`,
          summary
        ],
        missingEvidence: [
          `Durable removal from office for ${spec.personName} before the deadline`
        ],
        citations,
        rawAnswer: `Direct presidency resolver kept the market unresolved because no qualifying removal signal has been established yet for ${spec.personName}.`,
        raw: run
      })
    };
  };

  try {
    const response = await fetchWithRetry(spec.administrationUrl, {
      headers: PUBLIC_DATA_HEADERS
    }, {
      maxAttempts: 1,
      baseDelayMs: 750,
      timeoutMs: 3000
    });

    if (!response.ok) {
      return buildFallback(`Official ${spec.authorityName} page returned HTTP ${response.status}.`);
    }

    const html = await response.text();
    const text = htmlToDirectText(html);
    const normalized = text.toLowerCase();
    const nameHit = buildReleaseTopicAliases(spec.personName).some((alias) => normalized.includes(alias));
    const presidencyHit =
      /\bpresident\b/.test(normalized) &&
      (/\btrump administration\b/.test(normalized) || /\bthe trump administration\b/.test(normalized) || nameHit);

    if (!nameHit || !presidencyHit) {
      return null;
    }

    const citations: ProviderSearchResultItem[] = [
      {
        title: `Official ${spec.authorityName} page`,
        url: spec.administrationUrl,
        snippet: `Official ${spec.authorityName} page still identifies ${spec.personName} as President.`,
        source: "official"
      }
    ];
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query: `Resolve ${market.canonicalMarket.title} from the official White House administration page.`,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "president-direct",
        personName: spec.personName,
        authorityName: spec.authorityName
      }
    });

    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 24 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.94,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `The official ${spec.authorityName} page still identifies ${spec.personName} as President. Before the deadline, that means this market remains unresolved unless durable removal from office actually occurs.`,
        decisiveEvidence: [
          `Official ${spec.authorityName} page still lists ${spec.personName} as President.`
        ],
        missingEvidence: [
          `Durable removal from office for ${spec.personName} before the deadline`
        ],
        citations,
        rawAnswer: `Direct presidency resolver kept the market unresolved because ${spec.personName} is still presented as President on the official ${spec.authorityName} page.`,
        raw: run
      })
    };
  } catch {
    return buildFallback(`Official ${spec.authorityName} page could not be fetched within the direct-lane time budget.`);
  }
}

async function tryResolvePardonDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parsePardonDirectSpec(market);
  if (!spec) {
    return null;
  }

  if (Date.now() >= spec.deadlineMs) {
    return null;
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithRetry(spec.officialSearchUrl, {
      headers: PUBLIC_DATA_HEADERS
    }, {
      maxAttempts: 2,
      baseDelayMs: 750
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const normalized = htmlToDirectText(html).toLowerCase();
    const noResults = /\bno results found\b/.test(normalized) || /\bsearch-no-results\b/.test(html.toLowerCase());
    if (!noResults) {
      return null;
    }

    const citations: ProviderSearchResultItem[] = [
      {
        title: "Official White House site search",
        url: spec.officialSearchUrl,
        snippet: `Official White House search currently shows no results for ${spec.subjectName} pardon-related terms.`,
        source: "official"
      }
    ];
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query: `Resolve ${market.canonicalMarket.title} from official White House pardon search results.`,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "white-house-pardon-direct",
        principalName: spec.principalName,
        subjectName: spec.subjectName
      }
    });

    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 24 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.93,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official White House search currently shows no pardon-related result for ${spec.subjectName}. Before the deadline, that means this market remains unresolved.`,
        decisiveEvidence: [
          `Official White House search for ${spec.subjectName} pardon terms returns no results.`
        ],
        missingEvidence: [
          `Official White House or US government pardon/commutation/reprieve result for ${spec.subjectName}`
        ],
        citations,
        rawAnswer: `Direct pardon resolver kept the market unresolved because official White House search has no result for ${spec.subjectName}.`,
        raw: run
      })
    };
  } catch {
    return null;
  }
}

async function tryResolveWorldOfficialSignalDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseWorldOfficialSignalDirectSpec(market);
  if (!spec) {
    return null;
  }

  const query = `Resolve ${market.canonicalMarket.title} from official world-event sources.`;
  const pageSignals = await collectOkSignals(
    spec.officialUrls.slice(0, 4),
    (url) => fetchWorldOfficialSignal(url, spec),
    2
  );
  const citations: ProviderSearchResultItem[] = (
    pageSignals.length > 0
      ? pageSignals.map((signal) => ({
          url: signal.url,
          summary: signal.summary
        }))
      : spec.officialUrls.slice(0, 4).map((url) => ({
          url,
          summary: `Official government or intergovernmental source monitored for ${spec.eventLabel}.`
        }))
  ).map((item) => ({
    title: `Official ${hostnameLabel(item.url)} source for ${spec.eventLabel}`,
    url: item.url,
    snippet: item.summary,
    source: "official"
  }));

  const positiveSignal = pageSignals.find((signal) => signal.eventDetected);
  const checkedEvidence = pageSignals.map((signal) => `${signal.url}: ${signal.summary}`);
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: pageSignals.reduce((max, item) => Math.max(max, item.durationMs), 0),
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "world-official-direct",
      eventKind: spec.eventKind,
      eventLabel: spec.eventLabel,
      checkedUrls: pageSignals.map((item) => item.url),
      positiveSignal: positiveSignal?.url ?? null
    }
  });

  if (positiveSignal) {
    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "YES",
        researchConfidence: 0.9,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official monitored sources show a qualifying ${spec.eventKind} signal for ${spec.eventLabel}, so this market resolves YES.`,
        decisiveEvidence: [
          positiveSignal.summary,
          ...checkedEvidence.slice(0, 2)
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct world-event resolver found a qualifying official ${spec.eventKind} signal for ${spec.eventLabel}.`,
        raw: run
      })
    };
  }

  if (Date.now() < spec.deadlineMs) {
    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 6 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: pageSignals.length > 0 ? 0.82 : 0.74,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Checked official monitored sources for a qualifying ${spec.eventKind} signal for ${spec.eventLabel}; no official signal was found in the direct lane yet, so before the deadline this market remains unresolved.`,
        decisiveEvidence: checkedEvidence.slice(0, 3).length > 0
          ? checkedEvidence.slice(0, 3)
          : [`Official sources are being monitored for ${spec.eventLabel}, but no qualifying official ${spec.eventKind} signal has been established in the direct lane yet.`],
        missingEvidence: [
          `Official government or intergovernmental confirmation establishing ${spec.eventLabel} before the deadline`
        ],
        citations,
        rawAnswer: `Direct world-event resolver found no qualifying official ${spec.eventKind} signal yet for ${spec.eventLabel}; market remains unresolved.`,
        raw: run
      })
    };
  }

  return {
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "NO",
      researchConfidence: pageSignals.length > 0 ? 0.9 : 0.82,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `The deadline has passed and official monitored sources do not show a qualifying ${spec.eventKind} signal for ${spec.eventLabel}. This market therefore resolves NO.`,
      decisiveEvidence: checkedEvidence.slice(0, 3).length > 0
        ? checkedEvidence.slice(0, 3)
        : [`Official sources were monitored for ${spec.eventLabel}, but no qualifying official ${spec.eventKind} signal was found by the deadline.`],
      missingEvidence: [],
      citations,
      rawAnswer: `Direct world-event resolver returned NO after the deadline passed without a qualifying official ${spec.eventKind} signal.`,
      raw: run
    })
  };
}

async function tryResolvePartyNominationDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parsePartyNominationDirectSpec(market);
  if (!spec) {
    return null;
  }

  const nominationYearStartsAtMs = Date.UTC(spec.targetYear, 0, 1);
  if (Date.now() >= nominationYearStartsAtMs || Date.now() >= spec.deadlineMs) {
    return null;
  }

  const citations: ProviderSearchResultItem[] = [
    {
      title: `Official ${spec.partyName} Party site`,
      url: spec.officialPartyUrl,
      snippet: `Official ${spec.partyName} Party source for nomination-related updates.`,
      source: "official"
    }
  ];
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query: `Resolve ${market.canonicalMarket.title} from official ${spec.partyName} Party nomination sources.`,
    durationMs: 0,
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "party-nomination-preyear-direct",
      candidateName: spec.candidateName,
      partyName: spec.partyName,
      targetYear: spec.targetYear
    }
  });

  return {
    nextCheckAt: new Date(Math.min(spec.deadlineMs, nominationYearStartsAtMs)).toISOString(),
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "UNRESOLVED",
      researchConfidence: 0.97,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `This market concerns the ${spec.targetYear} ${spec.partyName} presidential nomination. Before ${spec.targetYear} begins, no official ${spec.partyName} Party source can yet establish a final nominee, so the market remains unresolved.`,
      decisiveEvidence: [
        `The market is about the ${spec.targetYear} ${spec.partyName} presidential nomination.`,
        `Official resolution sources are ${spec.partyName} Party sources, and the nomination has not yet occurred.`
      ],
      missingEvidence: [
        `Official ${spec.partyName} Party confirmation that ${spec.candidateName} won and accepted the ${spec.targetYear} nomination`
      ],
      citations,
      rawAnswer: `Direct party-nomination resolver kept the market unresolved because the ${spec.targetYear} nomination cycle has not yet reached a point where an official nominee can be finalized.`,
      raw: run
    })
  };
}

async function tryResolvePresidentialElectionDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parsePresidentialElectionDirectSpec(market);
  if (!spec) {
    return null;
  }

  const electionYearStartsAtMs = Date.UTC(spec.targetYear, 0, 1);
  if (Date.now() >= electionYearStartsAtMs || Date.now() >= spec.deadlineMs) {
    return null;
  }

  const citations: ProviderSearchResultItem[] = [
    {
      title: "Official Federal Election Commission site",
      url: spec.officialElectionUrl,
      snippet: `Official US federal election authority source relevant to the ${spec.targetYear} presidential election cycle.`,
      source: "official"
    }
  ];
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query: `Resolve ${market.canonicalMarket.title} from official US presidential election authorities.`,
    durationMs: 0,
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "presidential-election-preyear-direct",
      candidateName: spec.candidateName,
      targetYear: spec.targetYear
    }
  });

  return {
    nextCheckAt: new Date(Math.min(spec.deadlineMs, electionYearStartsAtMs)).toISOString(),
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "UNRESOLVED",
      researchConfidence: 0.97,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `This market concerns the ${spec.targetYear} US presidential election. Before ${spec.targetYear} begins, no official election authority can yet establish a winner, so the market remains unresolved.`,
      decisiveEvidence: [
        `The market is about the ${spec.targetYear} US presidential election.`,
        `Official election authorities cannot confirm a winner before the election cycle year begins.`
      ],
      missingEvidence: [
        `Official election results establishing that ${spec.candidateName} won the ${spec.targetYear} US presidential election`
      ],
      citations,
      rawAnswer: `Direct presidential-election resolver kept the market unresolved because the ${spec.targetYear} election year has not begun.`,
      raw: run
    })
  };
}

async function tryResolveMacroDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  if (market.canonicalMarket.category !== "macro") {
    return null;
  }

  const macroOfficialContext = await buildMacroOfficialContext(market).catch(() => null);
  if (!macroOfficialContext) {
    return null;
  }

  if (!macroOfficialContext.targetPeriodLabel || !macroOfficialContext.targetThresholdLabel) {
    return null;
  }

  const citations = buildMacroDirectCitations(macroOfficialContext);
  const query = `Resolve ${market.canonicalMarket.title} from official FRED ${macroOfficialContext.seriesId} data.`;

  if (macroOfficialContext.targetPeriodStatus === "target_not_available") {
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: 0,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "fred-direct",
        seriesId: macroOfficialContext.seriesId,
        targetPeriodLabel: macroOfficialContext.targetPeriodLabel,
        targetPeriodStatus: macroOfficialContext.targetPeriodStatus,
        transformedLabel: macroOfficialContext.transformedLabel,
        threshold: macroOfficialContext.targetThresholdLabel
      }
    });

    return {
      nextCheckAt: macroOfficialContext.estimatedReleaseAt,
      macroOfficialContext,
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.97,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `This market depends on official FRED series ${macroOfficialContext.seriesId} for ${macroOfficialContext.targetPeriodLabel}, but that target-period observation is not available yet.`,
        decisiveEvidence: [
          `Official source is FRED series ${macroOfficialContext.seriesId}.`,
          `Target period ${macroOfficialContext.targetPeriodLabel} has not appeared in the official series yet.`
        ],
        missingEvidence: [
          `Official ${macroOfficialContext.targetPeriodLabel} ${macroOfficialContext.transformedLabel} observation for ${macroOfficialContext.seriesId}`
        ],
        citations,
        rawAnswer: "Direct FRED resolver deferred because the target-period observation is not yet available.",
        raw: run
      })
    };
  }

  if (
    macroOfficialContext.targetPeriodStatus !== "target_available" ||
    macroOfficialContext.targetThresholdSatisfied == null ||
    macroOfficialContext.targetTransformedValue == null
  ) {
    return null;
  }

  const state: DirectLegacyState = macroOfficialContext.targetThresholdSatisfied ? "YES" : "NO";
  const decisiveMetricLabel =
    macroOfficialContext.transform === "level"
      ? "level"
      : macroOfficialContext.transformedLabel;
  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: 0,
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "fred-direct",
      seriesId: macroOfficialContext.seriesId,
      targetPeriodLabel: macroOfficialContext.targetPeriodLabel,
      targetObservationDate: macroOfficialContext.targetObservationDate,
      targetValue: macroOfficialContext.targetTransformedValue,
      transformedLabel: macroOfficialContext.transformedLabel,
      threshold: macroOfficialContext.targetThresholdLabel,
      thresholdSatisfied: macroOfficialContext.targetThresholdSatisfied
    }
  });

  return {
    macroOfficialContext,
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state,
      researchConfidence: 0.99,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: `Official FRED series ${macroOfficialContext.seriesId} resolves this market ${state}. For ${macroOfficialContext.targetPeriodLabel}, the official ${decisiveMetricLabel} was ${formatMetricValue(macroOfficialContext.targetTransformedValue)}, and the threshold is ${macroOfficialContext.targetThresholdLabel}.`,
      decisiveEvidence: [
        `Official FRED ${macroOfficialContext.seriesId} ${macroOfficialContext.targetPeriodLabel} ${decisiveMetricLabel} was ${formatMetricValue(macroOfficialContext.targetTransformedValue)}.`,
        `Threshold rule: ${macroOfficialContext.targetThresholdLabel}.`
      ],
      missingEvidence: [],
      citations,
      rawAnswer: `Direct FRED resolver returned ${state} from ${macroOfficialContext.seriesId} ${macroOfficialContext.targetPeriodLabel}.`,
      raw: run
    })
  };
}

async function tryResolveRecessionDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseRecessionDirectSpec(market);
  if (!spec) {
    return null;
  }

  const query = `Resolve ${market.canonicalMarket.title} from official BEA GDP releases and NBER recession signals.`;
  const [gdpWindow, nberWindow] = await Promise.all([
    fetchFredSeriesWindow("A191RL1Q225SBEA", 12, {
      observationStart: quarterStartDate(spec.startQuarter),
      observationEnd: quarterEndDate(spec.endQuarter),
      sortOrder: "asc"
    }).catch(() => null),
    fetchFredSeriesWindow("USREC", 24, {
      observationStart: `${spec.startQuarter.year}-01-01`,
      observationEnd: `${spec.endQuarter.year}-12-31`,
      sortOrder: "asc"
    }).catch(() => null)
  ]);

  if (!gdpWindow) {
    return null;
  }

  const gdpObservations = gdpWindow.observations
    .map((item) => {
      const value = Number.parseFloat(item.value);
      if (!Number.isFinite(value)) {
        return null;
      }

      const quarter = quarterFromObservationDate(item.date);
      if (!quarter) {
        return null;
      }

      return {
        ...quarter,
        date: item.date,
        value
      };
    })
    .filter((item): item is RecessionQuarter & { date: string; value: number } => Boolean(item))
    .filter((item) => item.index >= spec.startQuarter.index && item.index <= spec.endQuarter.index)
    .sort((left, right) => left.index - right.index);

  if (gdpObservations.length === 0) {
    return null;
  }

  const negativePair = findConsecutiveNegativeGdpPair(gdpObservations);
  const nberSignal = findNberRecessionSignal(nberWindow?.observations ?? [], spec);
  const nberChecked = Boolean(nberWindow);
  const endQuarterAvailable = gdpObservations.some((item) => item.index === spec.endQuarter.index);
  const citations = buildRecessionDirectCitations(spec, gdpWindow.title, nberSignal);

  if (negativePair) {
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: 0,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "bea-recession-direct",
        pair: `${negativePair.first.label} + ${negativePair.second.label}`,
        firstValue: negativePair.first.value,
        secondValue: negativePair.second.value
      }
    });

    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "YES",
        researchConfidence: 0.99,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official BEA GDP data shows two consecutive negative quarterly real GDP growth readings within the market window: ${negativePair.first.label} (${formatMetricValue(negativePair.first.value)}) and ${negativePair.second.label} (${formatMetricValue(negativePair.second.value)}).`,
        decisiveEvidence: [
          `${negativePair.first.label} official GDP growth was ${formatMetricValue(negativePair.first.value)}.`,
          `${negativePair.second.label} official GDP growth was ${formatMetricValue(negativePair.second.value)}.`
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct recession resolver returned YES from official BEA GDP data: ${negativePair.first.label} and ${negativePair.second.label} were both negative.`,
        raw: run
      })
    };
  }

  if (nberSignal) {
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: 0,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "nber-recession-direct",
        signalDate: nberSignal.date,
        signalValue: nberSignal.value
      }
    });

    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "YES",
        researchConfidence: 0.97,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official NBER-based recession data indicates a U.S. recession month inside the market window, which satisfies the recession-announcement path of the rules.`,
        decisiveEvidence: [
          `Official NBER-based recession indicator shows recession month ${nberSignal.date}.`,
          `Market rules allow a YES resolution if NBER publicly identifies a recession during the covered period.`
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct recession resolver returned YES from official NBER-based recession signal dated ${nberSignal.date}.`,
        raw: run
      })
    };
  }

  if (Date.now() >= spec.deadlineMs && endQuarterAvailable && nberChecked) {
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: 0,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "bea-recession-direct",
        endQuarterAvailable,
        deadlineUtc: new Date(spec.deadlineMs).toISOString()
      }
    });

    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "NO",
        researchConfidence: 0.95,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `The official BEA series never showed two consecutive negative quarterly GDP growth readings inside ${spec.startQuarter.label} to ${spec.endQuarter.label}, and no official NBER recession signal appeared before the market deadline.`,
        decisiveEvidence: [
          `Official GDP window ${spec.startQuarter.label} to ${spec.endQuarter.label} contains no qualifying two-quarter negative streak.`,
          `No official NBER-based recession signal was found inside the covered period.`
        ],
        missingEvidence: [],
        citations,
        rawAnswer: "Direct recession resolver returned NO after the market window closed without an official recession trigger.",
        raw: run
      })
    };
  }

  const run = buildSuccessRun({
    provider: DIRECT_PROVIDER,
    query,
    durationMs: 0,
    resultCount: citations.length,
    estimatedRetrievalCostUsd: 0,
    results: citations,
    meta: {
      source: "bea-recession-direct",
      latestQuarter: gdpObservations[gdpObservations.length - 1]?.label ?? null,
      deadlineUtc: new Date(spec.deadlineMs).toISOString()
    }
  });

  return {
    nextCheckAt: estimateRecessionNextCheckAt(spec, gdpObservations[gdpObservations.length - 1]),
    primary: buildDirectJudgment({
      provider: DIRECT_PROVIDER,
      ok: true,
      parseMode: "direct",
      state: "UNRESOLVED",
      researchConfidence: 0.96,
      officialSourceUsed: true,
      contradictionDetected: false,
      needsEscalation: false,
      why: nberChecked
        ? `Official BEA GDP data has not yet produced a qualifying two-quarter negative streak, and no official NBER recession signal is visible yet. Before the market deadline, that means the market remains unresolved.`
        : `Official BEA GDP data has not yet produced a qualifying two-quarter negative streak. The market remains unresolved before the deadline, so there is no basis for an early NO.`,
      decisiveEvidence: [
        `Official GDP data through ${gdpObservations[gdpObservations.length - 1]?.label ?? "the latest available quarter"} does not show two consecutive negative quarters.`,
        nberChecked
          ? `No official NBER-based recession signal is visible in the covered period so far.`
          : `A qualifying NBER recession signal has not been confirmed in this direct check.`
      ],
      missingEvidence: [
        `Either two consecutive negative official GDP growth quarters between ${spec.startQuarter.label} and ${spec.endQuarter.label}, or an official NBER recession signal before the deadline`
      ],
      citations,
      rawAnswer: "Direct recession resolver kept the market unresolved because no official recession trigger has occurred yet.",
      raw: run
    })
  };
}

async function tryResolveNhlCupDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  if (market.canonicalMarket.category !== "sports") {
    return null;
  }

  const spec = parseNhlCupDirectSpec(market);
  if (!spec) {
    return null;
  }

  const bracketUrl = `https://api-web.nhle.com/v1/playoff-bracket/${spec.seasonYear}`;
  const standingsUrl = "https://api-web.nhle.com/v1/standings/now";
  const officialStandingsPage = "https://www.nhl.com/standings/";
  const officialBracketPage = `https://www.nhl.com/playoffs/${spec.seasonYear}/bracket`;
  const query = `Resolve ${market.canonicalMarket.title} from official NHL standings and playoff bracket data.`;

  const startedAt = Date.now();

  try {
    const [bracketResponse, standingsResponse] = await Promise.all([
      fetchWithRetry(bracketUrl, {
        headers: { Accept: "application/json" }
      }, {
        maxAttempts: 2,
        baseDelayMs: 750
      }),
      fetchWithRetry(standingsUrl, {
        headers: { Accept: "application/json" }
      }, {
        maxAttempts: 2,
        baseDelayMs: 750
      })
    ]);

    const bracketPayload = (await bracketResponse.json()) as NhlBracketPayload;
    const standingsPayload = (await standingsResponse.json()) as NhlStandingsPayload;

    if (!bracketResponse.ok || !standingsResponse.ok) {
      return null;
    }

    const targetStanding = findNhlStanding(standingsPayload, spec.teamName);
    const champion = findNhlChampion(bracketPayload);

    const citations: ProviderSearchResultItem[] = [
      {
        title: `Official NHL playoff bracket ${spec.seasonYear}`,
        url: officialBracketPage,
        snippet: `Official NHL playoff bracket page for the ${spec.seasonYear} Stanley Cup playoffs.`,
        source: "official"
      },
      {
        title: "Official NHL standings",
        url: officialStandingsPage,
        snippet: "Official NHL standings page used to confirm the team's current status.",
        source: "official"
      },
      {
        title: `NHL playoff bracket API ${spec.seasonYear}`,
        url: bracketUrl,
        snippet: "Official NHL bracket data feed.",
        source: "official"
      },
      {
        title: "NHL standings API",
        url: standingsUrl,
        snippet: "Official NHL standings data feed.",
        source: "official"
      }
    ];

    const durationMs = Date.now() - startedAt;

    if (champion) {
      const state: DirectLegacyState = sameTeamName(champion.name, spec.teamName) ? "YES" : "NO";
      const run = buildSuccessRun({
        provider: DIRECT_PROVIDER,
        query,
        durationMs,
        resultCount: citations.length,
        estimatedRetrievalCostUsd: 0,
        httpStatus: 200,
        results: citations,
        meta: {
          source: "nhl-direct",
          seasonYear: spec.seasonYear,
          teamName: spec.teamName,
          champion: champion.name,
          championAbbrev: champion.abbrev
        }
      });

      return {
        primary: buildDirectJudgment({
          provider: DIRECT_PROVIDER,
          ok: true,
          parseMode: "direct",
          state,
          researchConfidence: 0.99,
          officialSourceUsed: true,
          contradictionDetected: false,
          needsEscalation: false,
          why: `Official NHL playoff bracket data resolves this market ${state}. The ${spec.seasonYear} Stanley Cup champion shown by NHL data is ${champion.name}.`,
          decisiveEvidence: [
            `Official NHL playoff bracket identifies ${champion.name} as the Stanley Cup champion.`,
            `Target team for this market is ${spec.teamName}.`
          ],
          missingEvidence: [],
          citations,
          rawAnswer: `Direct NHL resolver returned ${state} from official playoff bracket champion ${champion.name}.`,
          raw: run
        })
      };
    }

    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: 200,
      results: citations,
      meta: {
        source: "nhl-direct",
        seasonYear: spec.seasonYear,
        teamName: spec.teamName,
        standingsDateTimeUtc: standingsPayload.standingsDateTimeUtc,
        teamFoundInStandings: Boolean(targetStanding),
        clinchIndicator: targetStanding?.clinchIndicator ?? null,
        points: targetStanding?.points ?? null
      }
    });

    return {
      nextCheckAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.97,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: targetStanding
          ? `Official NHL standings and playoff bracket do not yet show a ${spec.seasonYear} Stanley Cup champion. ${spec.teamName} is still present in official NHL data, so this market remains unresolved.`
          : `Official NHL playoff data do not yet provide a final Stanley Cup champion for this market, so the market remains unresolved.`,
        decisiveEvidence: targetStanding
          ? [
              `Official NHL standings still list ${spec.teamName}.`,
              "Official NHL playoff bracket does not yet show a completed Stanley Cup champion."
            ]
          : [
              "Official NHL playoff bracket does not yet show a completed Stanley Cup champion."
            ],
        missingEvidence: [
          `Official NHL confirmation of the ${spec.seasonYear} Stanley Cup champion`
        ],
        citations,
        rawAnswer: "Direct NHL resolver deferred because no official Stanley Cup champion is shown yet.",
        raw: run
      })
    };
  } catch {
    return null;
  }
}

async function tryResolveWeatherDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const hottestYear = await tryResolveNasaHotYearDirectMarket(market);
  if (hottestYear) {
    return hottestYear;
  }

  const hurricane = await tryResolveNhcHurricaneLandfallMarket(market);
  if (hurricane) {
    return hurricane;
  }

  return null;
}

async function tryResolveNasaHotYearDirectMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseNasaHotYearSpec(market);
  if (!spec) {
    return null;
  }

  const dataUrl =
    "https://data.giss.nasa.gov/gistemp/graphs/graph_data/Global_Mean_Estimates_based_on_Land_and_Ocean_Data/graph.txt";
  const query = `Resolve ${market.canonicalMarket.title} from official NASA GISTEMP annual No_Smoothing data.`;
  const estimatedReleaseAt = estimateNasaAnnualReleaseAt(spec.targetYear);
  const estimatedReleaseAtMs = Date.parse(estimatedReleaseAt);
  const citations: ProviderSearchResultItem[] = [
    {
      title: "NASA GISTEMP annual No_Smoothing data",
      url: dataUrl,
      snippet: "Official NASA GISTEMP annual temperature anomaly table used for the market resolution.",
      source: "official"
    },
    {
      title: "NASA GISTEMP data downloads",
      url: "https://data.giss.nasa.gov/gistemp/data_v4.html",
      snippet: "Official NASA GISTEMP data downloads page.",
      source: "official"
    }
  ];

  if (!Number.isNaN(estimatedReleaseAtMs) && Date.now() < estimatedReleaseAtMs) {
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: 0,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      results: citations,
      meta: {
        source: "nasa-gistemp-direct",
        targetYear: spec.targetYear,
        targetRankLabel: spec.label,
        annualValueAvailable: false,
        releaseScheduleInferred: true,
        estimatedReleaseAt
      }
    });

    return {
      nextCheckAt: estimatedReleaseAt,
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.99,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official NASA GISTEMP annual data for ${spec.targetYear} are not expected to be available until roughly ${estimatedReleaseAt}. This market remains unresolved until that annual table is published.`,
        decisiveEvidence: [
          "Official NASA GISTEMP annual No_Smoothing table is the stated resolution source.",
          `The target annual observation for ${spec.targetYear} is not expected before ${estimatedReleaseAt}.`
        ],
        missingEvidence: [
          `Official NASA No_Smoothing annual value for ${spec.targetYear}`
        ],
        citations,
        rawAnswer: "Direct NASA resolver deferred because the target annual observation is not expected to exist yet.",
        raw: run
      })
    };
  }

  try {
    const startedAt = Date.now();
    const response = await fetchWithRetry(dataUrl, {
      headers: PUBLIC_DATA_HEADERS
    }, {
      maxAttempts: 2,
      baseDelayMs: 750
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.text();
    const annualRows = parseNasaGistempAnnualRows(body);
    if (annualRows.length === 0) {
      return null;
    }

    const target = annualRows.find((row) => row.year === spec.targetYear);
    if (!target) {
      const run = buildSuccessRun({
        provider: DIRECT_PROVIDER,
        query,
        durationMs: Date.now() - startedAt,
        resultCount: citations.length,
        estimatedRetrievalCostUsd: 0,
        httpStatus: response.status,
        results: citations,
        meta: {
          source: "nasa-gistemp-direct",
          targetYear: spec.targetYear,
          targetRankLabel: spec.label,
          annualValueAvailable: false
        }
      });

      return {
        nextCheckAt: estimatedReleaseAt,
        primary: buildDirectJudgment({
          provider: DIRECT_PROVIDER,
          ok: true,
          parseMode: "direct",
          state: "UNRESOLVED",
          researchConfidence: 0.97,
          officialSourceUsed: true,
          contradictionDetected: false,
          needsEscalation: false,
          why: `Official NASA GISTEMP annual data do not yet include ${spec.targetYear}, so this market remains unresolved.`,
          decisiveEvidence: [
            "Official NASA GISTEMP annual No_Smoothing table is the stated resolution source."
          ],
          missingEvidence: [
            `Official NASA No_Smoothing annual value for ${spec.targetYear}`
          ],
          citations,
          rawAnswer: "Direct NASA resolver deferred because the target year is not yet present in the annual table.",
          raw: run
        })
      };
    }

    const rank = computeCompetitionRank(annualRows, spec.targetYear);
    if (rank == null) {
      return null;
    }

    const state = evaluateHotYearRank(rank, spec);
    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "nasa-gistemp-direct",
        targetYear: spec.targetYear,
        targetRankLabel: spec.label,
        annualValue: target.value,
        computedRank: rank
      }
    });

    return {
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state,
        researchConfidence: 0.99,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: `Official NASA GISTEMP annual No_Smoothing data resolves this market ${state}. ${spec.targetYear} currently ranks #${rank} with anomaly ${target.value.toFixed(2)} C, and the market condition is ${spec.label}.`,
        decisiveEvidence: [
          `Official NASA GISTEMP annual No_Smoothing value for ${spec.targetYear} is ${target.value.toFixed(2)} C.`,
          `${spec.targetYear} ranks #${rank} in the official annual table.`
        ],
        missingEvidence: [],
        citations,
        rawAnswer: `Direct NASA resolver returned ${state} from annual rank #${rank} for ${spec.targetYear}.`,
        raw: run
      })
    };
  } catch {
    return null;
  }
}

async function tryResolveNhcHurricaneLandfallMarket(
  market: MarketContext
): Promise<DirectOfficialResolution | null> {
  const spec = parseNhcHurricaneLandfallSpec(market);
  if (!spec) {
    return null;
  }

  if (Date.now() > spec.deadlineMs) {
    return null;
  }

  const currentStormsUrl = "https://www.nhc.noaa.gov/CurrentStorms.json";
  const archiveUrl = spec.archiveUrl;
  const query = `Resolve ${market.canonicalMarket.title} from official NHC advisories.`;

  try {
    const startedAt = Date.now();
    const response = await fetchWithRetry(currentStormsUrl, {
      headers: PUBLIC_DATA_HEADERS
    }, {
      maxAttempts: 2,
      baseDelayMs: 750
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as NhcCurrentStormsPayload;
    const activeStormCount = Array.isArray(payload.activeStorms) ? payload.activeStorms.length : 0;
    const citations: ProviderSearchResultItem[] = [
      {
        title: "NHC Current Storms",
        url: currentStormsUrl,
        snippet: "Official NHC current storms feed.",
        source: "official"
      },
      {
        title: "NHC advisory archive",
        url: archiveUrl,
        snippet: "Official National Hurricane Center archive referenced by the market rules.",
        source: "official"
      }
    ];

    const run = buildSuccessRun({
      provider: DIRECT_PROVIDER,
      query,
      durationMs: Date.now() - startedAt,
      resultCount: citations.length,
      estimatedRetrievalCostUsd: 0,
      httpStatus: response.status,
      results: citations,
      meta: {
        source: "nhc-direct",
        deadlineUtc: new Date(spec.deadlineMs).toISOString(),
        activeStormCount
      }
    });

    return {
      nextCheckAt: new Date(Math.min(spec.deadlineMs, Date.now() + 6 * 60 * 60 * 1000)).toISOString(),
      primary: buildDirectJudgment({
        provider: DIRECT_PROVIDER,
        ok: true,
        parseMode: "direct",
        state: "UNRESOLVED",
        researchConfidence: 0.96,
        officialSourceUsed: true,
        contradictionDetected: false,
        needsEscalation: false,
        why: activeStormCount === 0
          ? `Official NHC data currently show no active storms, but the deadline has not passed yet, so the market remains unresolved.`
          : `Official NHC data show ${activeStormCount} active storm(s), but no qualifying official hurricane landfall resolution has been reached yet, so the market remains unresolved.`,
        decisiveEvidence: activeStormCount === 0
          ? [
              "Official NHC Current Storms feed currently shows no active storms."
            ]
          : [
              `Official NHC Current Storms feed currently lists ${activeStormCount} active storm(s).`
            ],
        missingEvidence: [
          "Official NHC advisory confirming a qualifying US hurricane landfall before the deadline, or passage of the deadline without such an advisory"
        ],
        citations,
        rawAnswer: "Direct NHC resolver deferred until a qualifying advisory appears or the market deadline passes.",
        raw: run
      })
    };
  } catch {
    return null;
  }
}

function buildBinanceDirectSpec(market: MarketContext): BinanceDirectSpec | null {
  const text = `${market.canonicalMarket.title}\n${market.canonicalMarket.rulesText}\n${market.canonicalMarket.description ?? ""}`;
  if (!/\bbinance\b/i.test(text)) {
    return null;
  }

  if (market.canonicalMarket.category !== "crypto" || market.canonicalMarket.resolutionArchetype !== "numeric_threshold") {
    return null;
  }

  const threshold = parseThreshold(market.canonicalMarket.title, market.canonicalMarket.rulesText);
  if (!threshold) {
    return null;
  }

  const symbol = parseBinanceSymbol(text);
  if (!symbol) {
    return null;
  }

  const targetOpenTimeMs = Date.parse(market.canonicalMarket.endTimeUtc);
  if (Number.isNaN(targetOpenTimeMs)) {
    return null;
  }

  const officialTradeUrl =
    extractOfficialUrlsForMarket(market).find((url) => /binance\.com/i.test(url)) ??
    `https://www.binance.com/en/trade/${symbol.slice(0, -4)}_${symbol.slice(-4)}`;
  const klineUrl = new URL("/api/v3/klines", env.BINANCE_SPOT_API_URL || "https://api.binance.com");
  klineUrl.searchParams.set("symbol", symbol);
  klineUrl.searchParams.set("interval", "1m");
  klineUrl.searchParams.set("startTime", String(targetOpenTimeMs - ONE_MINUTE_MS));
  klineUrl.searchParams.set("endTime", String(targetOpenTimeMs + ONE_MINUTE_MS * 2));
  klineUrl.searchParams.set("limit", "3");

  return {
    symbol,
    interval: "1m",
    targetOpenTimeMs,
    resolutionReadyAtMs: targetOpenTimeMs + ONE_MINUTE_MS,
    threshold,
    officialTradeUrl,
    klineUrl: klineUrl.toString()
  };
}

function buildBinanceHighDirectSpec(market: MarketContext): BinanceHighDirectSpec | null {
  const text = `${market.canonicalMarket.title}\n${market.canonicalMarket.rulesText}\n${market.canonicalMarket.description ?? ""}`;
  const lowered = text.toLowerCase();
  if (!/\bbinance\b/.test(lowered) || !/\bhigh\b/.test(lowered) || !/\bany\b[\s\S]{0,40}\b1 minute candle\b/.test(lowered)) {
    return null;
  }

  if (market.canonicalMarket.category !== "crypto" || market.canonicalMarket.resolutionArchetype !== "numeric_threshold") {
    return null;
  }

  const threshold = parseCompactDollarThreshold(market.canonicalMarket.title);
  if (threshold == null) {
    return null;
  }

  const symbol = parseBinanceSymbol(text);
  if (!symbol) {
    return null;
  }

  const deadlineMs = Date.parse(market.canonicalMarket.endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const startYear = new Date(Math.min(deadlineMs, Date.now())).getUTCFullYear() - 1;
  const startTimeMs = Date.UTC(startYear, 0, 1, 0, 0, 0);
  const officialTradeUrl =
    extractOfficialUrlsForMarket(market).find((url) => /binance\.com/i.test(url)) ??
    `https://www.binance.com/en/trade/${symbol.slice(0, -4)}_${symbol.slice(-4)}`;
  const historyUrl = new URL("/api/v3/klines", env.BINANCE_SPOT_API_URL || "https://api.binance.com");
  historyUrl.searchParams.set("symbol", symbol);
  historyUrl.searchParams.set("interval", "1d");
  historyUrl.searchParams.set("startTime", String(startTimeMs));
  historyUrl.searchParams.set("endTime", String(Math.min(Date.now(), deadlineMs)));
  historyUrl.searchParams.set("limit", "1000");

  return {
    symbol,
    threshold,
    deadlineMs,
    officialTradeUrl,
    historyUrl: historyUrl.toString(),
    startTimeMs
  };
}

function buildDirectCitations(spec: BinanceDirectSpec): ProviderSearchResultItem[] {
  return [
    {
      title: `Binance ${spec.symbol} trading page`,
      url: spec.officialTradeUrl,
      snippet: `Official ${spec.symbol} market page used by the market rules.`,
      source: "official"
    },
    {
      title: `Binance ${spec.symbol} ${spec.interval} klines`,
      url: spec.klineUrl,
      snippet: `Official Binance market-data endpoint for the target ${spec.interval} candle.`,
      source: "official"
    }
  ];
}

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

function parseNumberArray(rawValue: unknown): number[] {
  return parseStringArray(rawValue)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
}

function parseNhlCupDirectSpec(market: MarketContext): { seasonYear: number; teamName: string } | null {
  if (market.canonicalMarket.resolutionArchetype !== "winner_of_event") {
    return null;
  }

  const title = market.canonicalMarket.title.trim();
  const match = title.match(/^Will the (.+) win the (\d{4}) NHL Stanley Cup\??$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const rules = market.canonicalMarket.rulesText.toLowerCase();
  if (!/\bnhl\b/.test(rules) || !/\bstanley cup\b/.test(rules)) {
    return null;
  }

  const seasonYear = Number.parseInt(match[2], 10);
  if (!Number.isFinite(seasonYear)) {
    return null;
  }

  return {
    seasonYear,
    teamName: match[1].trim()
  };
}

function parseNasaHotYearSpec(
  market: MarketContext
): { targetYear: number; label: string; mode: "exact" | "at_least"; rank: number } | null {
  const title = market.canonicalMarket.title.trim();
  const rules = market.canonicalMarket.rulesText.toLowerCase();
  if (!/\bnasa\b|\bgistemp\b|\bglobal land-ocean temperature index\b/.test(rules)) {
    return null;
  }

  const hottest = title.match(/^Will (\d{4}) be the hottest year on record\??$/i);
  if (hottest?.[1]) {
    return {
      targetYear: Number.parseInt(hottest[1], 10),
      label: "rank #1 (hottest year on record)",
      mode: "exact",
      rank: 1
    };
  }

  const exactMap: Record<string, number> = {
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5
  };
  const exact = title.match(/^Will (\d{4}) be the (second|third|fourth|fifth)-hottest year on record\??$/i);
  if (exact?.[1] && exact[2]) {
    const rank = exactMap[exact[2].toLowerCase()];
    if (rank) {
      return {
        targetYear: Number.parseInt(exact[1], 10),
        label: `rank #${rank}`,
        mode: "exact",
        rank
      };
    }
  }

  const lower = title.match(/^Will (\d{4}) rank as the (sixth|seventh|eighth|ninth|tenth)-hottest year on record or lower\??$/i);
  const lowerMap: Record<string, number> = {
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10
  };
  if (lower?.[1] && lower[2]) {
    const rank = lowerMap[lower[2].toLowerCase()];
    if (rank) {
      return {
        targetYear: Number.parseInt(lower[1], 10),
        label: `rank #${rank} or lower`,
        mode: "at_least",
        rank
      };
    }
  }

  return null;
}

function parseNhcHurricaneLandfallSpec(
  market: MarketContext
): { deadlineMs: number; archiveUrl: string } | null {
  const text = `${market.canonicalMarket.title}\n${market.canonicalMarket.rulesText}`.toLowerCase();
  if (!/\bhurricane\b/.test(text) || !/\blandfall\b/.test(text) || !/\bnhc\b|\bnational hurricane center\b/.test(text)) {
    return null;
  }

  const deadlineMs = Date.parse(market.canonicalMarket.endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const archiveMatch = market.canonicalMarket.rulesText.match(/https:\/\/www\.nhc\.noaa\.gov\/archive\/\d{4}\//i);
  const archiveUrl = archiveMatch?.[0] ?? "https://www.nhc.noaa.gov/archive/";

  return {
    deadlineMs,
    archiveUrl
  };
}

function parseCompanyIpoDirectSpec(market: MarketContext): CompanyIpoDirectSpec | null {
  const { category, resolutionArchetype, title, endTimeUtc } = market.canonicalMarket;
  if (category !== "business" || resolutionArchetype !== "negative_occurrence_by_deadline") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(/^Will (.+?) not IPO\b/i);
  if (!match?.[1]) {
    return null;
  }

  const deadlineMs = Date.parse(endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const officialDomains = extractOfficialDomainsForMarket(market).filter((domain) => !domain.endsWith(".gov"));
  const officialUrls = buildCompanyOfficialUrls(
    officialDomains,
    extractOfficialUrlsForMarket(market),
    match[1].trim()
  );

  if (officialUrls.length === 0) {
    return null;
  }

  return {
    companyName: match[1].trim(),
    deadlineMs,
    officialUrls
  };
}

function parseCompanyReleaseDirectSpec(market: MarketContext): CompanyReleaseDirectSpec | null {
  const { category, resolutionArchetype, title, endTimeUtc } = market.canonicalMarket;
  if (!["business", "technology"].includes(category) || resolutionArchetype !== "release_or_launch") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const companyReleasePattern = /^Will (.+?) release (.+?)(?:\s+(?:before|by|on|at|after)\b|$)/i;
  const companyLaunchPattern = /^Will (.+?) launch (.+?)(?:\s+(?:before|by|on|at|after)\b|$)/i;
  const passiveReleasedPattern = /^Will (.+?) be released(?:\s+(?:before|by|on|at|after)\b|$)/i;
  const passiveLaunchedPattern = /^Will (.+?) be launched(?:\s+(?:before|by|on|at|after)\b|$)/i;

  let companyName: string | undefined;
  let releaseTopic: string | undefined;

  const companyVerbMatch = normalizedTitle.match(companyReleasePattern) ?? normalizedTitle.match(companyLaunchPattern);
  if (companyVerbMatch?.[1] && companyVerbMatch[2]) {
    companyName = companyVerbMatch[1].trim();
    releaseTopic = companyVerbMatch[2].trim();
  }

  const passiveMatch = normalizedTitle.match(passiveReleasedPattern) ?? normalizedTitle.match(passiveLaunchedPattern);
  if (!releaseTopic && passiveMatch?.[1]) {
    releaseTopic = passiveMatch[1].trim();
  }

  if (!releaseTopic) {
    return null;
  }

  const deadlineMs = Date.parse(endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const officialDomains = extractOfficialDomainsForMarket(market).filter((domain) => !domain.endsWith(".gov"));
  const officialUrls = buildCompanyReleaseUrls(
    officialDomains,
    extractOfficialUrlsForMarket(market),
    releaseTopic,
    companyName
  );

  if (officialUrls.length === 0) {
    return null;
  }

  return {
    companyName,
    releaseTopic,
    deadlineMs,
    officialUrls,
    category
  };
}

function parseEntertainmentAlbumDirectSpec(market: MarketContext): EntertainmentAlbumDirectSpec | null {
  const { category, resolutionArchetype, title, endTimeUtc } = market.canonicalMarket;
  if (category !== "entertainment" || resolutionArchetype !== "release_or_launch") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(/^New (.+?) Album(?:\s+(?:before|by|on|at|after)\b|$)/i);
  const artistName = match?.[1]?.trim();
  if (!artistName) {
    return null;
  }

  const deadlineMs = Date.parse(endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const createdAtRaw = (market.rawMarket as { createdAt?: unknown; startDate?: unknown }).createdAt
    ?? (market.rawMarket as { createdAt?: unknown; startDate?: unknown }).startDate;
  const baselineReleasedAfterMs =
    typeof createdAtRaw === "string" && !Number.isNaN(Date.parse(createdAtRaw))
      ? Date.parse(createdAtRaw)
      : Date.now();

  const searchUrl = new URL("https://itunes.apple.com/search");
  searchUrl.searchParams.set("term", artistName);
  searchUrl.searchParams.set("media", "music");
  searchUrl.searchParams.set("entity", "album");
  searchUrl.searchParams.set("attribute", "artistTerm");
  searchUrl.searchParams.set("limit", "50");

  return {
    artistName,
    baselineReleasedAfterMs,
    deadlineMs,
    officialSearchUrl: searchUrl.toString()
  };
}

function parseCompanyTransactionDirectSpec(market: MarketContext): CompanyTransactionDirectSpec | null {
  const { category, resolutionArchetype, title, endTimeUtc } = market.canonicalMarket;
  if (category !== "business" || resolutionArchetype !== "official_announcement_by_deadline") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const acquireMatch = normalizedTitle.match(/^Will (.+?) acquire (.+)$/i);
  const mergeMatch = normalizedTitle.match(/^Will (.+?) merge with (.+)$/i);
  const match = acquireMatch ?? mergeMatch;
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const companyName = match[1].trim();
  const targetName = match[2].trim();
  const deadlineMs = Date.parse(endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const officialDomains = extractOfficialDomainsForMarket(market).filter((domain) => !domain.endsWith(".gov"));
  const officialUrls = buildCompanyTransactionUrls(
    officialDomains,
    extractOfficialUrlsForMarket(market),
    companyName,
    targetName
  );

  if (officialUrls.length === 0) {
    return null;
  }

  return {
    companyName,
    targetName,
    deadlineMs,
    officialUrls
  };
}

function buildCompanyOfficialUrls(domains: string[], directUrls: string[], companyName: string): string[] {
  const generated = domains.flatMap((domain) => {
    const root = `https://${domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}`;
    return [
      `${root}/investor-relations`,
      `${root}/investors`,
      `${root}/news`,
      `${root}/newsroom`,
      `${root}/press`,
      `${root}/press-releases`,
      `${root}/blog`,
      `${root}/`
    ];
  });

  const secCompanySearchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&owner=exclude&action=getcompany`;

  return dedupeStrings([...directUrls, secCompanySearchUrl, ...generated])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 6);
}

function buildCompanyReleaseUrls(
  domains: string[],
  directUrls: string[],
  releaseTopic: string,
  companyName?: string
): string[] {
  const topicSlugs = buildReleaseTopicSlugs(releaseTopic);
  const companySlugs = companyName ? buildReleaseTopicSlugs(companyName) : [];
  const generated = domains.flatMap((domain) => {
    const root = `https://${domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}`;
    const base = [
      `${root}/investor-relations`,
      `${root}/investors`,
      `${root}/blog`,
      `${root}/news`,
      `${root}/newsroom`,
      `${root}/press`,
      `${root}/press-releases`,
      `${root}/research`,
      `${root}/docs`,
      `${root}/api`,
      `${root}/products`,
      `${root}/product`,
      `${root}/`
    ];

    const topicPaths = topicSlugs.flatMap((slug) => [
      `${root}/${slug}`,
      `${root}/products/${slug}`,
      `${root}/product/${slug}`,
      `${root}/docs/${slug}`,
      `${root}/blog/${slug}`,
      `${root}/research/${slug}`
    ]);
    const companyPaths = companySlugs.map((slug) => `${root}/${slug}`);

    return [...base, ...topicPaths, ...companyPaths];
  });

  return dedupeStrings([...directUrls, ...generated])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 8);
}

function buildCompanyTransactionUrls(
  domains: string[],
  directUrls: string[],
  companyName: string,
  targetName: string
): string[] {
  const companySlugs = buildReleaseTopicSlugs(companyName);
  const targetSlugs = buildReleaseTopicSlugs(targetName);
  const generated = domains.flatMap((domain) => {
    const root = `https://${domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}`;
    const base = [
      `${root}/investor-relations`,
      `${root}/investors`,
      `${root}/news`,
      `${root}/newsroom`,
      `${root}/press`,
      `${root}/press-releases`,
      `${root}/blog`,
      `${root}/`
    ];

    const companyPaths = companySlugs.map((slug) => `${root}/${slug}`);
    const targetPaths = targetSlugs.map((slug) => `${root}/${slug}`);
    return [...base, ...companyPaths, ...targetPaths];
  });

  return dedupeStrings([...directUrls, ...generated])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 8);
}

function buildWorldOfficialUrls(domains: string[], directUrls: string[]): string[] {
  const generated = domains.flatMap((domain) => {
    const root = `https://${domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}`;

    if (/president\.gov\.ua/i.test(domain)) {
      return [`${root}/en`, `${root}/en/news`, `${root}/en/news/all`];
    }

    if (/mfa\.gov\.ua/i.test(domain)) {
      return [`${root}/en`, `${root}/en/news`, `${root}/en/press-center/news`];
    }

    if (/kremlin\.ru/i.test(domain)) {
      return [`${root}/events/president/news`, `${root}/structure/president`, `${root}/`];
    }

    if (/government\.ru/i.test(domain)) {
      return [`${root}/en/news/`, `${root}/news/`, `${root}/`];
    }

    if (/state\.gov/i.test(domain)) {
      return [`${root}/press-releases/`, `${root}/briefings-statements/`, `${root}/`];
    }

    if (/nato\.int/i.test(domain)) {
      return [`${root}/cps/en/natohq/news.htm`, `${root}/cps/en/natohq/opinions.htm`, `${root}/`];
    }

    if (/un\.org/i.test(domain)) {
      return [`${root}/press/en`, `${root}/sg/en`, `${root}/`];
    }

    return [`${root}/news`, `${root}/press`, `${root}/newsroom`, `${root}/statements`, `${root}/`];
  });

  return dedupeStrings([...directUrls, ...generated])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 8);
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "official";
  }
}

function parsePresidentOutDirectSpec(market: MarketContext): PresidentOutDirectSpec | null {
  const { category, resolutionArchetype, title } = market.canonicalMarket;
  if (category !== "politics" || resolutionArchetype !== "appointment_or_resignation") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(/^(.+?) out as President\b/i);
  const willMatch = normalizedTitle.match(/^Will (.+?) out as President\b/i);
  const personName = (willMatch?.[1] ?? match?.[1])?.trim();
  if (!personName) {
    return null;
  }

  const deadlineMs = Date.parse(market.canonicalMarket.endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const normalizedPerson = personName.toLowerCase();
  if (normalizedPerson.includes("trump")) {
    return {
      personName,
      deadlineMs,
      administrationUrl: "https://www.whitehouse.gov/administration/",
      authorityName: "White House administration"
    };
  }

  if (normalizedPerson.includes("putin")) {
    return {
      personName,
      deadlineMs,
      administrationUrl: "https://en.kremlin.ru/structure/president",
      authorityName: "Kremlin presidency"
    };
  }

  return {
    personName,
    deadlineMs,
    administrationUrl: "https://www.whitehouse.gov/administration/",
    authorityName: "White House administration"
  };
}

function parsePardonDirectSpec(market: MarketContext): PardonDirectSpec | null {
  const { category, resolutionArchetype, title, rulesText, endTimeUtc } = market.canonicalMarket;
  if (category !== "politics" || resolutionArchetype !== "official_announcement_by_deadline") {
    return null;
  }

  const loweredRules = rulesText.toLowerCase();
  if (!/\b(pardon|commutation|reprieve|clemency)\b/.test(loweredRules)) {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(/^Will (.+?) pardon (.+?)(?:\s+by\b|\s+before\b|$)/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const deadlineMs = Date.parse(endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const principalName = match[1].trim();
  const subjectName = match[2].trim();
  const searchTerms = encodeURIComponent(`${subjectName} pardon`);

  return {
    principalName,
    subjectName,
    deadlineMs,
    officialSearchUrl: `https://www.whitehouse.gov/?s=${searchTerms}`
  };
}

function parsePartyNominationDirectSpec(market: MarketContext): PartyNominationDirectSpec | null {
  const { category, title, endTimeUtc } = market.canonicalMarket;
  if (category !== "politics") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(
    /^Will (.+?) win the (\d{4}) (Democratic|Republican) presidential nomination$/i
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const deadlineMs = Date.parse(endTimeUtc);
  const targetYear = Number.parseInt(match[2], 10);
  if (Number.isNaN(deadlineMs) || !Number.isFinite(targetYear)) {
    return null;
  }

  const partyName = /^republican$/i.test(match[3]) ? "Republican" : "Democratic";
  return {
    candidateName: match[1].trim(),
    partyName,
    targetYear,
    deadlineMs,
    officialPartyUrl: partyName === "Republican" ? "https://gop.com/" : "https://democrats.org/"
  };
}

function parseWorldOfficialSignalDirectSpec(market: MarketContext): WorldOfficialSignalDirectSpec | null {
  const { category, resolutionArchetype, title, endTimeUtc } = market.canonicalMarket;
  if (category !== "world" || resolutionArchetype !== "official_announcement_by_deadline") {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const deadlineMs = Date.parse(endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  let eventKind: "ceasefire" | "invasion" | null = null;
  if (/\bceasefire\b/i.test(normalizedTitle)) {
    eventKind = "ceasefire";
  } else if (/\binvad(?:e|es|ed|ing)\b/i.test(normalizedTitle)) {
    eventKind = "invasion";
  }

  if (!eventKind) {
    return null;
  }

  const focusTopic = extractResolutionFocusTopic(title);
  const officialDomains = extractOfficialDomainsForMarket(market, focusTopic);
  const directUrls = extractOfficialUrlsForMarket(market, focusTopic);
  const officialUrls = buildWorldOfficialUrls(officialDomains, directUrls);
  if (officialUrls.length === 0) {
    return null;
  }

  const subjectAliases = dedupeStrings([
    ...(/\brussia\b/i.test(normalizedTitle) ? ["russia", "russian"] : []),
    ...(/\bukraine\b/i.test(normalizedTitle) ? ["ukraine", "ukrainian"] : []),
    ...(/\bchina\b/i.test(normalizedTitle) ? ["china", "chinese"] : []),
    ...(/\btaiwan\b/i.test(normalizedTitle) ? ["taiwan", "taiwanese"] : [])
  ]);

  return {
    eventKind,
    eventLabel: normalizedTitle,
    subjectAliases,
    deadlineMs,
    officialUrls
  };
}

function parsePresidentialElectionDirectSpec(market: MarketContext): PresidentialElectionDirectSpec | null {
  if (market.canonicalMarket.category !== "politics") {
    return null;
  }

  const normalizedTitle = market.canonicalMarket.title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(/^Will (.+?) win the (\d{4}) US presidential election$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const deadlineMs = Date.parse(market.canonicalMarket.endTimeUtc);
  const targetYear = Number.parseInt(match[2], 10);
  if (Number.isNaN(deadlineMs) || !Number.isFinite(targetYear)) {
    return null;
  }

  return {
    candidateName: match[1].trim(),
    targetYear,
    deadlineMs,
    officialElectionUrl: "https://www.fec.gov/"
  };
}

function parseCryptoLaunchMetricDirectSpec(market: MarketContext): CryptoLaunchMetricDirectSpec | null {
  const { category, title, rulesText, endTimeUtc } = market.canonicalMarket;
  if (category !== "crypto") {
    return null;
  }

  const text = `${title}\n${rulesText}`.toLowerCase();
  if (!(/\bmarket cap\b|\bfdv\b/.test(text) && /\bone day after launch\b|\b24 hours after launch\b/.test(text))) {
    return null;
  }

  const normalizedTitle = title.trim().replace(/\?+$/, "");
  const match = normalizedTitle.match(/^(.+?) market cap \(fdv\)\s*[<>]=?.*one day after launch$/i);
  const projectName = match?.[1]?.trim();
  const deadlineMs = Date.parse(endTimeUtc);
  if (!projectName || Number.isNaN(deadlineMs)) {
    return null;
  }

  const domains = extractOfficialDomainsForMarket(market);
  const generated = domains.map((domain) => `https://${domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}/`);
  if (domains.some((domain) => domain === "megaeth.com" || domain === "www.megaeth.com")) {
    generated.push("https://sale.megaeth.com/");
  }

  const officialUrls = dedupeStrings(generated).slice(0, 4);
  if (officialUrls.length === 0) {
    return null;
  }

  return {
    projectName,
    deadlineMs,
    officialUrls
  };
}

async function fetchCompanyOfficialSignal(url: string): Promise<{
  ok: boolean;
  url: string;
  durationMs: number;
  listingDetected: boolean;
  summary: string;
}> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "User-Agent": "polymarket-deep-research/0.1 (+https://polymarket.com)"
      }
    }, {
      maxAttempts: 1,
      baseDelayMs: 750,
      timeoutMs: 5000
    });

    if (!response.ok) {
      return {
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        listingDetected: false,
        summary: `HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("pdf") || contentType.includes("application/octet-stream")) {
      return {
        ok: false,
        url: response.url || url,
        durationMs: Date.now() - startedAt,
        listingDetected: false,
        summary: "Unsupported content type"
      };
    }

    const raw = await response.text();
    const text = contentType.includes("text/plain") ? normalizeDirectText(raw) : htmlToDirectText(raw);
    const detected = hasPositiveIpoSignal(text);
    const summary = detected
      ? clipDirectSnippet(text, /(ipo|initial public offering|began trading|begins trading|started trading|listed on|trades under|ticker)/i)
      : "No qualifying IPO or listing language found on this official page.";

    return {
      ok: text.length >= 80,
      url: response.url || url,
      durationMs: Date.now() - startedAt,
      listingDetected: detected,
      summary
    };
  } catch {
    return {
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      listingDetected: false,
      summary: "Fetch failed"
    };
  }
}

async function fetchCompanyReleaseSignal(
  url: string,
  spec: CompanyReleaseDirectSpec
): Promise<{
  ok: boolean;
  url: string;
  durationMs: number;
  releaseDetected: boolean;
  summary: string;
  extractionCostUsd: number;
}> {
  const startedAt = Date.now();
  const objective = `Extract official release evidence for ${spec.releaseTopic}. Focus on public release, launch, availability, order, product page, docs, and announcement language.`;

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "User-Agent": "polymarket-deep-research/0.1 (+https://polymarket.com)"
      }
    }, {
      maxAttempts: 1,
      baseDelayMs: 750,
      timeoutMs: 5000
    });

    if (!response.ok) {
      const extracted = await extractDirectTextViaParallel(url, objective);
      if (extracted.ok) {
        const detected = hasPositiveReleaseSignal(extracted.text, spec);
        return {
          ok: true,
          url: extracted.url,
          durationMs: Date.now() - startedAt,
          releaseDetected: detected,
          summary: detected
            ? clipDirectSnippet(extracted.text, /(available now|now available|released|launch(?:ed)?|shipping|pre-?order|order now|generally available|general availability|rollout|announcing)/i)
            : `No qualifying public release signal found for ${spec.releaseTopic} on this official page.`,
          extractionCostUsd: extracted.extractionCostUsd
        };
      }

      return {
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        releaseDetected: false,
        summary: `HTTP ${response.status}`,
        extractionCostUsd: 0
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("pdf") || contentType.includes("application/octet-stream")) {
      const extracted = await extractDirectTextViaParallel(response.url || url, objective);
      if (extracted.ok) {
        const detected = hasPositiveReleaseSignal(extracted.text, spec);
        return {
          ok: true,
          url: extracted.url,
          durationMs: Date.now() - startedAt,
          releaseDetected: detected,
          summary: detected
            ? clipDirectSnippet(extracted.text, /(available now|now available|released|launch(?:ed)?|shipping|pre-?order|order now|generally available|general availability|rollout|announcing)/i)
            : `No qualifying public release signal found for ${spec.releaseTopic} on this official page.`,
          extractionCostUsd: extracted.extractionCostUsd
        };
      }

      return {
        ok: false,
        url: response.url || url,
        durationMs: Date.now() - startedAt,
        releaseDetected: false,
        summary: "Unsupported content type",
        extractionCostUsd: 0
      };
    }

    const raw = await response.text();
    const text = contentType.includes("text/plain") ? normalizeDirectText(raw) : htmlToDirectText(raw);
    if (text.length < 80) {
      const extracted = await extractDirectTextViaParallel(response.url || url, objective);
      if (extracted.ok) {
        const detected = hasPositiveReleaseSignal(extracted.text, spec);
        return {
          ok: true,
          url: extracted.url,
          durationMs: Date.now() - startedAt,
          releaseDetected: detected,
          summary: detected
            ? clipDirectSnippet(extracted.text, /(available now|now available|released|launch(?:ed)?|shipping|pre-?order|order now|generally available|general availability|rollout|announcing)/i)
            : `No qualifying public release signal found for ${spec.releaseTopic} on this official page.`,
          extractionCostUsd: extracted.extractionCostUsd
        };
      }
    }
    const detected = hasPositiveReleaseSignal(text, spec);
    const summary = detected
      ? clipDirectSnippet(text, /(available now|now available|released|launch(?:ed)?|shipping|pre-?order|order now|generally available|general availability|rollout|announcing)/i)
      : `No qualifying public release signal found for ${spec.releaseTopic} on this official page.`;

    return {
      ok: text.length >= 80,
      url: response.url || url,
      durationMs: Date.now() - startedAt,
      releaseDetected: detected,
      summary,
      extractionCostUsd: 0
    };
  } catch {
    const extracted = await extractDirectTextViaParallel(url, objective);
    if (extracted.ok) {
      const detected = hasPositiveReleaseSignal(extracted.text, spec);
      return {
        ok: true,
        url: extracted.url,
        durationMs: Date.now() - startedAt,
        releaseDetected: detected,
        summary: detected
          ? clipDirectSnippet(extracted.text, /(available now|now available|released|launch(?:ed)?|shipping|pre-?order|order now|generally available|general availability|rollout|announcing)/i)
          : `No qualifying public release signal found for ${spec.releaseTopic} on this official page.`,
        extractionCostUsd: extracted.extractionCostUsd
      };
    }

    return {
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      releaseDetected: false,
      summary: "Fetch failed",
      extractionCostUsd: 0
    };
  }
}

async function fetchCompanyTransactionSignal(
  url: string,
  spec: CompanyTransactionDirectSpec
): Promise<{
  ok: boolean;
  url: string;
  durationMs: number;
  transactionDetected: boolean;
  summary: string;
  extractionCostUsd: number;
}> {
  const startedAt = Date.now();
  const objective = `Extract official acquisition or merger evidence for ${spec.companyName} and ${spec.targetName}. Focus on official announcement, press release, merger, acquisition, and transaction language.`;

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "User-Agent": "polymarket-deep-research/0.1 (+https://polymarket.com)"
      }
    }, {
      maxAttempts: 1,
      baseDelayMs: 750,
      timeoutMs: 5000
    });

    if (!response.ok) {
      const extracted = await extractDirectTextViaParallel(url, objective);
      if (extracted.ok) {
        const detected = hasPositiveTransactionSignal(extracted.text, spec);
        return {
          ok: true,
          url: extracted.url,
          durationMs: Date.now() - startedAt,
          transactionDetected: detected,
          summary: detected
            ? clipDirectSnippet(extracted.text, /(acquire|acquired|acquisition|merge|merger|deal|transaction|agreement)/i)
            : `No qualifying acquisition or merger announcement found for ${spec.companyName} and ${spec.targetName} on this official page.`,
          extractionCostUsd: extracted.extractionCostUsd
        };
      }

      return {
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        transactionDetected: false,
        summary: `HTTP ${response.status}`,
        extractionCostUsd: 0
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("pdf") || contentType.includes("application/octet-stream")) {
      const extracted = await extractDirectTextViaParallel(response.url || url, objective);
      if (extracted.ok) {
        const detected = hasPositiveTransactionSignal(extracted.text, spec);
        return {
          ok: true,
          url: extracted.url,
          durationMs: Date.now() - startedAt,
          transactionDetected: detected,
          summary: detected
            ? clipDirectSnippet(extracted.text, /(acquire|acquired|acquisition|merge|merger|deal|transaction|agreement)/i)
            : `No qualifying acquisition or merger announcement found for ${spec.companyName} and ${spec.targetName} on this official page.`,
          extractionCostUsd: extracted.extractionCostUsd
        };
      }

      return {
        ok: false,
        url: response.url || url,
        durationMs: Date.now() - startedAt,
        transactionDetected: false,
        summary: "Unsupported content type",
        extractionCostUsd: 0
      };
    }

    const raw = await response.text();
    const text = contentType.includes("text/plain") ? normalizeDirectText(raw) : htmlToDirectText(raw);
    if (text.length < 80) {
      const extracted = await extractDirectTextViaParallel(response.url || url, objective);
      if (extracted.ok) {
        const detected = hasPositiveTransactionSignal(extracted.text, spec);
        return {
          ok: true,
          url: extracted.url,
          durationMs: Date.now() - startedAt,
          transactionDetected: detected,
          summary: detected
            ? clipDirectSnippet(extracted.text, /(acquire|acquired|acquisition|merge|merger|deal|transaction|agreement)/i)
            : `No qualifying acquisition or merger announcement found for ${spec.companyName} and ${spec.targetName} on this official page.`,
          extractionCostUsd: extracted.extractionCostUsd
        };
      }
    }

    const detected = hasPositiveTransactionSignal(text, spec);
    return {
      ok: text.length >= 80,
      url: response.url || url,
      durationMs: Date.now() - startedAt,
      transactionDetected: detected,
      summary: detected
        ? clipDirectSnippet(text, /(acquire|acquired|acquisition|merge|merger|deal|transaction|agreement)/i)
        : `No qualifying acquisition or merger announcement found for ${spec.companyName} and ${spec.targetName} on this official page.`,
      extractionCostUsd: 0
    };
  } catch {
    const extracted = await extractDirectTextViaParallel(url, objective);
    if (extracted.ok) {
      const detected = hasPositiveTransactionSignal(extracted.text, spec);
      return {
        ok: true,
        url: extracted.url,
        durationMs: Date.now() - startedAt,
        transactionDetected: detected,
        summary: detected
          ? clipDirectSnippet(extracted.text, /(acquire|acquired|acquisition|merge|merger|deal|transaction|agreement)/i)
          : `No qualifying acquisition or merger announcement found for ${spec.companyName} and ${spec.targetName} on this official page.`,
        extractionCostUsd: extracted.extractionCostUsd
      };
    }

    return {
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      transactionDetected: false,
      summary: "Fetch failed",
      extractionCostUsd: 0
    };
  }
}

async function fetchWorldOfficialSignal(
  url: string,
  spec: WorldOfficialSignalDirectSpec
): Promise<{
  ok: boolean;
  url: string;
  durationMs: number;
  eventDetected: boolean;
  summary: string;
}> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithRetry(url, {
      headers: PUBLIC_DATA_HEADERS
    }, {
      maxAttempts: 1,
      baseDelayMs: 500,
      timeoutMs: 3000
    });

    if (!response.ok) {
      return {
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        eventDetected: false,
        summary: `HTTP ${response.status}`
      };
    }

    const raw = await response.text();
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const text = contentType.includes("text/plain") ? normalizeDirectText(raw) : htmlToDirectText(raw);
    const eventDetected = hasPositiveWorldSignal(text, spec);
    const summary = eventDetected
      ? clipDirectSnippet(text, spec.eventKind === "ceasefire"
          ? /(ceasefire|truce|armistice|agreement|entered into force|signed)/i
          : /(invad(?:e|ed|es|ing)|troops entered|military operation|attack launched|armed forces)/i)
      : `No qualifying official ${spec.eventKind} signal found on this monitored official page.`;

    return {
      ok: text.length >= 80,
      url: response.url || url,
      durationMs: Date.now() - startedAt,
      eventDetected,
      summary
    };
  } catch {
    return {
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      eventDetected: false,
      summary: "Fetch failed"
    };
  }
}

async function extractDirectTextViaParallel(url: string, objective: string): Promise<{
  ok: boolean;
  url: string;
  text: string;
  extractionCostUsd: number;
}> {
  if (env.PARALLEL_API_KEY.trim() === "") {
    return {
      ok: false,
      url,
      text: "",
      extractionCostUsd: 0
    };
  }

  try {
    const response = await fetchWithRetry("https://api.parallel.ai/v1beta/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.PARALLEL_API_KEY,
        "parallel-beta": "search-extract-2025-10-10"
      },
      body: JSON.stringify({
        urls: [url],
        objective,
        fetch_policy: {
          max_age_seconds: 1800
        },
        excerpts: {
          max_chars_per_result: 2500,
          max_chars_total: 5000
        },
        full_content: {
          max_chars_per_result: 8000
        }
      })
    }, {
      maxAttempts: 2,
      baseDelayMs: 750,
      timeoutMs: 8000
    });

    const payload = (await response.json()) as {
      results?: Array<{
        url?: string;
        excerpts?: string[];
        full_content?: string;
      }>;
    };

    if (!response.ok) {
      return {
        ok: false,
        url,
        text: "",
        extractionCostUsd: 0
      };
    }

    const first = payload.results?.[0];
    const text = [first?.excerpts?.join("\n\n"), first?.full_content].filter(Boolean).join("\n\n").trim();
    if (text.length < 80) {
      return {
        ok: false,
        url: first?.url ?? url,
        text,
        extractionCostUsd: 0.001
      };
    }

    return {
      ok: true,
      url: first?.url ?? url,
      text: normalizeDirectText(text),
      extractionCostUsd: 0.001
    };
  } catch {
    return {
      ok: false,
      url,
      text: "",
      extractionCostUsd: 0
    };
  }
}

async function collectOkSignals<T extends { ok: boolean }>(
  urls: string[],
  fetcher: (url: string) => Promise<T>,
  batchSize: number
): Promise<Array<T & { ok: true }>> {
  const firstBatch = (await Promise.all(urls.slice(0, batchSize).map((url) => fetcher(url)))).filter(
    (item) => item.ok
  ) as Array<T & { ok: true }>;

  if (firstBatch.length > 0 || urls.length <= batchSize) {
    return firstBatch;
  }

  return (await Promise.all(urls.slice(batchSize, batchSize * 2).map((url) => fetcher(url)))).filter(
    (item) => item.ok
  ) as Array<T & { ok: true }>;
}

async function fetchCryptoLaunchSignal(
  url: string,
  projectName: string
): Promise<{
  ok: boolean;
  url: string;
  durationMs: number;
  launchDetected: boolean;
  summary: string;
}> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "User-Agent": "polymarket-deep-research/0.1 (+https://polymarket.com)"
      }
    }, {
      maxAttempts: 1,
      baseDelayMs: 750,
      timeoutMs: 5000
    });

    if (!response.ok) {
      return {
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        launchDetected: false,
        summary: `HTTP ${response.status}`
      };
    }

    const raw = await response.text();
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const text = contentType.includes("text/plain") ? normalizeDirectText(raw) : htmlToDirectText(raw);
    const launchDetected = hasPositiveCryptoLaunchSignal(text, projectName);
    const summary = launchDetected
      ? clipDirectSnippet(text, /(tge|token generation event|token launch|listed on|trading now|now live|tradable|swappable|exchange listing)/i)
      : `No clear token launch, TGE, listing, or live trading signal found on this official page for ${projectName}.`;

    return {
      ok: text.length >= 80,
      url: response.url || url,
      durationMs: Date.now() - startedAt,
      launchDetected,
      summary
    };
  } catch {
    return {
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      launchDetected: false,
      summary: "Fetch failed"
    };
  }
}

function hasPositiveIpoSignal(text: string): boolean {
  const lowered = text.toLowerCase();
  const broadSignal =
    /\b(ipo|initial public offering|direct listing|listed on nasdaq|listed on nyse|shares began trading|shares begin trading|started trading|begins trading|trades under the ticker|ticker symbol)\b/.test(lowered);
  const weakSignal =
    /\b(go public|public offering|listed on)\b/.test(lowered);

  return broadSignal || weakSignal;
}

function hasPositiveCryptoLaunchSignal(text: string, projectName: string): boolean {
  const lowered = text.toLowerCase();
  const projectAliases = buildReleaseTopicAliases(projectName);
  const projectMentioned = projectAliases.some((alias) => lowered.includes(alias));
  if (!projectMentioned) {
    return false;
  }

  const strongLaunch =
    /\b(tge|token generation event|token launch|token is live|launch is live|now tradable|tradable now|swappable now|trading now|now trading|listed on|exchange listing)\b/.test(lowered);
  const futureOnly =
    /\b(coming soon|coming in|planned for|expected in|targeted for|will launch|to launch|launching in)\b/.test(lowered);

  return strongLaunch && !futureOnly;
}

function hasPositiveReleaseSignal(text: string, spec: CompanyReleaseDirectSpec): boolean {
  const lowered = text.toLowerCase();
  const topicAliases = buildReleaseTopicAliases(spec.releaseTopic);
  const topicMentioned = topicAliases.some((alias) => lowered.includes(alias));
  if (!topicMentioned) {
    return false;
  }

  const strongAvailability = /\b(available now|now available|released today|is released|has launched|launching now|now shipping|shipping now|order now|pre-?order now|generally available|general availability|rolling out now|rollout has begun)\b/.test(lowered);
  const announcementStyle = /\b(announcing|introducing|launch(?:ed)?|release(?:d)?|now in|available in|available via the api|available to users)\b/.test(lowered);
  const futureOnly = /\b(coming soon|coming in|planned for|targeted for|expected in|available in 2027|available in 2028|sales in 2027|sales in 2028)\b/.test(lowered);

  if (spec.category === "technology") {
    return (strongAvailability || announcementStyle) && !futureOnly;
  }

  return strongAvailability && !futureOnly;
}

function hasPositiveWorldSignal(text: string, spec: WorldOfficialSignalDirectSpec): boolean {
  const lowered = text.toLowerCase();
  const subjectMentioned =
    spec.subjectAliases.length === 0 || spec.subjectAliases.some((alias) => lowered.includes(alias));

  if (!subjectMentioned) {
    return false;
  }

  if (spec.eventKind === "ceasefire") {
    const positive = /\b(ceasefire|truce|armistice|mutual ceasefire|cease-fire|agreement entered into force|ceasefire agreement)\b/.test(lowered);
    const futureOnly = /\b(proposed|proposal|seeking|seek|talks|discussed|discussion|possible|potential|framework|draft)\b/.test(lowered);
    return positive && !futureOnly;
  }

  const invasionPositive = /\b(invad(?:e|ed|es|ing)|troops entered|launched an attack|armed forces entered|military operation has begun|crossed the border)\b/.test(lowered);
  const futureOnly = /\b(threat|threaten|exercise|drill|possible|potential|preparing|warned|warning)\b/.test(lowered);
  return invasionPositive && !futureOnly;
}

function findQualifyingEntertainmentAlbum(
  results: AppleAlbumSearchResult[],
  spec: EntertainmentAlbumDirectSpec
): AppleAlbumSearchResult | null {
  const artistAliases = buildReleaseTopicAliases(spec.artistName);
  const suspiciousReleasePattern = /\b(single|ep|deluxe|expanded|anniversary|reissue|re-release|remaster(?:ed)?|live|karaoke|instrumental|commentary|greatest hits|best of|compilation|bonus track)\b/i;

  const candidates = results
    .map((result) => {
      const artistName = normalizeDirectText(result.artistName);
      const collectionName = normalizeDirectText(result.collectionName);
      const releaseDateMs =
        typeof result.releaseDate === "string" && !Number.isNaN(Date.parse(result.releaseDate))
          ? Date.parse(result.releaseDate)
          : null;

      return {
        ...result,
        artistName,
        collectionName,
        releaseDateMs
      };
    })
    .filter((result) => {
      if (!result.artistName || !result.collectionName || result.releaseDateMs == null) {
        return false;
      }

      const normalizedArtist = result.artistName.toLowerCase();
      const artistMatches = artistAliases.some((alias) => normalizedArtist === alias || normalizedArtist.includes(alias));
      if (!artistMatches) {
        return false;
      }

      if (result.releaseDateMs < spec.baselineReleasedAfterMs || result.releaseDateMs > Date.now()) {
        return false;
      }

      if ((result.trackCount ?? 0) > 0 && (result.trackCount ?? 0) < 6) {
        return false;
      }

      if (suspiciousReleasePattern.test(result.collectionName)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => (right.releaseDateMs ?? 0) - (left.releaseDateMs ?? 0));

  return candidates[0] ?? null;
}

function hasPositiveTransactionSignal(text: string, spec: CompanyTransactionDirectSpec): boolean {
  const lowered = text.toLowerCase();
  const companyAliases = buildReleaseTopicAliases(spec.companyName);
  const targetAliases = buildReleaseTopicAliases(spec.targetName);
  const companyMentioned = companyAliases.some((alias) => lowered.includes(alias));
  const targetMentioned = targetAliases.some((alias) => lowered.includes(alias));

  if (!companyMentioned || !targetMentioned) {
    return false;
  }

  const transactionSignal = /\b(acquire|acquired|acquiring|acquisition|merge(?:r|d|s|ing)?|transaction|deal|agreement to acquire|agreement to merge)\b/.test(lowered);
  const rumorOnly = /\b(reportedly|rumor|rumoured|considering|weighing|exploring|bid(?:ding)? for)\b/.test(lowered);

  return transactionSignal && !rumorOnly;
}

function clipDirectSnippet(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match || match.index == null) {
    return text.slice(0, 220);
  }

  const start = Math.max(0, match.index - 80);
  const end = Math.min(text.length, match.index + 180);
  return text.slice(start, end).trim();
}

function htmlToDirectText(html: string): string {
  const withoutScripts = html
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const blockSpaced = withoutScripts.replace(/<\/?(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|br|tr|td)[^>]*>/gi, "\n");
  const text = blockSpaced.replace(/<[^>]+>/g, " ");

  return normalizeDirectText(
    text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  ).slice(0, 12000);
}

function normalizeDirectText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function buildReleaseTopicAliases(topic: string): string[] {
  const normalized = topic.toLowerCase().trim();
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  const spacedDigits = normalized.replace(/(\d+)/g, " $1").replace(/\s+/g, " ").trim();

  return dedupeStrings([
    normalized,
    normalized.replace(/-/g, " "),
    normalized.replace(/\s+/g, ""),
    compact,
    spacedDigits
  ]).filter((value) => value.length >= 3);
}

function buildReleaseTopicSlugs(topic: string): string[] {
  const normalized = topic.toLowerCase().trim();
  const hyphen = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const compact = normalized.replace(/[^a-z0-9]+/g, "");

  return dedupeStrings([hyphen, compact]).filter((value) => value.length >= 3);
}

function findNhlStanding(payload: NhlStandingsPayload, teamName: string) {
  const normalizedTarget = normalizeTeamName(teamName);
  return (payload.standings ?? []).find((row) => {
    const candidates = [
      row.teamName?.default,
      row.teamCommonName?.default,
      row.teamAbbrev?.default
    ].filter((value): value is string => typeof value === "string" && value.trim() !== "");

    return candidates.some((candidate) => sameTeamName(candidate, normalizedTarget));
  });
}

function findNhlChampion(payload: NhlBracketPayload): { name: string; abbrev?: string } | null {
  const series = (payload.series ?? []).filter((item) => typeof item.playoffRound === "number");
  if (series.length === 0) {
    return null;
  }

  const finalRound = Math.max(...series.map((item) => item.playoffRound ?? 0));
  const finalSeries = series.filter((item) => item.playoffRound === finalRound);
  for (const seriesItem of finalSeries) {
    if ((seriesItem.topSeedWins ?? 0) >= 4 && seriesItem.topSeedTeam?.name?.default) {
      return {
        name: seriesItem.topSeedTeam.name.default,
        abbrev: seriesItem.topSeedTeam.abbrev
      };
    }

    if ((seriesItem.bottomSeedWins ?? 0) >= 4 && seriesItem.bottomSeedTeam?.name?.default) {
      return {
        name: seriesItem.bottomSeedTeam.name.default,
        abbrev: seriesItem.bottomSeedTeam.abbrev
      };
    }
  }

  return null;
}

function normalizeTeamName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sameTeamName(left: string, right: string): boolean {
  const normalizedLeft = normalizeTeamName(left);
  const normalizedRight = normalizeTeamName(right);
  return normalizedLeft === normalizedRight;
}

function parseNasaGistempAnnualRows(body: string): Array<{ year: number; value: number }> {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{4}\s+[-\d.]+/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        year: Number.parseInt(parts[0] ?? "", 10),
        value: Number.parseFloat(parts[1] ?? "")
      };
    })
    .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.value));
}

function computeCompetitionRank(
  rows: Array<{ year: number; value: number }>,
  targetYear: number
): number | null {
  const sorted = [...rows].sort((left, right) => {
    if (right.value !== left.value) {
      return right.value - left.value;
    }
    return left.year - right.year;
  });

  let currentRank = 0;
  let previousValue: number | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]!;
    if (previousValue == null || row.value !== previousValue) {
      currentRank = index + 1;
      previousValue = row.value;
    }

    if (row.year === targetYear) {
      return currentRank;
    }
  }

  return null;
}

function evaluateHotYearRank(
  rank: number,
  spec: { mode: "exact" | "at_least"; rank: number }
): DirectLegacyState {
  if (spec.mode === "exact") {
    return rank === spec.rank ? "YES" : "NO";
  }

  return rank >= spec.rank ? "YES" : "NO";
}

function estimateNasaAnnualReleaseAt(targetYear: number): string {
  const candidate = Date.UTC(targetYear + 1, 0, 15, 15, 0, 0);
  return new Date(candidate > Date.now() ? candidate : Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function parseFedCutsDirectSpec(market: MarketContext): FedCutsDirectSpec | null {
  if (market.canonicalMarket.category !== "macro") {
    return null;
  }

  const text = [
    market.canonicalMarket.title,
    market.canonicalMarket.rulesText,
    market.canonicalMarket.description ?? ""
  ].join("\n");
  const lowered = text.toLowerCase();

  if (!/\bexact amount of cuts\b/.test(lowered) || !/\bfomc\b/.test(lowered) || !/\btarget federal funds rate\b/.test(lowered)) {
    return null;
  }

  const title = market.canonicalMarket.title.trim().replace(/\?+$/, "");
  const yearMatch = lowered.match(/\bin\s+(20\d{2})\b/);
  const targetYear = yearMatch?.[1] ? Number.parseInt(yearMatch[1], 10) : null;
  if (!targetYear) {
    return null;
  }

  const noMatch = title.match(/^Will no Fed rate cuts happen in \d{4}$/i);
  if (noMatch) {
    return {
      targetYear,
      targetCuts: 0,
      deadlineMs: buildFedCutsDeadlineMs(targetYear),
      upperSeriesId: "DFEDTARU",
      officialCalendarUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      officialOpenMarketUrl: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm"
    };
  }

  const countMatch = title.match(/^Will (\d+) Fed rate cut(?:s)? happen in \d{4}$/i);
  if (countMatch?.[1]) {
    return {
      targetYear,
      targetCuts: Number.parseInt(countMatch[1], 10),
      deadlineMs: buildFedCutsDeadlineMs(targetYear),
      upperSeriesId: "DFEDTARU",
      officialCalendarUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      officialOpenMarketUrl: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm"
    };
  }

  const wordCountMatch = title.match(/^Will (one|two|three|four|five|six|seven|eight|nine|ten) Fed rate cut(?:s)? happen in \d{4}$/i);
  if (wordCountMatch?.[1]) {
    const value = parseSmallNumberWord(wordCountMatch[1]);
    if (value != null) {
      return {
        targetYear,
        targetCuts: value,
        deadlineMs: buildFedCutsDeadlineMs(targetYear),
        upperSeriesId: "DFEDTARU",
        officialCalendarUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        officialOpenMarketUrl: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm"
      };
    }
  }

  return null;
}

function buildFedCutsDeadlineMs(targetYear: number): number {
  return Date.UTC(targetYear + 1, 0, 1, 4, 59, 59);
}

function parseSmallNumberWord(value: string): number | null {
  const map: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  return map[value.toLowerCase()] ?? null;
}

async function fetchFredObservationsForFedCuts(
  spec: FedCutsDirectSpec
): Promise<Array<{ date: string; value: number }>> {
  const observationStart = `${spec.targetYear - 1}-12-01`;
  const observationEnd = `${spec.targetYear}-12-31`;
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", spec.upperSeriesId);
  url.searchParams.set("api_key", env.FRED_API_KEY);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", observationStart);
  url.searchParams.set("observation_end", observationEnd);
  url.searchParams.set("sort_order", "asc");
  url.searchParams.set("limit", "500");

  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json"
    }
  }, {
    maxAttempts: 2,
    baseDelayMs: 750
  });

  if (!response.ok) {
    throw new Error(`FRED fed-cuts observations failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    observations?: Array<{ date?: string; value?: string }>;
  };

  return (payload.observations ?? [])
    .map((item) => {
      const numeric = item.value == null || item.value === "." || item.value === "" ? null : Number.parseFloat(item.value);
      if (!item.date || !Number.isFinite(numeric)) {
        return null;
      }

      return {
        date: item.date,
        value: numeric
      };
    })
    .filter((item): item is { date: string; value: number } => Boolean(item));
}

function countFedCutEvents(
  observations: Array<{ date: string; value: number }>,
  targetYear: number
): Array<{ date: string; previousUpper: number; nextUpper: number; deltaBps: number; cutCount: number }> {
  const events: Array<{ date: string; previousUpper: number; nextUpper: number; deltaBps: number; cutCount: number }> = [];

  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1]!;
    const current = observations[index]!;
    const currentYear = Number.parseInt(current.date.slice(0, 4), 10);
    if (currentYear !== targetYear) {
      continue;
    }

    const delta = previous.value - current.value;
    if (delta <= 0.0001) {
      continue;
    }

    const deltaBps = Math.round(delta * 10000) / 100;
    const cutCount = Math.max(1, Math.ceil((delta * 100 - 1e-9) / 25));
    events.push({
      date: current.date,
      previousUpper: previous.value,
      nextUpper: current.value,
      deltaBps,
      cutCount
    });
  }

  return events;
}

function estimateFedCutsNextCheckAt(spec: FedCutsDirectSpec): string {
  const now = Date.now();
  if (now >= spec.deadlineMs) {
    return new Date(spec.deadlineMs).toISOString();
  }

  return new Date(Math.min(spec.deadlineMs, now + 24 * 60 * 60 * 1000)).toISOString();
}

function buildFedCutsEvidence(
  events: Array<{ date: string; previousUpper: number; nextUpper: number; deltaBps: number; cutCount: number }>,
  spec: FedCutsDirectSpec
): string[] {
  if (events.length === 0) {
    return [
      `Official Federal Reserve target range data shows 0 cuts so far in ${spec.targetYear}.`
    ];
  }

  return events.map((event) =>
    `${event.date}: target upper limit moved from ${formatMetricValue(event.previousUpper)} to ${formatMetricValue(event.nextUpper)} (${event.deltaBps.toFixed(2)} bps), counted as ${event.cutCount} cut${event.cutCount === 1 ? "" : "s"}.`
  );
}

function buildFedCutsDirectCitations(
  spec: FedCutsDirectSpec,
  events: Array<{ date: string; previousUpper: number; nextUpper: number; deltaBps: number; cutCount: number }>
): ProviderSearchResultItem[] {
  const items: ProviderSearchResultItem[] = [
    {
      title: "Official Federal Reserve FOMC calendar",
      url: spec.officialCalendarUrl,
      snippet: `Official scheduled FOMC meetings for ${spec.targetYear}.`,
      source: "official"
    },
    {
      title: "Official Federal Reserve target rate page",
      url: spec.officialOpenMarketUrl,
      snippet: "Official Federal Reserve page for target federal funds rate level and changes.",
      source: "official"
    },
    {
      title: "Official FRED target range upper limit series",
      url: "https://fred.stlouisfed.org/series/DFEDTARU",
      snippet: events.length > 0
        ? `Official daily target range series capturing ${events.length} cut event(s) in ${spec.targetYear}.`
        : `Official daily target range series showing no cut events yet in ${spec.targetYear}.`,
      source: "official"
    }
  ];

  return items;
}

function parseRecessionDirectSpec(market: MarketContext): RecessionDirectSpec | null {
  if (market.canonicalMarket.category !== "macro") {
    return null;
  }

  const text = [
    market.canonicalMarket.title,
    market.canonicalMarket.rulesText,
    market.canonicalMarket.description ?? "",
    market.canonicalMarket.additionalContext ?? ""
  ].join("\n");
  const lowered = text.toLowerCase();

  if (!/\brecession\b/.test(lowered) || !/\btwo consecutive quarters\b/.test(lowered) || !/\breal gdp\b/.test(lowered)) {
    return null;
  }

  const deadlineMs = Date.parse(market.canonicalMarket.endTimeUtc);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  const betweenMatch = lowered.match(/\bbetween\s+q([1-4])\s+(20\d{2})\s+and\s+q([1-4])\s+(20\d{2})\b/);
  let startQuarter: RecessionQuarter | null = null;
  let endQuarter: RecessionQuarter | null = null;

  if (betweenMatch?.[1] && betweenMatch[2] && betweenMatch[3] && betweenMatch[4]) {
    startQuarter = buildQuarter(Number.parseInt(betweenMatch[2], 10), Number.parseInt(betweenMatch[1], 10) as 1 | 2 | 3 | 4);
    endQuarter = buildQuarter(Number.parseInt(betweenMatch[4], 10), Number.parseInt(betweenMatch[3], 10) as 1 | 2 | 3 | 4);
  } else {
    const quarterMatches = [...lowered.matchAll(/\bq([1-4])\s+(20\d{2})\b/g)];
    if (quarterMatches.length >= 2) {
      const first = quarterMatches[0]!;
      const last = quarterMatches[quarterMatches.length - 1]!;
      startQuarter = buildQuarter(Number.parseInt(first[2]!, 10), Number.parseInt(first[1]!, 10) as 1 | 2 | 3 | 4);
      endQuarter = buildQuarter(Number.parseInt(last[2]!, 10), Number.parseInt(last[1]!, 10) as 1 | 2 | 3 | 4);
    }
  }

  if (!startQuarter || !endQuarter || startQuarter.index > endQuarter.index) {
    return null;
  }

  return {
    startQuarter,
    endQuarter,
    deadlineMs,
    beaUrl: "https://www.bea.gov/data/gdp/gross-domestic-product",
    nberUrl: "https://www.nber.org/research/business-cycle-dating"
  };
}

function buildQuarter(year: number, quarter: 1 | 2 | 3 | 4): RecessionQuarter {
  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    index: year * 4 + quarter
  };
}

function quarterFromObservationDate(date: string): RecessionQuarter | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const quarter = (Math.floor(parsed.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return buildQuarter(year, quarter);
}

function quarterStartDate(quarter: RecessionQuarter): string {
  const month = String((quarter.quarter - 1) * 3 + 1).padStart(2, "0");
  return `${quarter.year}-${month}-01`;
}

function quarterEndDate(quarter: RecessionQuarter): string {
  const month = String((quarter.quarter - 1) * 3 + 3).padStart(2, "0");
  const day = quarter.quarter === 1 ? "31" : quarter.quarter === 2 ? "30" : quarter.quarter === 3 ? "30" : "31";
  return `${quarter.year}-${month}-${day}`;
}

function findConsecutiveNegativeGdpPair(
  observations: Array<RecessionQuarter & { date: string; value: number }>
): { first: RecessionQuarter & { date: string; value: number }; second: RecessionQuarter & { date: string; value: number } } | null {
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1]!;
    const current = observations[index]!;
    if (current.index === previous.index + 1 && previous.value < 0 && current.value < 0) {
      return {
        first: previous,
        second: current
      };
    }
  }

  return null;
}

function findNberRecessionSignal(
  observations: Array<{ date: string; value: string }>,
  spec: RecessionDirectSpec
): { date: string; value: number } | null {
  for (const item of observations) {
    const value = Number.parseFloat(item.value);
    if (!Number.isFinite(value) || value < 1) {
      continue;
    }

    const parsed = new Date(`${item.date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    const year = parsed.getUTCFullYear();
    if (year < spec.startQuarter.year || year > spec.endQuarter.year) {
      continue;
    }

    return {
      date: item.date,
      value
    };
  }

  return null;
}

function estimateRecessionNextCheckAt(
  spec: RecessionDirectSpec,
  latestQuarter?: RecessionQuarter
): string {
  if (!latestQuarter || latestQuarter.index < spec.endQuarter.index) {
    const nextQuarter = latestQuarter
      ? buildQuarter(
          latestQuarter.quarter === 4 ? latestQuarter.year + 1 : latestQuarter.year,
          latestQuarter.quarter === 4 ? 1 : ((latestQuarter.quarter + 1) as 1 | 2 | 3 | 4)
        )
      : spec.startQuarter;
    const releaseMonthIndex = nextQuarter.quarter * 3;
    const releaseAt = Date.UTC(nextQuarter.year, releaseMonthIndex, 30, 13, 30, 0);
    return new Date(Math.min(spec.deadlineMs, releaseAt)).toISOString();
  }

  return new Date(Math.min(spec.deadlineMs, Date.now() + 14 * 24 * 60 * 60 * 1000)).toISOString();
}

function buildRecessionDirectCitations(
  spec: RecessionDirectSpec,
  gdpSeriesTitle: string,
  nberSignal: { date: string; value: number } | null
): ProviderSearchResultItem[] {
  const citations: ProviderSearchResultItem[] = [
    {
      title: "Official BEA GDP release page",
      url: spec.beaUrl,
      snippet: `Official BEA GDP release source for ${spec.startQuarter.label} through ${spec.endQuarter.label}.`,
      source: "official"
    },
    {
      title: `Official FRED mirror of ${gdpSeriesTitle}`,
      url: "https://fred.stlouisfed.org/series/A191RL1Q225SBEA",
      snippet: "Official quarterly real GDP growth series used for the two-consecutive-negative-quarters rule.",
      source: "official"
    },
    {
      title: "Official NBER business cycle dating page",
      url: spec.nberUrl,
      snippet: "Official NBER recession-announcement source referenced by the market rules.",
      source: "official"
    }
  ];

  if (nberSignal) {
    citations.push({
      title: "Official FRED NBER recession indicator",
      url: "https://fred.stlouisfed.org/series/USREC",
      snippet: `NBER-based recession indicator includes recession month ${nberSignal.date}.`,
      source: "official"
    });
  }

  return citations;
}

function buildMacroDirectCitations(context: MacroOfficialContext): ProviderSearchResultItem[] {
  return [
    {
      title: `${context.seriesId} on FRED`,
      url: context.officialUrl,
      snippet: `Official FRED series page for ${context.title}.`
    }
  ];
}

function parseThreshold(title: string, rulesText: string): ThresholdSpec | null {
  const normalizedTitle = title.replace(/,/g, "");

  const betweenMatch = normalizedTitle.match(/between\s+\$?(\d+(?:\.\d+)?)\s+and\s+\$?(\d+(?:\.\d+)?)/i);
  if (betweenMatch) {
    const min = Number.parseFloat(betweenMatch[1] ?? "");
    const max = Number.parseFloat(betweenMatch[2] ?? "");
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      const upperInclusive = !/higher range bracket/i.test(rulesText);
      return {
        kind: "range",
        min,
        max,
        lowerInclusive: true,
        upperInclusive
      };
    }
  }

  const aboveMatch = normalizedTitle.match(/\b(above|over|greater than|at least)\s+\$?(\d+(?:\.\d+)?)/i);
  if (aboveMatch) {
    const threshold = Number.parseFloat(aboveMatch[2] ?? "");
    if (Number.isFinite(threshold)) {
      return {
        kind: "above",
        threshold,
        inclusive: /\bat least\b/i.test(aboveMatch[1] ?? "")
      };
    }
  }

  const belowMatch = normalizedTitle.match(/\b(below|under|less than|at most)\s+\$?(\d+(?:\.\d+)?)/i);
  if (belowMatch) {
    const threshold = Number.parseFloat(belowMatch[2] ?? "");
    if (Number.isFinite(threshold)) {
      return {
        kind: "below",
        threshold,
        inclusive: /\bat most\b/i.test(belowMatch[1] ?? "")
      };
    }
  }

  return null;
}

function parseCompactDollarThreshold(title: string): number | null {
  const normalized = title.replace(/,/g, "");
  const match = normalized.match(/\$?(\d+(?:\.\d+)?)([kmb])\b/i) ?? normalized.match(/\$?(\d+(?:\.\d+)?)(?![a-z])/i);
  if (!match?.[1]) {
    return null;
  }

  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) {
    return null;
  }

  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") {
    return base * 1_000;
  }

  if (suffix === "m") {
    return base * 1_000_000;
  }

  if (suffix === "b") {
    return base * 1_000_000_000;
  }

  return base;
}

function parseBinanceSymbol(text: string): string | null {
  const pairMatch = text.match(/\b([A-Z0-9]{2,12})\/([A-Z0-9]{2,12})\b/);
  if (pairMatch) {
    return `${pairMatch[1]}${pairMatch[2]}`;
  }

  const symbolMatch = text.match(/\b([A-Z0-9]{2,16}USDT)\b/);
  return symbolMatch?.[1] ?? null;
}

function selectTargetKline(
  rows: KlineRow[],
  targetOpenTimeMs: number
): { row: KlineRow; mode: "exact_open_time" | "time_window_fallback" } | null {
  const exact = rows.find((row) => row[0] === targetOpenTimeMs);
  if (exact) {
    return { row: exact, mode: "exact_open_time" };
  }

  const fallback = rows.find((row) => row[0] < targetOpenTimeMs && row[6] + 1 >= targetOpenTimeMs);
  if (fallback) {
    return { row: fallback, mode: "time_window_fallback" };
  }

  return null;
}

function evaluateThreshold(value: number, threshold: ThresholdSpec): DirectLegacyState {
  switch (threshold.kind) {
    case "range": {
      const lowerOk = threshold.lowerInclusive ? value >= threshold.min : value > threshold.min;
      const upperOk = threshold.upperInclusive ? value <= threshold.max : value < threshold.max;
      return lowerOk && upperOk ? "YES" : "NO";
    }
    case "above":
      return threshold.inclusive ? (value >= threshold.threshold ? "YES" : "NO") : (value > threshold.threshold ? "YES" : "NO");
    case "below":
      return threshold.inclusive ? (value <= threshold.threshold ? "YES" : "NO") : (value < threshold.threshold ? "YES" : "NO");
  }
}

function describeThreshold(threshold: ThresholdSpec): string {
  switch (threshold.kind) {
    case "range":
      return threshold.upperInclusive
        ? `price in [${threshold.min}, ${threshold.max}]`
        : `price in [${threshold.min}, ${threshold.max})`;
    case "above":
      return threshold.inclusive ? `price >= ${threshold.threshold}` : `price > ${threshold.threshold}`;
    case "below":
      return threshold.inclusive ? `price <= ${threshold.threshold}` : `price < ${threshold.threshold}`;
  }
}

function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(4).replace(/0+$/g, "").replace(/\.$/, "");
}
