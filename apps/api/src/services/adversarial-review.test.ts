import test from "node:test";
import assert from "node:assert/strict";

import type { Opinion } from "@polymarket/deep-research-contracts";

import {
  applyAdversarialRevision,
  parseAdjudicationCandidate,
  parseDebateMemoCandidate
} from "./adversarial-review.js";

const baseOpinion: Opinion = {
  resolutionStatus: "NOT_YET_RESOLVED",
  resolutionConfidence: 0.44,
  lean: "LEAN_YES",
  leanConfidence: 0.58,
  yesCase: {
    headline: "Reasons YES",
    bullets: [{ text: "Bull case", citationUrls: [] }]
  },
  noCase: {
    headline: "Reasons NO",
    bullets: [{ text: "Bear case", citationUrls: [] }]
  },
  historicalContext: {
    narrative: "Prior launches are mixed.",
    priors: []
  },
  whatToWatch: ["Official announcement"],
  modelTake: "Base thesis.",
  why: "Base why."
};

test("applyAdversarialRevision merges revised lean and watch items", () => {
  const revised = applyAdversarialRevision(baseOpinion, {
    lean: "LEAN_NO",
    leanConfidence: 0.67,
    resolutionStatus: "NOT_YET_RESOLVED",
    resolutionConfidence: 0.61,
    why: "Critic found the decisive launch proof missing.",
    modelTake: "The earlier thesis overstated the evidence.",
    whatToWatch: ["SEC filing", "Official launch post"]
  });

  assert.equal(revised.lean, "LEAN_NO");
  assert.equal(revised.leanConfidence, 0.67);
  assert.equal(revised.resolutionConfidence, 0.61);
  assert.deepEqual(revised.whatToWatch, ["SEC filing", "Official launch post", "Official announcement"]);
  assert.equal(revised.modelTake, "The earlier thesis overstated the evidence.");
});

test("parseDebateMemoCandidate salvages bullet-style plain text", () => {
  const parsed = parseDebateMemoCandidate(`
Support thesis: The current lean still holds.
- Official source remains silent on any launch.
- Cross-market context still points to delay risk.
- No decisive contradictory filing exists.
`);

  assert.equal(parsed?.thesis, "The current lean still holds.");
  assert.deepEqual(parsed?.bullets.slice(0, 2), [
    "Official source remains silent on any launch.",
    "Cross-market context still points to delay risk."
  ]);
});

test("parseAdjudicationCandidate salvages plain-text adjudication", () => {
  const parsed = parseAdjudicationCandidate(
    `
Decision: TOSSUP
Confidence: 60%
Resolution status: NOT_YET_RESOLVED
Why: The critic exposed a real gap in the current thesis.
Model take: The market is too early for a directional lean.
Watch: SEC filing, official launch post
`,
    baseOpinion
  );

  assert.equal(parsed?.lean, "TOSSUP");
  assert.equal(parsed?.leanConfidence, 0.6);
  assert.equal(parsed?.resolutionStatus, "NOT_YET_RESOLVED");
  assert.deepEqual(parsed?.whatToWatch, ["SEC filing", "official launch post"]);
});
