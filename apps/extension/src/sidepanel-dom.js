export const elements = {
  healthBadge: document.querySelector("#health-badge"),
  healthCopy: document.querySelector("#health-copy"),
  pageUrl: document.querySelector("#page-url"),
  pageSlug: document.querySelector("#page-slug"),
  pageHeading: document.querySelector("#page-heading"),
  contextBadge: document.querySelector("#context-badge"),
  conditionId: document.querySelector("#condition-id"),
  marketCategory: document.querySelector("#market-category"),
  marketArchetype: document.querySelector("#market-archetype"),
  marketPolicyPack: document.querySelector("#market-policy-pack"),
  marketTokens: document.querySelector("#market-tokens"),
  refreshButton: document.querySelector("#refresh-button"),
  researchButton: document.querySelector("#research-button"),
  researchBadge: document.querySelector("#research-badge"),
  researchLeanHeadline: document.querySelector("#research-lean-headline"),
  researchLeanConfidence: document.querySelector("#research-lean-confidence"),
  researchResolutionStatus: document.querySelector("#research-resolution-status"),
  leanMeterMarker: document.querySelector("#lean-meter-marker"),
  researchSystemLean: document.querySelector("#research-system-lean"),
  researchSystemOdds: document.querySelector("#research-system-odds"),
  researchMarketOdds: document.querySelector("#research-market-odds"),
  researchEdge: document.querySelector("#research-edge"),
  researchViewRationale: document.querySelector("#research-view-rationale"),
  researchWhy: document.querySelector("#research-why"),
  researchActionability: document.querySelector("#research-actionability"),
  researchRunMode: document.querySelector("#research-run-mode"),
  researchConfidenceCap: document.querySelector("#research-confidence-cap"),
  researchGuardrailReasons: document.querySelector("#research-guardrail-reasons"),
  researchResolutionSubject: document.querySelector("#research-resolution-subject"),
  researchResolutionComparator: document.querySelector("#research-resolution-comparator"),
  researchResolutionAuthorities: document.querySelector("#research-resolution-authorities"),
  researchResolutionRules: document.querySelector("#research-resolution-rules"),
  researchProbabilitySource: document.querySelector("#research-probability-source"),
  researchPosteriorOdds: document.querySelector("#research-posterior-odds"),
  researchCalibratedOdds: document.querySelector("#research-calibrated-odds"),
  researchCalibration: document.querySelector("#research-calibration"),
  researchAdversarialStatus: document.querySelector("#research-adversarial-status"),
  researchAdversarialNotes: document.querySelector("#research-adversarial-notes"),
  researchYesHeadline: document.querySelector("#research-yes-headline"),
  researchNoHeadline: document.querySelector("#research-no-headline"),
  researchYesCase: document.querySelector("#research-yes-case"),
  researchNoCase: document.querySelector("#research-no-case"),
  researchHistoricalNarrative: document.querySelector("#research-historical-narrative"),
  researchHistoricalPriors: document.querySelector("#research-historical-priors"),
  researchWhatToWatch: document.querySelector("#research-what-to-watch"),
  researchNextCheck: document.querySelector("#research-next-check"),
  researchModelTake: document.querySelector("#research-model-take"),
  researchSecondModelTake: document.querySelector("#research-second-model-take"),
  researchBestSources: document.querySelector("#research-best-sources"),
  researchCrossMarketSummary: document.querySelector("#research-cross-market-summary"),
  researchCrossMarketList: document.querySelector("#research-cross-market-list"),
  researchOfficialItems: document.querySelector("#research-official-items"),
  researchOfficialSources: document.querySelector("#research-official-sources"),
  researchNote: document.querySelector("#research-note"),
  researchFinalMode: document.querySelector("#research-final-mode"),
  researchParallelRun: document.querySelector("#research-parallel-run"),
  researchXaiRun: document.querySelector("#research-xai-run"),
  researchDirectRun: document.querySelector("#research-direct-run"),
  researchLocalRun: document.querySelector("#research-local-run"),
  researchCost: document.querySelector("#research-cost"),
  researchCache: document.querySelector("#research-cache"),
  researchEvidenceCount: document.querySelector("#research-evidence-count"),
  researchClaimCount: document.querySelector("#research-claim-count"),
  researchSourceScore: document.querySelector("#research-source-score"),
  researchGraph: document.querySelector("#research-graph"),
  researchSignals: document.querySelector("#research-signals"),
  researchMacroOfficial: document.querySelector("#research-macro-official"),
  researchPlanner: document.querySelector("#research-planner"),
  researchCitations: document.querySelector("#research-citations"),
  researchEvidence: document.querySelector("#research-evidence"),
  researchClaims: document.querySelector("#research-claims"),
  researchSummaryItems: document.querySelector("#research-summary-items"),
  researchSignalItems: document.querySelector("#research-signal-items")
};

export function setResearchIdle(copy = "Idle") {
  elements.researchBadge.textContent = copy;
  elements.researchBadge.className = "badge muted";
}

export function clearResearch() {
  setResearchIdle();
  elements.marketPolicyPack.textContent = "-";
  elements.researchLeanHeadline.textContent = "-";
  elements.researchLeanHeadline.className = "verdict-state";
  elements.researchLeanConfidence.textContent = "-";
  elements.researchResolutionStatus.textContent = "-";
  elements.leanMeterMarker.style.left = "50%";
  elements.leanMeterMarker.className = "lean-meter-marker";
  elements.researchSystemLean.textContent = "-";
  elements.researchSystemOdds.textContent = "-";
  elements.researchMarketOdds.textContent = "-";
  elements.researchEdge.textContent = "-";
  elements.researchViewRationale.textContent = "-";
  elements.researchWhy.textContent = "-";
  elements.researchActionability.textContent = "-";
  elements.researchRunMode.textContent = "-";
  elements.researchConfidenceCap.textContent = "-";
  elements.researchGuardrailReasons.innerHTML = "<li>No guardrail reasons yet.</li>";
  elements.researchResolutionSubject.textContent = "-";
  elements.researchResolutionComparator.textContent = "-";
  elements.researchResolutionAuthorities.textContent = "-";
  elements.researchResolutionRules.innerHTML = "<li>No resolution rules yet.</li>";
  elements.researchProbabilitySource.textContent = "-";
  elements.researchPosteriorOdds.textContent = "-";
  elements.researchCalibratedOdds.textContent = "-";
  elements.researchCalibration.textContent = "-";
  elements.researchAdversarialStatus.textContent = "-";
  elements.researchAdversarialNotes.innerHTML = "<li>No adversarial review yet.</li>";
  elements.researchYesHeadline.textContent = "Yes Case";
  elements.researchNoHeadline.textContent = "No Case";
  elements.researchYesCase.innerHTML = "<li>No yes-side case yet.</li>";
  elements.researchNoCase.innerHTML = "<li>No no-side case yet.</li>";
  elements.researchHistoricalNarrative.textContent = "-";
  elements.researchHistoricalPriors.innerHTML = "<li>No priors surfaced yet.</li>";
  elements.researchWhatToWatch.innerHTML = "<li>No watch items yet.</li>";
  elements.researchNextCheck.textContent = "-";
  elements.researchModelTake.textContent = "-";
  elements.researchSecondModelTake.textContent = "-";
  elements.researchBestSources.innerHTML = "<li>No source ranking yet.</li>";
  elements.researchCrossMarketSummary.textContent = "-";
  elements.researchCrossMarketList.innerHTML = "<li>No related market context yet.</li>";
  elements.researchOfficialItems.innerHTML = "<li>No trusted sources surfaced yet.</li>";
  elements.researchOfficialSources.textContent = "-";
  elements.researchNote.innerHTML = "<p>No narrative note yet.</p>";
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
  elements.researchCitations.innerHTML = "<li>No research run yet.</li>";
  elements.researchEvidence.innerHTML = "<li>No evidence extracted yet.</li>";
  elements.researchClaims.innerHTML = "<li>No claims extracted yet.</li>";
  elements.researchSummaryItems.innerHTML = "<li>No offline summary yet.</li>";
  elements.researchSignalItems.innerHTML = "<li>No signals fetched yet.</li>";
}
