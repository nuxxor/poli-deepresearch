import {
  API_BASE,
  fetchHealthStatus,
  fetchMarketContext,
  fetchResearchLatest,
  fetchResearchProduct
} from "./api-client.js";

const healthBadge = document.querySelector("#health-badge");
const healthCopy = document.querySelector("#health-copy");
const pageUrl = document.querySelector("#page-url");
const pageSlug = document.querySelector("#page-slug");
const pageHeading = document.querySelector("#page-heading");
const contextBadge = document.querySelector("#context-badge");
const conditionId = document.querySelector("#condition-id");
const marketCategory = document.querySelector("#market-category");
const marketArchetype = document.querySelector("#market-archetype");
const marketPolicyPack = document.querySelector("#market-policy-pack");
const marketTokens = document.querySelector("#market-tokens");
const refreshButton = document.querySelector("#refresh-button");
const researchButton = document.querySelector("#research-button");
const researchBadge = document.querySelector("#research-badge");

const researchLeanHeadline = document.querySelector("#research-lean-headline");
const researchLeanConfidence = document.querySelector("#research-lean-confidence");
const researchResolutionStatus = document.querySelector("#research-resolution-status");
const leanMeterMarker = document.querySelector("#lean-meter-marker");

const researchSystemLean = document.querySelector("#research-system-lean");
const researchSystemOdds = document.querySelector("#research-system-odds");
const researchMarketOdds = document.querySelector("#research-market-odds");
const researchEdge = document.querySelector("#research-edge");
const researchViewRationale = document.querySelector("#research-view-rationale");
const researchWhy = document.querySelector("#research-why");
const researchActionability = document.querySelector("#research-actionability");
const researchRunMode = document.querySelector("#research-run-mode");
const researchConfidenceCap = document.querySelector("#research-confidence-cap");
const researchGuardrailReasons = document.querySelector("#research-guardrail-reasons");
const researchResolutionSubject = document.querySelector("#research-resolution-subject");
const researchResolutionComparator = document.querySelector("#research-resolution-comparator");
const researchResolutionAuthorities = document.querySelector("#research-resolution-authorities");
const researchResolutionRules = document.querySelector("#research-resolution-rules");
const researchProbabilitySource = document.querySelector("#research-probability-source");
const researchPosteriorOdds = document.querySelector("#research-posterior-odds");
const researchCalibratedOdds = document.querySelector("#research-calibrated-odds");
const researchCalibration = document.querySelector("#research-calibration");
const researchAdversarialStatus = document.querySelector("#research-adversarial-status");
const researchAdversarialNotes = document.querySelector("#research-adversarial-notes");

const researchYesHeadline = document.querySelector("#research-yes-headline");
const researchNoHeadline = document.querySelector("#research-no-headline");
const researchYesCase = document.querySelector("#research-yes-case");
const researchNoCase = document.querySelector("#research-no-case");

const researchHistoricalNarrative = document.querySelector("#research-historical-narrative");
const researchHistoricalPriors = document.querySelector("#research-historical-priors");
const researchWhatToWatch = document.querySelector("#research-what-to-watch");
const researchNextCheck = document.querySelector("#research-next-check");

const researchModelTake = document.querySelector("#research-model-take");
const researchSecondModelTake = document.querySelector("#research-second-model-take");

const researchBestSources = document.querySelector("#research-best-sources");
const researchCrossMarketSummary = document.querySelector("#research-cross-market-summary");
const researchCrossMarketList = document.querySelector("#research-cross-market-list");
const researchOfficialItems = document.querySelector("#research-official-items");
const researchOfficialSources = document.querySelector("#research-official-sources");
const researchNote = document.querySelector("#research-note");

const researchFinalMode = document.querySelector("#research-final-mode");
const researchParallelRun = document.querySelector("#research-parallel-run");
const researchXaiRun = document.querySelector("#research-xai-run");
const researchDirectRun = document.querySelector("#research-direct-run");
const researchLocalRun = document.querySelector("#research-local-run");
const researchCost = document.querySelector("#research-cost");
const researchCache = document.querySelector("#research-cache");
const researchEvidenceCount = document.querySelector("#research-evidence-count");
const researchClaimCount = document.querySelector("#research-claim-count");
const researchSourceScore = document.querySelector("#research-source-score");
const researchGraph = document.querySelector("#research-graph");
const researchSignals = document.querySelector("#research-signals");
const researchMacroOfficial = document.querySelector("#research-macro-official");
const researchPlanner = document.querySelector("#research-planner");

const researchCitations = document.querySelector("#research-citations");
const researchEvidence = document.querySelector("#research-evidence");
const researchClaims = document.querySelector("#research-claims");
const researchSummaryItems = document.querySelector("#research-summary-items");
const researchSignalItems = document.querySelector("#research-signal-items");

const LEAN_LABELS = {
  STRONG_NO: "Strong No",
  LEAN_NO: "Lean No",
  TOSSUP: "Tossup",
  LEAN_YES: "Lean Yes",
  STRONG_YES: "Strong Yes"
};

const LEAN_POSITIONS = {
  STRONG_NO: 0,
  LEAN_NO: 25,
  TOSSUP: 50,
  LEAN_YES: 75,
  STRONG_YES: 100
};

const LEAN_CLASS = {
  STRONG_NO: "lean-strong-no",
  LEAN_NO: "lean-no",
  TOSSUP: "lean-tossup",
  LEAN_YES: "lean-yes",
  STRONG_YES: "lean-strong-yes"
};

let currentSlug = null;

function inferSlug(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}

async function loadHealth() {
  try {
    const payload = await fetchHealthStatus();
    healthBadge.textContent = payload.status.toUpperCase();
    healthBadge.className = "badge ok";
    healthCopy.textContent = `${API_BASE}/v1/health`;
  } catch (error) {
    healthBadge.textContent = "OFFLINE";
    healthBadge.className = "badge error";
    healthCopy.textContent = `${API_BASE}/v1/health :: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

function setResearchIdle(copy = "Idle") {
  researchBadge.textContent = copy;
  researchBadge.className = "badge muted";
}

function clearResearch() {
  setResearchIdle();
  marketPolicyPack.textContent = "-";
  researchLeanHeadline.textContent = "-";
  researchLeanHeadline.className = "verdict-state";
  researchLeanConfidence.textContent = "-";
  researchResolutionStatus.textContent = "-";
  leanMeterMarker.style.left = "50%";
  leanMeterMarker.className = "lean-meter-marker";
  researchSystemLean.textContent = "-";
  researchSystemOdds.textContent = "-";
  researchMarketOdds.textContent = "-";
  researchEdge.textContent = "-";
  researchViewRationale.textContent = "-";
  researchWhy.textContent = "-";
  researchActionability.textContent = "-";
  researchRunMode.textContent = "-";
  researchConfidenceCap.textContent = "-";
  researchGuardrailReasons.innerHTML = "<li>No guardrail reasons yet.</li>";
  researchResolutionSubject.textContent = "-";
  researchResolutionComparator.textContent = "-";
  researchResolutionAuthorities.textContent = "-";
  researchResolutionRules.innerHTML = "<li>No resolution rules yet.</li>";
  researchProbabilitySource.textContent = "-";
  researchPosteriorOdds.textContent = "-";
  researchCalibratedOdds.textContent = "-";
  researchCalibration.textContent = "-";
  researchAdversarialStatus.textContent = "-";
  researchAdversarialNotes.innerHTML = "<li>No adversarial review yet.</li>";
  researchYesHeadline.textContent = "Yes Case";
  researchNoHeadline.textContent = "No Case";
  researchYesCase.innerHTML = "<li>No yes-side case yet.</li>";
  researchNoCase.innerHTML = "<li>No no-side case yet.</li>";
  researchHistoricalNarrative.textContent = "-";
  researchHistoricalPriors.innerHTML = "<li>No priors surfaced yet.</li>";
  researchWhatToWatch.innerHTML = "<li>No watch items yet.</li>";
  researchNextCheck.textContent = "-";
  researchModelTake.textContent = "-";
  researchSecondModelTake.textContent = "-";
  researchBestSources.innerHTML = "<li>No source ranking yet.</li>";
  researchCrossMarketSummary.textContent = "-";
  researchCrossMarketList.innerHTML = "<li>No related market context yet.</li>";
  researchOfficialItems.innerHTML = "<li>No trusted sources surfaced yet.</li>";
  researchOfficialSources.textContent = "-";
  researchNote.innerHTML = "<p>No narrative note yet.</p>";
  researchFinalMode.textContent = "-";
  researchParallelRun.textContent = "-";
  researchXaiRun.textContent = "-";
  researchDirectRun.textContent = "-";
  researchLocalRun.textContent = "-";
  researchCost.textContent = "-";
  researchCache.textContent = "-";
  researchEvidenceCount.textContent = "-";
  researchClaimCount.textContent = "-";
  researchSourceScore.textContent = "-";
  researchGraph.textContent = "-";
  researchSignals.textContent = "-";
  researchMacroOfficial.textContent = "-";
  researchPlanner.textContent = "-";
  researchCitations.innerHTML = "<li>No research run yet.</li>";
  researchEvidence.innerHTML = "<li>No evidence extracted yet.</li>";
  researchClaims.innerHTML = "<li>No claims extracted yet.</li>";
  researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
  researchSignalItems.innerHTML = "<li>No signals fetched yet.</li>";
}

function titleCaseWords(value) {
  return String(value ?? "-")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatUtcDateTime(value) {
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

function formatPct(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatLeanLabel(lean) {
  return LEAN_LABELS[lean] ?? "-";
}

function formatLeanWithConfidence(lean, confidenceLabel) {
  const label = formatLeanLabel(lean);
  if (label === "-") {
    return "-";
  }
  return `${label} | ${titleCaseWords(confidenceLabel ?? "low")} confidence`;
}

function formatProbabilityPair(yesProbability, noProbability) {
  if (yesProbability == null || noProbability == null) {
    return "-";
  }
  return `Yes ${formatPct(yesProbability)} | No ${formatPct(noProbability)}`;
}

function formatEdgeView(researchView) {
  if (researchView?.yesEdge == null || researchView?.noEdge == null) {
    return "-";
  }
  const yes =
    researchView.yesEdge >= 0 ? `Yes +${formatPct(researchView.yesEdge)}` : `Yes ${formatPct(researchView.yesEdge)}`;
  const no =
    researchView.noEdge >= 0 ? `No +${formatPct(researchView.noEdge)}` : `No ${formatPct(researchView.noEdge)}`;
  return `${yes} | ${no}`;
}

function parseStringArray(value) {
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

function parseNumberArray(value) {
  return parseStringArray(value)
    .map((item) => Number.parseFloat(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.max(0, Math.min(1, item)));
}

function deriveMarketOdds(payload) {
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

function renderListItems(target, items, emptyText, mapper) {
  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = `<li>${emptyText}</li>`;
    return;
  }

  target.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    mapper(li, item);
    target.append(li);
  }
}

function renderCaseList(target, caseObj, polarity) {
  if (!caseObj || !Array.isArray(caseObj.bullets) || caseObj.bullets.length === 0) {
    target.innerHTML = `<li>No ${polarity}-side case yet.</li>`;
    return;
  }

  target.innerHTML = "";
  for (const bullet of caseObj.bullets) {
    const li = document.createElement("li");
    li.textContent = bullet.text;

    if (Array.isArray(bullet.citationUrls) && bullet.citationUrls.length > 0) {
      const sources = document.createElement("div");
      sources.className = "case-sources";
      sources.textContent = "Sources: ";

      bullet.citationUrls.slice(0, 3).forEach((url, index) => {
        if (index > 0) {
          sources.append(" · ");
        }
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        try {
          anchor.textContent = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          anchor.textContent = url;
        }
        sources.append(anchor);
      });

      li.append(sources);
    }

    target.append(li);
  }
}

function renderHistoricalContext(historicalContext) {
  if (!historicalContext) {
    researchHistoricalNarrative.textContent = "-";
    researchHistoricalPriors.innerHTML = "<li>No priors surfaced yet.</li>";
    return;
  }

  researchHistoricalNarrative.textContent = historicalContext.narrative ?? "-";

  if (!Array.isArray(historicalContext.priors) || historicalContext.priors.length === 0) {
    researchHistoricalPriors.innerHTML = "<li>No priors surfaced yet.</li>";
    return;
  }

  researchHistoricalPriors.innerHTML = "";
  for (const prior of historicalContext.priors) {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = `${prior.label}: `;
    li.append(label);
    li.append(document.createTextNode(prior.detail));
    researchHistoricalPriors.append(li);
  }
}

function renderWhatToWatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    researchWhatToWatch.innerHTML = "<li>No watch items yet.</li>";
    return;
  }

  researchWhatToWatch.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    researchWhatToWatch.append(li);
  }
}

function renderModelTakes(opinion) {
  researchModelTake.textContent = opinion?.modelTake ?? "-";
  researchSecondModelTake.textContent = opinion?.secondModelTake ?? "—";
}

function renderForecast(payload, researchView) {
  const forecast = payload?.probabilisticForecast;
  const calibration = payload?.calibrationSummary;

  researchProbabilitySource.textContent = titleCaseWords(researchView?.probabilitySource ?? "opinion");
  researchPosteriorOdds.textContent =
    forecast && forecast.posteriorYesProbability != null
      ? formatProbabilityPair(forecast.posteriorYesProbability, 1 - forecast.posteriorYesProbability)
      : "-";
  researchCalibratedOdds.textContent = forecast
    ? formatProbabilityPair(forecast.calibratedYesProbability, forecast.calibratedNoProbability)
    : "-";

  if (!calibration) {
    researchCalibration.textContent = "No calibration summary.";
    return;
  }

  researchCalibration.textContent = [
    titleCaseWords(calibration.status),
    `${calibration.sampleSize} cases`,
    calibration.adjustment != null ? `adj ${formatPct(calibration.adjustment)}` : null
  ]
    .filter(Boolean)
    .join(" | ");
}

function renderAdversarialReview(payload) {
  const review = payload?.adversarialReview;
  if (!review) {
    researchAdversarialStatus.textContent = "No adversarial review.";
    researchAdversarialNotes.innerHTML = "<li>No adversarial review yet.</li>";
    return;
  }

  researchAdversarialStatus.textContent = [
    titleCaseWords(review.status),
    review.changedOpinion ? "changed opinion" : "confirmed opinion"
  ].join(" | ");

  const items = [review.adjudication, review.supportCase, review.critiqueCase, ...(review.notes ?? [])].filter(Boolean);
  if (items.length === 0) {
    researchAdversarialNotes.innerHTML = "<li>No adversarial review detail yet.</li>";
    return;
  }

  renderListItems(researchAdversarialNotes, items.slice(0, 4), "No adversarial review detail yet.", (li, item) => {
    li.textContent = item;
  });
}

function renderCrossMarketContext(payload) {
  const context = payload?.crossMarketContext;
  if (!context || !Array.isArray(context.markets) || context.markets.length === 0) {
    researchCrossMarketSummary.textContent = "No related market context yet.";
    researchCrossMarketList.innerHTML = "<li>No related market context yet.</li>";
    return;
  }

  researchCrossMarketSummary.textContent = context.summary ?? `${context.markets.length} related markets`;
  researchCrossMarketList.innerHTML = "";

  for (const item of context.markets.slice(0, 5)) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = item.title;
    li.append(title);

    const meta = document.createElement("div");
    meta.className = "case-sources";
    meta.textContent = [
      titleCaseWords(item.relation),
      `${Math.round((item.overlapScore ?? 0) * 100)}% overlap`,
      item.lean ? `${formatLeanLabel(item.lean)} @ ${formatPct(item.leanConfidence ?? 0)}` : null
    ]
      .filter(Boolean)
      .join(" | ");
    li.append(meta);

    const why = document.createElement("div");
    why.textContent = item.why;
    li.append(why);

    researchCrossMarketList.append(li);
  }
}

function getTopSources(payload) {
  return payload?.topSources ?? payload?.sourceSummary?.topSources ?? [];
}

function renderBestSources(payload) {
  const candidates = [];
  const seen = new Set();

  const push = (url, label) => {
    const key = url ?? label;
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ url, label });
  };

  for (const item of getTopSources(payload)) {
    push(item.canonicalUrl, item.title ?? item.canonicalUrl);
  }

  for (const item of payload?.citations ?? []) {
    push(item.url, item.title ?? item.url);
  }

  if (candidates.length === 0) {
    researchBestSources.innerHTML = "<li>No source ranking yet.</li>";
    return;
  }

  researchBestSources.innerHTML = "";
  for (const item of candidates.slice(0, 5)) {
    const li = document.createElement("li");
    if (item.url) {
      const anchor = document.createElement("a");
      anchor.href = item.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = item.label;
      li.append(anchor);
    } else {
      li.textContent = item.label;
    }
    researchBestSources.append(li);
  }
}

function renderTrustedSources(payload) {
  const candidates = [];
  const seen = new Set();

  const push = (url, title, meta) => {
    const canonical = url ?? title;
    if (!canonical || seen.has(canonical)) {
      return;
    }
    seen.add(canonical);
    candidates.push({ url, title, meta });
  };

  for (const item of getTopSources(payload)) {
    push(
      item.canonicalUrl,
      item.title ?? item.canonicalUrl,
      `${item.isOfficial ? "official" : item.sourceType} | ${Math.round((item.score ?? 0) * 100)} score | ${item.stance}`
    );
  }

  for (const item of payload?.evidence ?? []) {
    push(
      item.canonicalUrl ?? item.url,
      item.title ?? item.canonicalUrl ?? item.url,
      `${item.sourceType} | ${item.extractor} | ${Math.round((item.authorityScore ?? 0) * 100)} auth`
    );
  }

  if (candidates.length === 0) {
    researchOfficialItems.innerHTML = "<li>No trusted sources surfaced yet.</li>";
    return;
  }

  researchOfficialItems.innerHTML = "";

  for (const item of candidates.slice(0, 5)) {
    const li = document.createElement("li");
    if (item.url) {
      const anchor = document.createElement("a");
      anchor.href = item.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = item.title;
      li.append(anchor);
    } else {
      li.textContent = item.title;
    }

    if (item.meta) {
      const meta = document.createElement("div");
      meta.textContent = item.meta;
      li.append(meta);
    }

    researchOfficialItems.append(li);
  }
}

function renderCitations(items) {
  if (!Array.isArray(items) || items.length === 0) {
    researchCitations.innerHTML = "<li>No citations returned.</li>";
    return;
  }

  researchCitations.innerHTML = "";

  for (const item of items) {
    const li = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = item.url ?? "#";
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = item.title ?? item.url ?? "Untitled source";
    li.append(anchor);

    if (item.snippet) {
      const snippet = document.createElement("div");
      snippet.textContent = item.snippet;
      li.append(snippet);
    }

    researchCitations.append(li);
  }
}

function renderEvidence(items, sourceSummary) {
  if (!Array.isArray(items) || items.length === 0) {
    researchEvidence.innerHTML = "<li>No evidence extracted yet.</li>";
    return;
  }

  researchEvidence.innerHTML = "";
  const topSources = new Map(((sourceSummary?.topSources ?? [])).map((item) => [item.docId, item]));

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.sourceType} | ${item.title ?? item.canonicalUrl ?? item.url}`;

    const meta = document.createElement("div");
    const card = topSources.get(item.docId);
    meta.textContent = `${Math.round((item.authorityScore ?? 0) * 100)} auth | ${Math.round((item.freshnessScore ?? 0) * 100)} fresh${card ? ` | ${Math.round((card.score ?? 0) * 100)} score | ${card.stance}` : ""}`;
    li.append(meta);

    researchEvidence.append(li);
  }
}

function renderClaims(items) {
  if (!Array.isArray(items) || items.length === 0) {
    researchClaims.innerHTML = "<li>No claims extracted yet.</li>";
    return;
  }

  researchClaims.innerHTML = "";

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.polarity} | ${item.subject} -> ${item.predicate}`;

    const meta = document.createElement("div");
    meta.textContent = `${Math.round((item.confidence ?? 0) * 100)}% | ${item.object}`;
    li.append(meta);

    researchClaims.append(li);
  }
}

function renderSignals(summary) {
  if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) {
    researchSignalItems.innerHTML = "<li>No signals fetched yet.</li>";
    return;
  }

  researchSignalItems.innerHTML = "";

  for (const item of summary.items) {
    const li = document.createElement("li");
    const label = item.title ?? item.url ?? item.snippet ?? "Untitled signal";

    if (item.url) {
      const anchor = document.createElement("a");
      anchor.href = item.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = `[${item.signalSource}] ${label}`;
      li.append(anchor);
    } else {
      li.textContent = `[${item.signalSource}] ${label}`;
    }

    const meta = document.createElement("div");
    meta.textContent = [item.publishedAt, item.author, item.domain].filter(Boolean).join(" | ") || item.signalSource;
    li.append(meta);
    researchSignalItems.append(li);
  }
}

function renderResearchNote(payload) {
  const summary = payload?.offlineSummary;
  const narrative = payload?.narrative;
  researchNote.innerHTML = "";

  if (!summary && !narrative) {
    const fallback = document.createElement("p");
    fallback.textContent = payload?.final?.why ?? "No narrative note yet.";
    researchNote.append(fallback);
    researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
    return;
  }

  if (summary) {
    if (summary.lede) {
      const lede = document.createElement("p");
      lede.className = "research-note-lede";
      lede.textContent = summary.lede;
      researchNote.append(lede);
    }

    for (const section of summary.sections ?? []) {
      const block = document.createElement("section");
      block.className = "research-note-section";

      const heading = document.createElement("h3");
      heading.className = "research-note-heading";
      heading.textContent = section.heading;
      block.append(heading);

      const body = document.createElement("p");
      body.textContent = section.body;
      block.append(body);

      if (Array.isArray(section.citations) && section.citations.length > 0) {
        const refs = document.createElement("div");
        refs.className = "case-sources";
        refs.textContent = "Sources: ";

        section.citations.slice(0, 3).forEach((citation, index) => {
          if (index > 0) {
            refs.append(" · ");
          }
          const anchor = document.createElement("a");
          anchor.href = citation.url;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.textContent = citation.label;
          refs.append(anchor);
        });

        block.append(refs);
      }

      researchNote.append(block);
    }

    if (summary.closing) {
      const closing = document.createElement("p");
      closing.className = "research-note-closing";
      closing.textContent = summary.closing;
      researchNote.append(closing);
    }

    researchSummaryItems.innerHTML = "";

    if (summary.headline || summary.summary) {
      const headline = document.createElement("li");
      headline.textContent = `${summary.headline ?? ""}${summary.headline && summary.summary ? ": " : ""}${summary.summary ?? ""}`.trim();
      if (headline.textContent) {
        researchSummaryItems.append(headline);
      }
    }

    for (const item of summary.watchItems ?? []) {
      const li = document.createElement("li");
      li.textContent = item;
      researchSummaryItems.append(li);
    }

    if (researchSummaryItems.children.length === 0) {
      researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
    }
    return;
  }

  const headline = document.createElement("p");
  headline.className = "research-note-lede";
  headline.textContent = narrative.headline;
  researchNote.append(headline);

  const summaryCopy = document.createElement("p");
  summaryCopy.textContent = narrative.summary;
  researchNote.append(summaryCopy);

  researchSummaryItems.innerHTML = "";
  const first = document.createElement("li");
  first.textContent = `${narrative.headline}: ${narrative.summary}`;
  researchSummaryItems.append(first);

  for (const item of narrative.watchItems ?? []) {
    const li = document.createElement("li");
    li.textContent = item;
    researchSummaryItems.append(li);
  }

  if (researchSummaryItems.children.length === 0) {
    researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
  }
}

function formatProviderRunSummary(run) {
  if (!run) {
    return "not run";
  }
  const status = run.ok ? "ok" : "failed";
  const lean = run.opinion?.lean ? ` | lean=${run.opinion.lean}` : "";
  const res = run.resolutionStatus ? ` | res=${run.resolutionStatus}` : "";
  const cost = ` | $${Number(run.raw?.estimatedRetrievalCostUsd ?? 0).toFixed(4)}`;
  const ms = run.raw?.durationMs != null ? ` | ${Math.round(run.raw.durationMs)}ms` : "";
  return `${status} | ${run.parseMode}${lean}${res}${cost}${ms}`;
}

function setLeanMeter(lean) {
  const position = LEAN_POSITIONS[lean];
  if (position == null) {
    leanMeterMarker.style.left = "50%";
    leanMeterMarker.className = "lean-meter-marker";
    return;
  }
  leanMeterMarker.style.left = `${position}%`;
  leanMeterMarker.className = `lean-meter-marker ${LEAN_CLASS[lean] ?? ""}`;
}

function formatComparatorLabel(contract) {
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

function formatGuardrailReason(reason) {
  return titleCaseWords(reason);
}

function renderGuardrails(payload) {
  const guardrails = payload?.guardrails;
  if (!guardrails) {
    researchActionability.textContent = "-";
    researchRunMode.textContent = "-";
    researchConfidenceCap.textContent = "-";
    researchGuardrailReasons.innerHTML = "<li>No guardrail reasons yet.</li>";
    return;
  }

  researchActionability.textContent = titleCaseWords(guardrails.actionability);
  researchRunMode.textContent = titleCaseWords(guardrails.runMode);
  researchConfidenceCap.textContent = guardrails.confidenceCapApplied != null ? formatPct(guardrails.confidenceCapApplied) : "No cap";

  renderListItems(
    researchGuardrailReasons,
    guardrails.reasons,
    guardrails.degraded ? "Guardrails degraded without explicit reasons." : "No guardrail reasons yet.",
    (li, reason) => {
      li.textContent = formatGuardrailReason(reason);
    }
  );
}

function renderResolutionContract(payload) {
  const contract = payload?.resolutionContract;
  if (!contract) {
    researchResolutionSubject.textContent = "-";
    researchResolutionComparator.textContent = "-";
    researchResolutionAuthorities.textContent = "-";
    researchResolutionRules.innerHTML = "<li>No resolution rules yet.</li>";
    return;
  }

  researchResolutionSubject.textContent = contract.subject || contract.eventLabel || "-";
  researchResolutionComparator.textContent = formatComparatorLabel(contract);
  researchResolutionAuthorities.textContent = contract.authorityKinds.map(titleCaseWords).join(", ");

  const rules = [
    `YES resolves when: ${contract.decisiveYesRule}`,
    `NO resolves when: ${contract.decisiveNoRule}`,
    contract.deadlineUtc ? `Deadline: ${formatUtcDateTime(contract.deadlineUtc)}` : null,
    `Official source required: ${contract.officialSourceRequired ? "Yes" : "No"}`,
    `Early NO allowed: ${contract.earlyNoAllowed ? "Yes" : "No"}`,
    ...(contract.notes ?? [])
  ].filter(Boolean);

  renderListItems(researchResolutionRules, rules, "No resolution rules yet.", (li, rule) => {
    li.textContent = rule;
  });
}

function applyInternalDetails(payload) {
  researchFinalMode.textContent = titleCaseWords(payload?.strategy?.finalMode);
  researchParallelRun.textContent = formatProviderRunSummary(payload?.parallelRun);
  researchXaiRun.textContent = formatProviderRunSummary(payload?.xaiRun);
  researchDirectRun.textContent = formatProviderRunSummary(payload?.directRun);
  researchLocalRun.textContent = formatProviderRunSummary(payload?.localOpinionRun);
  researchCost.textContent = payload?.costs
    ? `$${Number(payload.costs.totalUsd ?? 0).toFixed(4)} | ${payload.latencies?.totalMs ?? 0} ms`
    : "-";
  researchCache.textContent = payload?.cache?.hit
    ? `hit | expires ${payload.cache.expiresAt}`
    : payload?.cache
      ? `miss | expires ${payload.cache.expiresAt ?? "-"}`
      : "-";
  researchEvidenceCount.textContent = `${payload?.evidence?.length ?? 0}`;
  researchClaimCount.textContent = `${payload?.claims?.length ?? 0}`;
  researchSourceScore.textContent = payload?.sourceSummary
    ? `${Math.round((payload.sourceSummary.averageScore ?? 0) * 100)}%`
    : "-";
  researchGraph.textContent = payload?.evidenceGraph
    ? `${payload.evidenceGraph.nodes?.length ?? 0} nodes | ${payload.evidenceGraph.edges?.length ?? 0} edges`
    : "-";
  researchSignals.textContent = payload?.signals
    ? `${payload.signals.totalItems} items | ${payload.signals.cacheHit ? "cache" : "fresh"}`
    : "-";
  researchMacroOfficial.textContent = payload?.macroOfficialContext
    ? [
        payload.macroOfficialContext.seriesId,
        payload.macroOfficialContext.targetPeriodLabel
          ? `${payload.macroOfficialContext.targetPeriodLabel}:${payload.macroOfficialContext.targetPeriodStatus}`
          : `${payload.macroOfficialContext.transformedLabel}=${Number(payload.macroOfficialContext.transformedValue ?? 0).toFixed(2)}`,
        payload.macroOfficialContext.targetThresholdSatisfied == null
          ? payload.macroOfficialContext.latestObservationDate
          : `threshold=${payload.macroOfficialContext.targetThresholdSatisfied ? "met" : "not_met"}`
      ].join(" | ")
    : "-";
  researchPlanner.textContent = payload?.localPlanner
    ? `${payload.localPlanner.source}${payload.localPlanner.model ? ` | ${payload.localPlanner.model}` : ""}`
    : "-";

  renderEvidence(payload?.evidence, payload?.sourceSummary);
  renderClaims(payload?.claims);
  renderSignals(payload?.signals);
}

function applyResearch(productPayload, debugPayload = null) {
  const displayPayload = productPayload ?? debugPayload ?? {};
  const evidencePayload = debugPayload ? { ...displayPayload, ...debugPayload } : displayPayload;
  const opinion = displayPayload.final ?? {};
  const marketOdds = deriveMarketOdds(displayPayload);
  const researchView = displayPayload.researchView ?? null;
  const guardrails = displayPayload.guardrails ?? null;
  const displayLean = researchView?.lean ?? opinion.lean;
  const displayConfidence = researchView?.leanConfidence ?? opinion.leanConfidence;

  researchLeanHeadline.textContent = formatLeanLabel(displayLean);
  researchLeanHeadline.className = `verdict-state ${LEAN_CLASS[displayLean] ?? ""}`;
  researchLeanConfidence.textContent =
    displayConfidence != null ? `Confidence ${formatPct(displayConfidence)}` : "Confidence -";
  researchResolutionStatus.textContent =
    opinion.resolutionStatus != null
      ? `Resolution: ${titleCaseWords(opinion.resolutionStatus)} (${formatPct(opinion.resolutionConfidence)})`
      : "-";
  setLeanMeter(displayLean);

  researchSystemLean.textContent = researchView
    ? formatLeanWithConfidence(researchView.lean, researchView.confidenceLabel)
    : formatLeanLabel(opinion.lean);
  researchSystemOdds.textContent = researchView
    ? formatProbabilityPair(researchView.systemYesProbability, researchView.systemNoProbability)
    : "-";
  researchMarketOdds.textContent = formatProbabilityPair(marketOdds.yesProbability, marketOdds.noProbability);
  researchEdge.textContent = formatEdgeView(researchView);
  researchViewRationale.textContent = researchView?.rationale ?? "-";
  researchWhy.textContent = opinion.why ?? displayPayload.narrative?.summary ?? "-";

  renderGuardrails(displayPayload);
  renderResolutionContract(displayPayload);
  renderForecast(displayPayload, researchView);
  renderAdversarialReview(displayPayload);

  researchYesHeadline.textContent = opinion.yesCase?.headline ?? "Yes Case";
  researchNoHeadline.textContent = opinion.noCase?.headline ?? "No Case";
  renderCaseList(researchYesCase, opinion.yesCase, "yes");
  renderCaseList(researchNoCase, opinion.noCase, "no");

  renderHistoricalContext(opinion.historicalContext);
  renderWhatToWatch(displayPayload.narrative?.watchItems ?? opinion.whatToWatch);
  renderModelTakes(opinion);
  renderBestSources(displayPayload);
  renderCrossMarketContext(displayPayload);
  renderCitations(displayPayload.citations);
  researchOfficialSources.textContent = getTopSources(evidencePayload).length
    ? `${getTopSources(evidencePayload).length} ranked sources`
    : `${displayPayload.citations?.length ?? 0} cited sources`;
  renderTrustedSources(evidencePayload);

  researchNextCheck.textContent = displayPayload.narrative?.nextCheckAt ?? opinion.nextCheckAt
    ? `Next recheck: ${formatUtcDateTime(displayPayload.narrative?.nextCheckAt ?? opinion.nextCheckAt)}`
    : "No scheduled recheck.";

  renderResearchNote(evidencePayload);
  applyInternalDetails(debugPayload);

  if (guardrails?.actionability === "abstain") {
    researchBadge.textContent = "ABSTAIN";
    researchBadge.className = "badge error";
  } else if (guardrails?.actionability === "monitor") {
    researchBadge.textContent = "WATCH";
    researchBadge.className = "badge muted";
  } else if (opinion.resolutionStatus === "RESOLVED_YES" || opinion.resolutionStatus === "RESOLVED_NO") {
    researchBadge.textContent = "RESOLVED";
    researchBadge.className = "badge ok";
  } else if (displayLean === "STRONG_YES" || displayLean === "STRONG_NO") {
    researchBadge.textContent = formatLeanLabel(displayLean).toUpperCase();
    researchBadge.className = "badge ok";
  } else if (displayLean === "LEAN_YES" || displayLean === "LEAN_NO") {
    researchBadge.textContent = formatLeanLabel(displayLean).toUpperCase();
    researchBadge.className = "badge ok";
  } else {
    researchBadge.textContent = "TOSSUP";
    researchBadge.className = "badge muted";
  }
}

async function loadActiveTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url) {
    pageUrl.textContent = "-";
    pageSlug.textContent = "-";
    pageHeading.textContent = "-";
    contextBadge.textContent = "NO TAB";
    contextBadge.className = "badge muted";
    currentSlug = null;
    clearResearch();
    return;
  }

  pageUrl.textContent = tab.url;
  const slug = inferSlug(tab.url);
  pageSlug.textContent = slug ?? "-";

  try {
    const context = await chrome.tabs.sendMessage(tab.id, {
      type: "deep-research:get-page-context"
    });
    pageHeading.textContent = context?.heading ?? context?.title ?? "-";
  } catch {
    pageHeading.textContent = tab.title ?? "-";
  }

  if (!slug) {
    conditionId.textContent = "-";
    marketCategory.textContent = "-";
    marketArchetype.textContent = "-";
    marketPolicyPack.textContent = "-";
    marketTokens.textContent = "-";
    contextBadge.textContent = "NO SLUG";
    contextBadge.className = "badge muted";
    currentSlug = null;
    clearResearch();
    return;
  }

  try {
    const payload = await fetchMarketContext(slug);
    conditionId.textContent = payload.canonicalMarket.marketId;
    marketCategory.textContent = payload.canonicalMarket.category;
    marketArchetype.textContent = payload.canonicalMarket.resolutionArchetype;
    marketPolicyPack.textContent = "-";
    marketTokens.textContent = payload.tokenIds.join(", ") || "-";
    contextBadge.textContent = "READY";
    contextBadge.className = "badge ok";
    if (currentSlug !== slug) {
      clearResearch();
    }
    currentSlug = slug;
  } catch (error) {
    conditionId.textContent = "-";
    marketCategory.textContent = "-";
    marketArchetype.textContent = "-";
    marketPolicyPack.textContent = "-";
    marketTokens.textContent = "-";
    contextBadge.textContent = "MISS";
    contextBadge.className = "badge error";
    pageHeading.textContent = `${pageHeading.textContent} :: ${error instanceof Error ? error.message : "Context error"}`;
    currentSlug = null;
    clearResearch();
  }
}

async function refresh() {
  await Promise.all([loadHealth(), loadActiveTabContext()]);
}

async function runResearch() {
  if (!currentSlug) {
    setResearchIdle("NO SLUG");
    return;
  }

  researchButton.disabled = true;
  researchBadge.textContent = "RUNNING";
  researchBadge.className = "badge muted";

  try {
    const productPromise = fetchResearchProduct(currentSlug, {
      bypassCache: true
    });
    const debugPromise = fetchResearchLatest(currentSlug, {
      bypassCache: true
    }).catch(() => null);

    const [productPayload, debugPayload] = await Promise.all([productPromise, debugPromise]);
    applyResearch(productPayload, debugPayload);

    if (debugPayload?.appliedPolicy?.pack?.id) {
      marketPolicyPack.textContent = debugPayload.appliedPolicy.pack.id;
    }
  } catch (error) {
    researchBadge.textContent = "ERROR";
    researchBadge.className = "badge error";
    researchWhy.textContent = error instanceof Error ? error.message : "Research error";
  } finally {
    researchButton.disabled = false;
  }
}

refreshButton.addEventListener("click", () => {
  void refresh();
});

researchButton.addEventListener("click", () => {
  void runResearch();
});

clearResearch();
void refresh();
