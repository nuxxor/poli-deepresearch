import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";

import {
  FredSeriesLatestResponseSchema,
  FredSeriesSearchResponseSchema,
  HotMarketSyncRequestSchema,
  HotMarketTickRequestSchema,
  type HotMarketQueue,
  type HotMarketTickResponse,
  MarketResearchRequestSchema,
  ResearchReplayRequestSchema,
  type ResearchRunListResponse,
  type ResearchRunRecord,
  type MarketResearchResponse,
  ProviderBenchmarkRequestSchema,
  type HealthResponse,
  type ProviderAvailability,
  type ProviderHealthResponse,
  type ProviderBenchmarkReport,
  type PublicConfig,
  type MarketSignalsSummary,
  type FredSeriesLatestResponse,
  type FredSeriesSearchResponse,
  type ResearchProductResponse
} from "@polymarket/deep-research-contracts";

import { env, publicConfig } from "./config.js";
import { getProviderAvailability, runProviderBenchmark } from "./services/benchmarks.js";
import { renderDebugScreenHtml } from "./services/debug-screen.js";
import { mapMarketToFredSeries } from "./services/fred-mapper.js";
import { buildMacroOfficialContext } from "./services/macro-official.js";
import { getHotMarketQueue, syncHotMarketQueue, tickHotMarketQueue } from "./services/monitors.js";
import { fetchMarketContextBySlug } from "./services/polymarket.js";
import { resolveAppliedPolicy } from "./services/policies.js";
import { getProviderHealthSnapshot } from "./services/provider-health.js";
import { fetchFredSeriesLatest, searchFredSeries } from "./services/providers/fred.js";
import { buildSearchQueryPlan } from "./services/queries.js";
import { buildResearchProductResponse } from "./services/research-projection.js";
import { runMarketResearchByConditionId, runMarketResearchBySlug } from "./services/research.js";
import { listRecentResearchRuns, loadResearchRun } from "./services/research-runs.js";
import { fetchMarketSignals } from "./services/signals.js";

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseLatestResearchQuery(query: unknown) {
  const raw = (query ?? {}) as {
    bypassCache?: string;
    maxCitations?: string;
  };

  const payload = {
    bypassCache: parseBooleanFlag(raw.bypassCache),
    maxCitations:
      typeof raw.maxCitations === "string" && raw.maxCitations.trim() !== ""
        ? Number.parseInt(raw.maxCitations, 10)
        : undefined
  };

  return MarketResearchRequestSchema.parse(payload);
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  await app.register(cors, {
    origin: true
  });

  app.get("/v1/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      service: "deep-research-api",
      time: new Date().toISOString(),
      version: "0.1.0"
    };
  });

  app.get("/v1/config/public", async (): Promise<PublicConfig> => {
    return publicConfig;
  });

  app.get("/v1/providers/status", async (): Promise<ProviderAvailability> => {
    return await getProviderAvailability();
  });

  app.get("/v1/providers/health", async (): Promise<ProviderHealthResponse> => {
    return getProviderHealthSnapshot();
  });

  app.get(
    "/v1/fred/search",
    async (request, reply): Promise<FredSeriesSearchResponse | { error: string }> => {
      const query = request.query as { q?: string; limit?: string };

      try {
        const q = (query.q ?? "").trim();
        const limit = Number.parseInt(query.limit ?? "5", 10);

        if (q === "") {
          reply.code(400);
          return { error: "Missing q parameter" };
        }

        return FredSeriesSearchResponseSchema.parse(
          await searchFredSeries(q, Number.isNaN(limit) ? 5 : limit)
        );
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "FRED search failed"
        };
      }
    }
  );

  app.get(
    "/v1/fred/series/:seriesId/latest",
    async (request, reply): Promise<FredSeriesLatestResponse | { error: string; seriesId: string }> => {
      const { seriesId } = request.params as { seriesId: string };

      try {
        return FredSeriesLatestResponseSchema.parse(await fetchFredSeriesLatest(seriesId));
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "FRED latest fetch failed",
          seriesId
        };
      }
    }
  );

  app.get("/debug/research", async (_, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderDebugScreenHtml();
  });

  app.get("/v1/policies/slug/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      const market = await fetchMarketContextBySlug(slug);
      return {
        market: market.canonicalMarket,
        appliedPolicy: resolveAppliedPolicy(market),
        queryPlan: buildSearchQueryPlan(market)
      };
    } catch (error) {
      reply.code(404);
      return {
        error: error instanceof Error ? error.message : "Policy lookup failed",
        slug
      };
    }
  });

  app.get("/v1/markets/slug/:slug/context", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      return await fetchMarketContextBySlug(slug);
    } catch (error) {
      reply.code(404);
      return {
        error: error instanceof Error ? error.message : "Unknown market lookup error",
        slug
      };
    }
  });

  app.get("/v1/fred/map/slug/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      const market = await fetchMarketContextBySlug(slug);
      return {
        market: market.canonicalMarket,
        fredMapping: mapMarketToFredSeries(market),
        macroOfficialContext: await buildMacroOfficialContext(market).catch(() => null)
      };
    } catch (error) {
      reply.code(404);
      return {
        error: error instanceof Error ? error.message : "FRED mapping lookup failed",
        slug
      };
    }
  });

  app.get(
    "/v1/signals/slug/:slug",
    async (request, reply): Promise<MarketSignalsSummary | { error: string; slug: string }> => {
      const { slug } = request.params as { slug: string };

      try {
        const market = await fetchMarketContextBySlug(slug);
        return await fetchMarketSignals(market);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Signal fetch failed",
          slug
        };
      }
    }
  );

  app.post("/v1/benchmarks/providers", async (request, reply): Promise<ProviderBenchmarkReport | { error: string }> => {
    try {
      const payload = ProviderBenchmarkRequestSchema.parse(request.body ?? {});
      return await runProviderBenchmark(payload);
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : "Invalid benchmark request"
      };
    }
  });

  app.get("/v1/monitors/hot-markets", async (): Promise<HotMarketQueue> => {
    return getHotMarketQueue();
  });

  app.post(
    "/v1/monitors/hot-markets/sync",
    async (request, reply): Promise<HotMarketQueue | { error: string }> => {
      try {
        const payload = HotMarketSyncRequestSchema.parse(request.body ?? {});
        return await syncHotMarketQueue(payload.limit);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Hot market sync failed"
        };
      }
    }
  );

  app.post(
    "/v1/monitors/tick",
    async (request, reply): Promise<HotMarketTickResponse | { error: string }> => {
      try {
        const payload = HotMarketTickRequestSchema.parse(request.body ?? {});
        return await tickHotMarketQueue(payload);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Monitor tick failed"
        };
      }
    }
  );

  app.get(
    "/v1/research/runs/recent",
    async (request, reply): Promise<ResearchRunListResponse | { error: string }> => {
      try {
        const query = request.query as { limit?: string };
        const limit = Number.parseInt(query.limit ?? "20", 10);
        return await listRecentResearchRuns(Number.isNaN(limit) ? 20 : Math.min(Math.max(limit, 1), 100));
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Run listing failed"
        };
      }
    }
  );

  app.get(
    "/v1/research/run/:runId",
    async (request, reply): Promise<ResearchRunRecord | { error: string; runId: string }> => {
      const { runId } = request.params as { runId: string };

      try {
        return await loadResearchRun(runId);
      } catch (error) {
        reply.code(404);
        return {
          error: error instanceof Error ? error.message : "Run lookup failed",
          runId
        };
      }
    }
  );

  app.post(
    "/v1/research/run/:runId/replay",
    async (request, reply): Promise<MarketResearchResponse | { error: string; runId: string }> => {
      const { runId } = request.params as { runId: string };

      try {
        const record = await loadResearchRun(runId);
        const payload = ResearchReplayRequestSchema.parse(request.body ?? {});
        const mergedRequest = MarketResearchRequestSchema.parse({
          ...record.request,
          ...payload,
          bypassCache: payload.bypassCache ?? true
        });

        const slug = record.response.market.canonicalMarket.slug;
        if (slug) {
          return await runMarketResearchBySlug(slug, mergedRequest, {
            runType: "replay_run",
            replayOfRunId: runId
          });
        }

        return await runMarketResearchByConditionId(
          record.response.market.canonicalMarket.marketId,
          mergedRequest,
          {
            runType: "replay_run",
            replayOfRunId: runId
          }
        );
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Replay failed",
          runId
        };
      }
    }
  );

  app.get(
    "/v1/research/market/:marketId/product",
    async (request, reply): Promise<ResearchProductResponse | { error: string; marketId: string }> => {
      const { marketId } = request.params as { marketId: string };

      try {
        const response = await runMarketResearchByConditionId(marketId, parseLatestResearchQuery(request.query));
        return buildResearchProductResponse(response);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Research product view failed",
          marketId
        };
      }
    }
  );

  app.get(
    "/v1/research/market/:marketId/latest",
    async (request, reply): Promise<MarketResearchResponse | { error: string; marketId: string }> => {
      const { marketId } = request.params as { marketId: string };

      try {
        return await runMarketResearchByConditionId(marketId, parseLatestResearchQuery(request.query));
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Research run failed",
          marketId
        };
      }
    }
  );

  app.post(
    "/v1/research/market/:marketId",
    async (request, reply): Promise<MarketResearchResponse | { error: string; marketId: string }> => {
      const { marketId } = request.params as { marketId: string };
      try {
        const payload = MarketResearchRequestSchema.parse(request.body ?? {});
        return await runMarketResearchByConditionId(marketId, payload);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Research run failed",
          marketId
        };
      }
    }
  );

  app.get(
    "/v1/research/slug/:slug/product",
    async (request, reply): Promise<ResearchProductResponse | { error: string; slug: string }> => {
      const { slug } = request.params as { slug: string };

      try {
        const response = await runMarketResearchBySlug(slug, parseLatestResearchQuery(request.query));
        return buildResearchProductResponse(response);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Research product view failed",
          slug
        };
      }
    }
  );

  app.get(
    "/v1/research/slug/:slug/latest",
    async (request, reply): Promise<MarketResearchResponse | { error: string; slug: string }> => {
      const { slug } = request.params as { slug: string };

      try {
        return await runMarketResearchBySlug(slug, parseLatestResearchQuery(request.query));
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Research run failed",
          slug
        };
      }
    }
  );

  app.post(
    "/v1/research/slug/:slug",
    async (request, reply): Promise<MarketResearchResponse | { error: string; slug: string }> => {
      const { slug } = request.params as { slug: string };

      try {
        const payload = MarketResearchRequestSchema.parse(request.body ?? {});
        return await runMarketResearchBySlug(slug, payload);
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : "Research run failed",
          slug
        };
      }
    }
  );

  return app;
}
