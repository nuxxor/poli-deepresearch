import { elements } from "./sidepanel-dom.js";
import {
  LEAN_CLASS,
  LEAN_POSITIONS,
  deriveMarketOdds,
  formatComparatorLabel,
  formatEdgeView,
  formatGuardrailReason,
  formatLeanLabel,
  formatLeanWithConfidence,
  formatPct,
  formatProbabilityPair,
  formatUtcDateTime,
  titleCaseWords
} from "./sidepanel-formatters.js";

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
    elements.researchHistoricalNarrative.textContent = "-";
    elements.researchHistoricalPriors.innerHTML = "<li>No priors surfaced yet.</li>";
    return;
  }

  elements.researchHistoricalNarrative.textContent = historicalContext.narrative ?? "-";

  if (!Array.isArray(historicalContext.priors) || historicalContext.priors.length === 0) {
    elements.researchHistoricalPriors.innerHTML = "<li>No priors surfaced yet.</li>";
    return;
  }

  elements.researchHistoricalPriors.innerHTML = "";
  for (const prior of historicalContext.priors) {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = `${prior.label}: `;
    li.append(label);
    li.append(document.createTextNode(prior.detail));
    elements.researchHistoricalPriors.append(li);
  }
}

function renderWhatToWatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.researchWhatToWatch.innerHTML = "<li>No watch items yet.</li>";
    return;
  }

  elements.researchWhatToWatch.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    elements.researchWhatToWatch.append(li);
  }
}

function renderModelTakes(opinion) {
  elements.researchModelTake.textContent = opinion?.modelTake ?? "-";
  elements.researchSecondModelTake.textContent = opinion?.secondModelTake ?? "—";
}

function renderForecast(payload, researchView) {
  const forecast = payload?.probabilisticForecast;
  const calibration = payload?.calibrationSummary;

  elements.researchProbabilitySource.textContent = titleCaseWords(researchView?.probabilitySource ?? "opinion");
  elements.researchPosteriorOdds.textContent =
    forecast && forecast.posteriorYesProbability != null
      ? formatProbabilityPair(forecast.posteriorYesProbability, 1 - forecast.posteriorYesProbability)
      : "-";
  elements.researchCalibratedOdds.textContent = forecast
    ? formatProbabilityPair(forecast.calibratedYesProbability, forecast.calibratedNoProbability)
    : "-";

  if (!calibration) {
    elements.researchCalibration.textContent = "No calibration summary.";
    return;
  }

  elements.researchCalibration.textContent = [
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
    elements.researchAdversarialStatus.textContent = "No adversarial review.";
    elements.researchAdversarialNotes.innerHTML = "<li>No adversarial review yet.</li>";
    return;
  }

  elements.researchAdversarialStatus.textContent = [
    titleCaseWords(review.status),
    review.changedOpinion ? "changed opinion" : "confirmed opinion"
  ].join(" | ");

  const items = [review.adjudication, review.supportCase, review.critiqueCase, ...(review.notes ?? [])].filter(Boolean);
  if (items.length === 0) {
    elements.researchAdversarialNotes.innerHTML = "<li>No adversarial review detail yet.</li>";
    return;
  }

  renderListItems(elements.researchAdversarialNotes, items.slice(0, 4), "No adversarial review detail yet.", (li, item) => {
    li.textContent = item;
  });
}

function renderCrossMarketContext(payload) {
  const context = payload?.crossMarketContext;
  if (!context || !Array.isArray(context.markets) || context.markets.length === 0) {
    elements.researchCrossMarketSummary.textContent = "No related market context yet.";
    elements.researchCrossMarketList.innerHTML = "<li>No related market context yet.</li>";
    return;
  }

  elements.researchCrossMarketSummary.textContent = context.summary ?? `${context.markets.length} related markets`;
  elements.researchCrossMarketList.innerHTML = "";

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

    elements.researchCrossMarketList.append(li);
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
    elements.researchBestSources.innerHTML = "<li>No source ranking yet.</li>";
    return;
  }

  elements.researchBestSources.innerHTML = "";
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
    elements.researchBestSources.append(li);
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
    elements.researchOfficialItems.innerHTML = "<li>No trusted sources surfaced yet.</li>";
    return;
  }

  elements.researchOfficialItems.innerHTML = "";

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

    elements.researchOfficialItems.append(li);
  }
}

function renderCitations(items) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.researchCitations.innerHTML = "<li>No citations returned.</li>";
    return;
  }

  elements.researchCitations.innerHTML = "";

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

    elements.researchCitations.append(li);
  }
}

function renderResearchNote(payload) {
  const summary = payload?.offlineSummary;
  const narrative = payload?.narrative;
  elements.researchNote.innerHTML = "";

  if (!summary && !narrative) {
    const fallback = document.createElement("p");
    fallback.textContent = payload?.final?.why ?? "No narrative note yet.";
    elements.researchNote.append(fallback);
    elements.researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
    return;
  }

  if (summary) {
    if (summary.lede) {
      const lede = document.createElement("p");
      lede.className = "research-note-lede";
      lede.textContent = summary.lede;
      elements.researchNote.append(lede);
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

      elements.researchNote.append(block);
    }

    if (summary.closing) {
      const closing = document.createElement("p");
      closing.className = "research-note-closing";
      closing.textContent = summary.closing;
      elements.researchNote.append(closing);
    }

    elements.researchSummaryItems.innerHTML = "";

    if (summary.headline || summary.summary) {
      const headline = document.createElement("li");
      headline.textContent = `${summary.headline ?? ""}${summary.headline && summary.summary ? ": " : ""}${summary.summary ?? ""}`.trim();
      if (headline.textContent) {
        elements.researchSummaryItems.append(headline);
      }
    }

    for (const item of summary.watchItems ?? []) {
      const li = document.createElement("li");
      li.textContent = item;
      elements.researchSummaryItems.append(li);
    }

    if (elements.researchSummaryItems.children.length === 0) {
      elements.researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
    }
    return;
  }

  const headline = document.createElement("p");
  headline.className = "research-note-lede";
  headline.textContent = narrative.headline;
  elements.researchNote.append(headline);

  const summaryCopy = document.createElement("p");
  summaryCopy.textContent = narrative.summary;
  elements.researchNote.append(summaryCopy);

  elements.researchSummaryItems.innerHTML = "";
  const first = document.createElement("li");
  first.textContent = `${narrative.headline}: ${narrative.summary}`;
  elements.researchSummaryItems.append(first);

  for (const item of narrative.watchItems ?? []) {
    const li = document.createElement("li");
    li.textContent = item;
    elements.researchSummaryItems.append(li);
  }

  if (elements.researchSummaryItems.children.length === 0) {
    elements.researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
  }
}

function setLeanMeter(lean) {
  const position = LEAN_POSITIONS[lean];
  if (position == null) {
    elements.leanMeterMarker.style.left = "50%";
    elements.leanMeterMarker.className = "lean-meter-marker";
    return;
  }
  elements.leanMeterMarker.style.left = `${position}%`;
  elements.leanMeterMarker.className = `lean-meter-marker ${LEAN_CLASS[lean] ?? ""}`;
}

function renderGuardrails(payload) {
  const guardrails = payload?.guardrails;
  if (!guardrails) {
    elements.researchActionability.textContent = "-";
    elements.researchRunMode.textContent = "-";
    elements.researchConfidenceCap.textContent = "-";
    elements.researchGuardrailReasons.innerHTML = "<li>No guardrail reasons yet.</li>";
    return;
  }

  elements.researchActionability.textContent = titleCaseWords(guardrails.actionability);
  elements.researchRunMode.textContent = titleCaseWords(guardrails.runMode);
  elements.researchConfidenceCap.textContent =
    guardrails.confidenceCapApplied != null ? formatPct(guardrails.confidenceCapApplied) : "No cap";

  renderListItems(
    elements.researchGuardrailReasons,
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
    elements.researchResolutionSubject.textContent = "-";
    elements.researchResolutionComparator.textContent = "-";
    elements.researchResolutionAuthorities.textContent = "-";
    elements.researchResolutionRules.innerHTML = "<li>No resolution rules yet.</li>";
    return;
  }

  elements.researchResolutionSubject.textContent = contract.subject || contract.eventLabel || "-";
  elements.researchResolutionComparator.textContent = formatComparatorLabel(contract);
  elements.researchResolutionAuthorities.textContent = contract.authorityKinds.map(titleCaseWords).join(", ");

  const rules = [
    `YES resolves when: ${contract.decisiveYesRule}`,
    `NO resolves when: ${contract.decisiveNoRule}`,
    contract.deadlineUtc ? `Deadline: ${formatUtcDateTime(contract.deadlineUtc)}` : null,
    `Official source required: ${contract.officialSourceRequired ? "Yes" : "No"}`,
    `Early NO allowed: ${contract.earlyNoAllowed ? "Yes" : "No"}`,
    ...(contract.notes ?? [])
  ].filter(Boolean);

  renderListItems(elements.researchResolutionRules, rules, "No resolution rules yet.", (li, rule) => {
    li.textContent = rule;
  });
}

function setResearchBadge(opinion, displayLean, guardrails) {
  if (guardrails?.actionability === "abstain") {
    elements.researchBadge.textContent = "ABSTAIN";
    elements.researchBadge.className = "badge error";
  } else if (guardrails?.actionability === "monitor") {
    elements.researchBadge.textContent = "WATCH";
    elements.researchBadge.className = "badge muted";
  } else if (opinion.resolutionStatus === "RESOLVED_YES" || opinion.resolutionStatus === "RESOLVED_NO") {
    elements.researchBadge.textContent = "RESOLVED";
    elements.researchBadge.className = "badge ok";
  } else if (displayLean === "STRONG_YES" || displayLean === "STRONG_NO") {
    elements.researchBadge.textContent = formatLeanLabel(displayLean).toUpperCase();
    elements.researchBadge.className = "badge ok";
  } else if (displayLean === "LEAN_YES" || displayLean === "LEAN_NO") {
    elements.researchBadge.textContent = formatLeanLabel(displayLean).toUpperCase();
    elements.researchBadge.className = "badge ok";
  } else {
    elements.researchBadge.textContent = "TOSSUP";
    elements.researchBadge.className = "badge muted";
  }
}

export function applyProductResearch(displayPayload, evidencePayload) {
  const opinion = displayPayload.final ?? {};
  const marketOdds = deriveMarketOdds(displayPayload);
  const researchView = displayPayload.researchView ?? null;
  const guardrails = displayPayload.guardrails ?? null;
  const displayLean = researchView?.lean ?? opinion.lean;
  const displayConfidence = researchView?.leanConfidence ?? opinion.leanConfidence;
  const nextCheckAt = displayPayload.narrative?.nextCheckAt ?? opinion.nextCheckAt;

  elements.researchLeanHeadline.textContent = formatLeanLabel(displayLean);
  elements.researchLeanHeadline.className = `verdict-state ${LEAN_CLASS[displayLean] ?? ""}`;
  elements.researchLeanConfidence.textContent =
    displayConfidence != null ? `Confidence ${formatPct(displayConfidence)}` : "Confidence -";
  elements.researchResolutionStatus.textContent =
    opinion.resolutionStatus != null
      ? `Resolution: ${titleCaseWords(opinion.resolutionStatus)} (${formatPct(opinion.resolutionConfidence)})`
      : "-";
  setLeanMeter(displayLean);

  elements.researchSystemLean.textContent = researchView
    ? formatLeanWithConfidence(researchView.lean, researchView.confidenceLabel)
    : formatLeanLabel(opinion.lean);
  elements.researchSystemOdds.textContent = researchView
    ? formatProbabilityPair(researchView.systemYesProbability, researchView.systemNoProbability)
    : "-";
  elements.researchMarketOdds.textContent = formatProbabilityPair(marketOdds.yesProbability, marketOdds.noProbability);
  elements.researchEdge.textContent = formatEdgeView(researchView);
  elements.researchViewRationale.textContent = researchView?.rationale ?? "-";
  elements.researchWhy.textContent = opinion.why ?? displayPayload.narrative?.summary ?? "-";

  renderGuardrails(displayPayload);
  renderResolutionContract(displayPayload);
  renderForecast(displayPayload, researchView);
  renderAdversarialReview(displayPayload);

  elements.researchYesHeadline.textContent = opinion.yesCase?.headline ?? "Yes Case";
  elements.researchNoHeadline.textContent = opinion.noCase?.headline ?? "No Case";
  renderCaseList(elements.researchYesCase, opinion.yesCase, "yes");
  renderCaseList(elements.researchNoCase, opinion.noCase, "no");

  renderHistoricalContext(opinion.historicalContext);
  renderWhatToWatch(displayPayload.narrative?.watchItems ?? opinion.whatToWatch);
  renderModelTakes(opinion);
  renderBestSources(displayPayload);
  renderCrossMarketContext(displayPayload);
  renderCitations(displayPayload.citations);
  elements.researchOfficialSources.textContent = getTopSources(evidencePayload).length
    ? `${getTopSources(evidencePayload).length} ranked sources`
    : `${displayPayload.citations?.length ?? 0} cited sources`;
  renderTrustedSources(evidencePayload);
  elements.researchNextCheck.textContent = nextCheckAt
    ? `Next recheck: ${formatUtcDateTime(nextCheckAt)}`
    : "No scheduled recheck.";
  renderResearchNote(evidencePayload);

  setResearchBadge(opinion, displayLean, guardrails);
}
