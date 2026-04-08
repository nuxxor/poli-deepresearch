import test from "node:test";
import assert from "node:assert/strict";

import type { MarketContext, ProbabilisticForecast } from "@polymarket/deep-research-contracts";

import { calibrateForecastWithCases, deriveCalibratedYesProbability, type CalibrationCase } from "./calibration.js";

test("deriveCalibratedYesProbability shrinks weak historical buckets toward tossup", () => {
  const base = 0.78;
  const calibrated = deriveCalibratedYesProbability(base, 0.56);

  assert.ok(calibrated < base);
  assert.ok(calibrated > 0.5);
});

test("calibrateForecastWithCases uses matching labeled runs when available", () => {
  const market: MarketContext = {
    rawMarket: {
      id: "1",
      question: "Will Joe Biden get Coronavirus before the election?",
      conditionId: "cond-1",
      slug: "will-joe-biden-get-coronavirus-before-the-election",
      description: "test",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.4", "0.6"]
    },
    canonicalMarket: {
      marketId: "m-1",
      eventId: "e-1",
      title: "Will Joe Biden get Coronavirus before the election?",
      slug: "will-joe-biden-get-coronavirus-before-the-election",
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

  const cases: CalibrationCase[] = [
    {
      category: "politics",
      resolutionArchetype: "official_announcement_by_deadline",
      correct: true,
      direction: "NO",
      confidence: 0.71,
      source: "archived_run"
    },
    {
      category: "politics",
      resolutionArchetype: "official_announcement_by_deadline",
      correct: true,
      direction: "NO",
      confidence: 0.64,
      source: "archived_run"
    },
    {
      category: "business",
      resolutionArchetype: "release_or_launch",
      correct: false,
      direction: "YES",
      confidence: 0.82,
      source: "archived_run"
    }
  ];

  const calibrated = calibrateForecastWithCases(market, forecast, cases);

  assert.equal(calibrated.summary.status, "empirical");
  assert.ok(calibrated.summary.sampleSize >= 2);
  assert.notEqual(calibrated.forecast.calibratedYesProbability, forecast.calibratedYesProbability);
});
