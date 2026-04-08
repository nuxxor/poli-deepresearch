import { existsSync } from "node:fs";
import { resolve } from "node:path";

import dotenv from "dotenv";
import { DeepResearchEnvSchema, type DeepResearchEnv, PublicConfigSchema } from "@polymarket/deep-research-contracts";
import { API_WORKSPACE_ROOT, PROJECT_ROOT } from "./paths.js";

function loadDotEnv(): void {
  const candidates = [
    resolve(API_WORKSPACE_ROOT, ".env"),
    resolve(PROJECT_ROOT, ".env"),
    resolve(PROJECT_ROOT, "../.env")
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    dotenv.config({ path: candidate, override: false });
    return;
  }
}

loadDotEnv();

export const env: DeepResearchEnv = DeepResearchEnvSchema.parse(process.env);

export const publicConfig = PublicConfigSchema.parse({
  apiBaseUrl: `http://${env.API_HOST}:${env.API_PORT}`,
  stack: {
    search: "parallel-chat-core",
    extract: "tier1+parallel",
    social: ["twitterapi", "gdelt"],
    llmPrimary: "parallel-chat-core",
    llmFallback: ["xai-web-search"],
    llmLocal: [`ollama:${env.OLLAMA_MODEL_PRIMARY}`, `ollama:${env.OLLAMA_MODEL_REASONER}`]
  }
});
