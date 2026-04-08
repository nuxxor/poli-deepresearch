import { API_BASE, fetchHealthStatus, fetchMarketContext, fetchResearchLatest, fetchResearchProduct } from "./api-client.js";
import { clearResearch, elements, applyResearch, setResearchIdle } from "./sidepanel-view.js";

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
    elements.healthBadge.textContent = payload.status.toUpperCase();
    elements.healthBadge.className = "badge ok";
    elements.healthCopy.textContent = `${API_BASE}/v1/health`;
  } catch (error) {
    elements.healthBadge.textContent = "OFFLINE";
    elements.healthBadge.className = "badge error";
    elements.healthCopy.textContent = `${API_BASE}/v1/health :: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

async function loadActiveTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url) {
    elements.pageUrl.textContent = "-";
    elements.pageSlug.textContent = "-";
    elements.pageHeading.textContent = "-";
    elements.contextBadge.textContent = "NO TAB";
    elements.contextBadge.className = "badge muted";
    currentSlug = null;
    clearResearch();
    return;
  }

  elements.pageUrl.textContent = tab.url;
  const slug = inferSlug(tab.url);
  elements.pageSlug.textContent = slug ?? "-";

  try {
    const context = await chrome.tabs.sendMessage(tab.id, {
      type: "deep-research:get-page-context"
    });
    elements.pageHeading.textContent = context?.heading ?? context?.title ?? "-";
  } catch {
    elements.pageHeading.textContent = tab.title ?? "-";
  }

  if (!slug) {
    elements.conditionId.textContent = "-";
    elements.marketCategory.textContent = "-";
    elements.marketArchetype.textContent = "-";
    elements.marketPolicyPack.textContent = "-";
    elements.marketTokens.textContent = "-";
    elements.contextBadge.textContent = "NO SLUG";
    elements.contextBadge.className = "badge muted";
    currentSlug = null;
    clearResearch();
    return;
  }

  try {
    const payload = await fetchMarketContext(slug);
    elements.conditionId.textContent = payload.canonicalMarket.marketId;
    elements.marketCategory.textContent = payload.canonicalMarket.category;
    elements.marketArchetype.textContent = payload.canonicalMarket.resolutionArchetype;
    elements.marketPolicyPack.textContent = "-";
    elements.marketTokens.textContent = payload.tokenIds.join(", ") || "-";
    elements.contextBadge.textContent = "READY";
    elements.contextBadge.className = "badge ok";
    if (currentSlug !== slug) {
      clearResearch();
    }
    currentSlug = slug;
  } catch (error) {
    elements.conditionId.textContent = "-";
    elements.marketCategory.textContent = "-";
    elements.marketArchetype.textContent = "-";
    elements.marketPolicyPack.textContent = "-";
    elements.marketTokens.textContent = "-";
    elements.contextBadge.textContent = "MISS";
    elements.contextBadge.className = "badge error";
    elements.pageHeading.textContent = `${elements.pageHeading.textContent} :: ${error instanceof Error ? error.message : "Context error"}`;
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

  elements.researchButton.disabled = true;
  elements.researchBadge.textContent = "RUNNING";
  elements.researchBadge.className = "badge muted";

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
      elements.marketPolicyPack.textContent = debugPayload.appliedPolicy.pack.id;
    }
  } catch (error) {
    elements.researchBadge.textContent = "ERROR";
    elements.researchBadge.className = "badge error";
    elements.researchWhy.textContent = error instanceof Error ? error.message : "Research error";
  } finally {
    elements.researchButton.disabled = false;
  }
}

elements.refreshButton.addEventListener("click", () => {
  void refresh();
});

elements.researchButton.addEventListener("click", () => {
  void runResearch();
});

clearResearch();
void refresh();
