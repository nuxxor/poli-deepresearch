import test from "node:test";
import assert from "node:assert/strict";

import type { MarketContext, ProbabilisticForecast } from "@polymarket/deep-research-contracts";

import { calibrateForecast, deriveCalibratedYesProbability } from "./calibration.js";

test("deriveCalibratedYesProbability shrinks weak historical buckets toward tossup", () => {
  const base = 0.78;
  const calibrated = deriveCalibratedYesProbability(base, 0.56);

  assert.ok(calibrated < base);
  assert.ok(calibrated > 0.5);
});

test("calibrateForecast uses archived labeled runs when available", async () => {
  const market: MarketContext = {
    rawMarket: {
      id: "1",
      question: "Will Joe Biden get Coronavirus before the election?",
      conditionId: "cond-1",
      slug: "test-market",
      description: "test",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.4", "0.6"]
    },
    canonicalMarket: {
      marketId: "m-1",
      eventId: "e-1",
      title: "Will Joe Biden get Coronavirus before the election?",
      slug: "test-market",
      description: "test",
      rulesText: "Official public statement required.",
      endTimeUtc: new Date("2020-11-04T00:00:00.000Z").toISOString(),
      category: "politics",
      subcategory: "general",
      tags: [],
      relatedTags: [],
      resolutionArchetype: "official_announcement_by_deadline",
      officialSourceRequired: true,
      earlyNoAllowed: false,
      priceBlind: true
    },
    tokenIds: []
  };

  const forecast: ProbabilisticForecast = {
    priorYesProbability: 0.5,
    posteriorYesProbability: 0.28,
    calibratedYesProbability: 0.28,
    calibratedNoProbability: 0.72,
    lean: "LEAN_NO",
    confidence: 0.44,
    notes: [],
    components: []
  };

  const calibrated = await calibrateForecast(market, forecast);

  assert.ok(
    calibrated.summary.status === "empirical" ||
      calibrated.summary.status === "weak_empirical" ||
      calibrated.summary.status === "fallback" ||
      calibrated.summary.status === "insufficient"
  );
  if (calibrated.summary.status === "empirical" || calibrated.summary.status === "weak_empirical") {
    assert.ok(calibrated.summary.sampleSize >= 3);
    assert.notEqual(calibrated.forecast.calibratedYesProbability, forecast.calibratedYesProbability);
  } else if (calibrated.summary.status === "fallback") {
    assert.ok(
      Math.abs(calibrated.forecast.calibratedYesProbability - forecast.calibratedYesProbability) <= 0.031
    );
  } else {
    assert.equal(calibrated.forecast.calibratedYesProbability, forecast.calibratedYesProbability);
  }
});
