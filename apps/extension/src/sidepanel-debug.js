import { elements } from "./sidepanel-dom.js";
import { formatProviderRunSummary, titleCaseWords } from "./sidepanel-formatters.js";

function renderEvidence(items, sourceSummary) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.researchEvidence.innerHTML = "<li>No evidence extracted yet.</li>";
    return;
  }

  elements.researchEvidence.innerHTML = "";
  const topSources = new Map((sourceSummary?.topSources ?? []).map((item) => [item.docId, item]));

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.sourceType} | ${item.title ?? item.canonicalUrl ?? item.url}`;

    const meta = document.createElement("div");
    const card = topSources.get(item.docId);
    meta.textContent = `${Math.round((item.authorityScore ?? 0) * 100)} auth | ${Math.round((item.freshnessScore ?? 0) * 100)} fresh${card ? ` | ${Math.round((card.score ?? 0) * 100)} score | ${card.stance}` : ""}`;
    li.append(meta);

    elements.researchEvidence.append(li);
  }
}

function renderClaims(items) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.researchClaims.innerHTML = "<li>No claims extracted yet.</li>";
    return;
  }

  elements.researchClaims.innerHTML = "";

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.polarity} | ${item.subject} -> ${item.predicate}`;

    const meta = document.createElement("div");
    meta.textContent = `${Math.round((item.confidence ?? 0) * 100)}% | ${item.object}`;
    li.append(meta);

    elements.researchClaims.append(li);
  }
}

function renderSignals(summary) {
  if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) {
    elements.researchSignalItems.innerHTML = "<li>No signals fetched yet.</li>";
    return;
  }

  elements.researchSignalItems.innerHTML = "";

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
    elements.researchSignalItems.append(li);
  }
}

function resetInternalDetails() {
  elements.researchFinalMode.textContent = "-";
  elements.researchParallelRun.textContent = "-";
  elements.researchXaiRun.textContent = "-";
  elements.researchDirectRun.textContent = "-";
  elements.researchLocalRun.textContent = "-";
  elements.researchCost.textContent = "-";
  elements.researchCache.textContent = "-";
  elements.researchEvidenceCount.textContent = "-";
  elements.researchClaimCount.textContent = "-";
  elements.researchSourceScore.textContent = "-";
  elements.researchGraph.textContent = "-";
  elements.researchSignals.textContent = "-";
  elements.researchMacroOfficial.textContent = "-";
  elements.researchPlanner.textContent = "-";
  elements.researchEvidence.innerHTML = "<li>No evidence extracted yet.</li>";
  elements.researchClaims.innerHTML = "<li>No claims extracted yet.</li>";
  elements.researchSignalItems.innerHTML = "<li>No signals fetched yet.</li>";
}

export function applyDebugResearch(payload) {
  if (!payload) {
    resetInternalDetails();
    return;
  }

  elements.researchFinalMode.textContent = titleCaseWords(payload?.strategy?.finalMode);
  elements.researchParallelRun.textContent = formatProviderRunSummary(payload?.parallelRun);
  elements.researchXaiRun.textContent = formatProviderRunSummary(payload?.xaiRun);
  elements.researchDirectRun.textContent = formatProviderRunSummary(payload?.directRun);
  elements.researchLocalRun.textContent = formatProviderRunSummary(payload?.localOpinionRun);
  elements.researchCost.textContent = payload?.costs
    ? `$${Number(payload.costs.totalUsd ?? 0).toFixed(4)} | ${payload.latencies?.totalMs ?? 0} ms`
    : "-";
  elements.researchCache.textContent = payload?.cache?.hit
    ? `hit | expires ${payload.cache.expiresAt}`
    : payload?.cache
      ? `miss | expires ${payload.cache.expiresAt ?? "-"}`
      : "-";
  elements.researchEvidenceCount.textContent = `${payload?.evidence?.length ?? 0}`;
  elements.researchClaimCount.textContent = `${payload?.claims?.length ?? 0}`;
  elements.researchSourceScore.textContent = payload?.sourceSummary
    ? `${Math.round((payload.sourceSummary.averageScore ?? 0) * 100)}%`
    : "-";
  elements.researchGraph.textContent = payload?.evidenceGraph
    ? `${payload.evidenceGraph.nodes?.length ?? 0} nodes | ${payload.evidenceGraph.edges?.length ?? 0} edges`
    : "-";
  elements.researchSignals.textContent = payload?.signals
    ? `${payload.signals.totalItems} items | ${payload.signals.cacheHit ? "cache" : "fresh"}`
    : "-";
  elements.researchMacroOfficial.textContent = payload?.macroOfficialContext
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
  elements.researchPlanner.textContent = payload?.localPlanner
    ? `${payload.localPlanner.source}${payload.localPlanner.model ? ` | ${payload.localPlanner.model}` : ""}`
    : "-";

  renderEvidence(payload?.evidence, payload?.sourceSummary);
  renderClaims(payload?.claims);
  renderSignals(payload?.signals);
}
