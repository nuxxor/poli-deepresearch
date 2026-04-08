import { type MarketContext } from "@polymarket/deep-research-contracts";

type FredTransform = "level" | "yoy_pct" | "mom_pct";

export type FredMapping = {
  seriesId: string;
  title: string;
  transform: FredTransform;
  officialDomain: "fred.stlouisfed.org";
  notes: string[];
};

export function mapMarketToFredSeries(market: MarketContext): FredMapping | null {
  const text = `${market.canonicalMarket.title}\n${market.canonicalMarket.rulesText}\n${market.canonicalMarket.description ?? ""}`.toLowerCase();

  if (market.canonicalMarket.category !== "macro") {
    return null;
  }

  if (/\brecession\b|\bnber\b|\btwo consecutive quarters\b/.test(text)) {
    return null;
  }

  if (/\bgdp growth\b|\bannualized real .*gdp growth\b/.test(text)) {
    return buildMapping("A191RL1Q225SBEA", "Real Gross Domestic Product, Percent Change from Preceding Period", "level", [
      "Mapped from GDP growth language"
    ]);
  }

  if (/\bcore cpi\b/.test(text)) {
    return buildMapping("CPILFESL", "Core CPI", inferInflationTransform(text), [
      "Mapped from core CPI language"
    ]);
  }

  if (/\b(core pce|core personal consumption expenditures)\b/.test(text)) {
    return buildMapping("PCEPILFE", "Core PCE Price Index", inferInflationTransform(text), [
      "Mapped from core PCE language"
    ]);
  }

  if (/\b(pce|personal consumption expenditures)\b/.test(text)) {
    return buildMapping("PCEPI", "PCE Price Index", inferInflationTransform(text), [
      "Mapped from headline PCE language"
    ]);
  }

  if (/\b(cpi|consumer price index|inflation)\b/.test(text)) {
    return buildMapping("CPIAUCSL", "Consumer Price Index", inferInflationTransform(text), [
      "Mapped from CPI/inflation language"
    ]);
  }

  if (/\b(unemployment rate|jobless rate)\b/.test(text)) {
    return buildMapping("UNRATE", "Unemployment Rate", "level", [
      "Mapped from unemployment-rate language"
    ]);
  }

  if (/\b(jobless claims|initial claims|weekly claims|unemployment insurance claims)\b/.test(text)) {
    return buildMapping("ICSA", "Initial Claims", "level", [
      "Mapped from weekly jobless-claims language"
    ]);
  }

  if (/\b(nonfarm payroll|payroll employment|payrolls)\b/.test(text)) {
    return buildMapping("PAYEMS", "All Employees, Total Nonfarm", "level", [
      "Mapped from payroll language"
    ]);
  }

  if (/\b(fed funds|federal funds)\b/.test(text)) {
    return buildMapping("FEDFUNDS", "Federal Funds Effective Rate", "level", [
      "Mapped from fed-funds language"
    ]);
  }

  if (/\bgdp\b/.test(text)) {
    return buildMapping("GDPC1", "Real Gross Domestic Product", inferTransform(text), [
      "Mapped from GDP language"
    ]);
  }

  return null;
}

function inferTransform(text: string): FredTransform {
  if (/\b(yoy|year over year|year-over-year)\b/.test(text)) {
    return "yoy_pct";
  }

  if (/\b(mom|month over month|month-over-month)\b/.test(text)) {
    return "mom_pct";
  }

  return "level";
}

function inferInflationTransform(text: string): FredTransform {
  if (/\bfrom\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b[\s\S]{0,30}\bto\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(text)) {
    return "mom_pct";
  }

  if (/\bmonth-to-month\b|\bmonth to month\b/.test(text)) {
    return "mom_pct";
  }

  if (/\b(mom|month over month|month-over-month)\b/.test(text)) {
    return "mom_pct";
  }

  if (/\b(yoy|year over year|year-over-year|inflation)\b/.test(text)) {
    return "yoy_pct";
  }

  return inferTransform(text);
}

function buildMapping(
  seriesId: string,
  title: string,
  transform: FredTransform,
  notes: string[]
): FredMapping {
  return {
    seriesId,
    title,
    transform,
    officialDomain: "fred.stlouisfed.org",
    notes
  };
}
