import { applyDebugResearch } from "./sidepanel-debug.js";
import { clearResearch, elements, setResearchIdle } from "./sidepanel-dom.js";
import { applyProductResearch } from "./sidepanel-product.js";

export { clearResearch, elements, setResearchIdle };

export function applyResearch(productPayload, debugPayload = null) {
  const displayPayload = productPayload ?? debugPayload ?? {};
  const evidencePayload = debugPayload ? { ...displayPayload, ...debugPayload } : displayPayload;

  applyProductResearch(displayPayload, evidencePayload);
  applyDebugResearch(debugPayload);
}
