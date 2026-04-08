export const LEAN_LABELS = {
  STRONG_NO: "Strong No",
  LEAN_NO: "Lean No",
  TOSSUP: "Tossup",
  LEAN_YES: "Lean Yes",
  STRONG_YES: "Strong Yes"
};

export const LEAN_POSITIONS = {
  STRONG_NO: 0,
  LEAN_NO: 25,
  TOSSUP: 50,
  LEAN_YES: 75,
  STRONG_YES: 100
};

export const LEAN_CLASS = {
  STRONG_NO: "lean-strong-no",
  LEAN_NO: "lean-no",
  TOSSUP: "lean-tossup",
  LEAN_YES: "lean-yes",
  STRONG_YES: "lean-strong-yes"
};

export function titleCaseWords(value) {
  return String(value ?? "-")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatUtcDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC"
  }).format(date)} UTC`;
}

export function formatPct(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function formatLeanLabel(lean) {
  return LEAN_LABELS[lean] ?? "-";
}

export function formatLeanWithConfidence(lean, confidenceLabel) {
  const label = formatLeanLabel(lean);
  if (label === "-") {
    return "-";
  }
  return `${label} | ${titleCaseWords(confidenceLabel ?? "low")} confidence`;
}

export function formatProbabilityPair(yesProbability, noProbability) {
  if (yesProbability == null || noProbability == null) {
    return "-";
  }
  return `Yes ${formatPct(yesProbability)} | No ${formatPct(noProbability)}`;
}

export function formatEdgeView(researchView) {
  if (researchView?.yesEdge == null || researchView?.noEdge == null) {
    return "-";
  }
  const yes =
    researchView.yesEdge >= 0 ? `Yes +${formatPct(researchView.yesEdge)}` : `Yes ${formatPct(researchView.yesEdge)}`;
  const no =
    researchView.noEdge >= 0 ? `No +${formatPct(researchView.noEdge)}` : `No ${formatPct(researchView.noEdge)}`;
  return `${yes} | ${no}`;
}

export function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseNumberArray(value) {
  return parseStringArray(value)
    .map((item) => Number.parseFloat(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.max(0, Math.min(1, item)));
}

export function deriveMarketOdds(payload) {
  if (payload?.marketOdds) {
    return payload.marketOdds;
  }

  const outcomes = parseStringArray(payload?.market?.rawMarket?.outcomes);
  const prices = parseNumberArray(payload?.market?.rawMarket?.outcomePrices);
  let yesProbability;
  let noProbability;

  outcomes.forEach((outcome, index) => {
    const price = prices[index];
    if (price == null) {
      return;
    }
    if (/^yes$/i.test(outcome)) {
      yesProbability = price;
    }
    if (/^no$/i.test(outcome)) {
      noProbability = price;
    }
  });

  if (yesProbability == null && noProbability == null && prices.length >= 2) {
    yesProbability = prices[0];
    noProbability = prices[1];
  } else if (yesProbability != null && noProbability == null) {
    noProbability = Math.max(0, Math.min(1, 1 - yesProbability));
  } else if (noProbability != null && yesProbability == null) {
    yesProbability = Math.max(0, Math.min(1, 1 - noProbability));
  }

  return {
    source: "polymarket",
    yesProbability,
    noProbability
  };
}

export function formatProviderRunSummary(run) {
  if (!run) {
    return "not run";
  }
  const status = run.ok ? "ok" : "failed";
  const lean = run.opinion?.lean ? ` | lean=${run.opinion.lean}` : "";
  const resolution = run.resolutionStatus ? ` | res=${run.resolutionStatus}` : "";
  const cost = ` | $${Number(run.raw?.estimatedRetrievalCostUsd ?? 0).toFixed(4)}`;
  const ms = run.raw?.durationMs != null ? ` | ${Math.round(run.raw.durationMs)}ms` : "";
  return `${status} | ${run.parseMode}${lean}${resolution}${cost}${ms}`;
}

export function formatComparatorLabel(contract) {
  if (!contract) {
    return "-";
  }

  const base = titleCaseWords(contract.comparator);
  const threshold =
    contract.thresholdValue != null
      ? `${contract.metricName ? `${contract.metricName} ` : ""}${contract.thresholdValue}${contract.thresholdUnit ? ` ${contract.thresholdUnit}` : ""}`
      : contract.metricName ?? null;

  return threshold ? `${base} | ${threshold}` : base;
}

export function formatGuardrailReason(reason) {
  return titleCaseWords(reason);
}
