import {
  ResolutionContractSchema,
  type AppliedPolicy,
  type MarketContext,
  type ResolutionAuthorityKind,
  type ResolutionComparator,
  type ResolutionContract
} from "@polymarket/deep-research-contracts";

export function buildResolutionContract(
  market: MarketContext,
  appliedPolicy: AppliedPolicy
): ResolutionContract {
  const title = stripQuestion(market.canonicalMarket.title);
  const subject = inferSubject(title, market.canonicalMarket.resolutionArchetype);
  const eventLabel = inferEventLabel(title);
  const threshold = inferThreshold(`${title}\n${market.canonicalMarket.rulesText}`);
  const authorityKinds = inferAuthorityKinds(appliedPolicy.pack.sourcePriority);
  const comparator = inferComparator(
    market.canonicalMarket.resolutionArchetype,
    `${title}\n${market.canonicalMarket.rulesText}`
  );

  const notes: string[] = [];
  if (threshold.thresholdValue != null) {
    notes.push(
      `threshold=${threshold.thresholdValue}${threshold.thresholdUnit ? ` ${threshold.thresholdUnit}` : ""}`
    );
  }
  if (subject === eventLabel) {
    notes.push("subject_fallback_used");
  }

  return ResolutionContractSchema.parse({
    subject,
    eventLabel,
    resolutionArchetype: market.canonicalMarket.resolutionArchetype,
    comparator,
    metricName: threshold.metricName,
    thresholdValue: threshold.thresholdValue,
    thresholdUnit: threshold.thresholdUnit,
    deadlineUtc: market.canonicalMarket.endTimeUtc,
    authorityKinds,
    officialSourceRequired: market.canonicalMarket.officialSourceRequired,
    earlyNoAllowed: market.canonicalMarket.earlyNoAllowed,
    decisiveYesRule:
      appliedPolicy.pack.decisiveYesRules[0] ??
      "YES requires an authority-consistent outcome under the market rules.",
    decisiveNoRule:
      appliedPolicy.pack.decisiveNoRules[0] ??
      "NO requires the deadline or a rule-consistent contrary outcome.",
    notes
  });
}

function inferEventLabel(title: string): string {
  return stripLeadingWill(title).trim();
}

function inferSubject(title: string, archetype: string): string {
  const clause = stripLeadingWill(title);

  const patterns: Array<RegExp> = [
    /^(.+?)\s+(?:win|wins)\b/i,
    /^(.+?)\s+(?:release|releases|launch|launches|ship|ships|begin|begins|start|starts)\b/i,
    /^(.+?)\s+(?:hit|hits|reach|reaches|exceed|exceeds|be above|be below|stay above|stay below)\b/i,
    /^(.+?)\s+(?:resign|resigns|be removed|leave office|step down)\b/i
  ];

  for (const pattern of patterns) {
    const match = clause.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  if (archetype === "numeric_threshold") {
    const beforeNumber = clause.split(/\b\d+(?:\.\d+)?\b/, 1)[0]?.trim();
    if (beforeNumber) {
      return beforeNumber.replace(/\b(be|is|are|will)\b/gi, "").replace(/\s+/g, " ").trim();
    }
  }

  const firstClause = clause
    .split(/\b(before|after|by|on|at)\b/i, 1)[0]
    ?.trim()
    .replace(/\s+/g, " ");

  return firstClause && firstClause.length >= 6 ? firstClause : clause.trim();
}

function inferComparator(archetype: string, input: string): ResolutionComparator {
  const text = input.toLowerCase();

  if (archetype === "numeric_threshold") {
    if (/\b(at least|greater than or equal|>=|no less than)\b/.test(text)) {
      return "greater_than_or_equal";
    }
    if (/\b(over|above|greater than|exceed|exceeds|more than|>)\b/.test(text)) {
      return "greater_than";
    }
    if (/\b(at most|less than or equal|<=|no more than)\b/.test(text)) {
      return "less_than_or_equal";
    }
    if (/\b(under|below|less than|fewer than|<)\b/.test(text)) {
      return "less_than";
    }
    if (/\b(equal|exactly|==)\b/.test(text)) {
      return "equal_to";
    }
  }

  switch (archetype) {
    case "winner_of_event":
      return "winner";
    case "legal_outcome":
      return "legal_outcome";
    case "appointment_or_resignation":
      return "appointment_change";
    case "negative_occurrence_by_deadline":
      return "not_occurs";
    case "release_or_launch":
      return "occurs";
    case "official_announcement_by_deadline":
      return "official_confirmation";
    default:
      return "unknown";
  }
}

function inferThreshold(input: string): {
  metricName?: string;
  thresholdValue?: number;
  thresholdUnit?: string;
} {
  const compact = input.replace(/\s+/g, " ").trim();
  const match = compact.match(
    /\b(-?\d+(?:\.\d+)?)\s*(%|percent|bps|basis points?|points?|point|usd|dollars?)\b/i
  );

  if (!match) {
    return {};
  }

  const [, rawValue = "", rawUnitValue = ""] = match;
  const thresholdValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(thresholdValue)) {
    return {};
  }

  const rawUnit = rawUnitValue.toLowerCase();
  const thresholdUnit =
    rawUnit === "percent"
      ? "%"
      : /^basis points?$/i.test(rawUnit)
        ? "bps"
        : /^dollars?$/i.test(rawUnit)
          ? "USD"
          : rawUnit;

  const before = compact.slice(0, match.index).replace(/^will\s+/i, "").trim();
  const metricName = before
    .replace(/\b(be|is|are|above|below|over|under|at least|at most|greater than|less than)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    metricName: metricName || undefined,
    thresholdValue,
    thresholdUnit
  };
}

function inferAuthorityKinds(sourcePriority: string[]): ResolutionAuthorityKind[] {
  const kinds = new Set<ResolutionAuthorityKind>();

  for (const item of sourcePriority) {
    const text = item.toLowerCase();

    if (/(government|white house|campaign|un |treaty|official statement)/.test(text)) {
      kinds.add("government");
      kinds.add("official_statement");
    }
    if (/(regulator|filing|exchange)/.test(text)) {
      kinds.add("regulator");
    }
    if (/(league|scoreboard|team site)/.test(text)) {
      kinds.add("league");
    }
    if (/(court|prosecutor)/.test(text)) {
      kinds.add("court_record");
    }
    if (/(fred|bls|bea|federal reserve|economic data)/.test(text)) {
      kinds.add("economic_release");
      kinds.add("institution");
    }
    if (/(issuer|investor relations|company|newsroom)/.test(text)) {
      kinds.add("company_ir");
    }
    if (/(publisher|artist|studio)/.test(text)) {
      kinds.add("publisher");
    }
    if (/(exchange close|spot price|market data)/.test(text)) {
      kinds.add("exchange_data");
    }
    if (/(institution|official)/.test(text)) {
      kinds.add("institution");
    }
  }

  if (kinds.size === 0) {
    kinds.add("unknown");
  }

  return [...kinds];
}

function stripLeadingWill(title: string): string {
  return title.replace(/^will\s+/i, "").trim();
}

function stripQuestion(title: string): string {
  return title.replace(/\?+$/, "").trim();
}
