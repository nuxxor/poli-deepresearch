import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

export const API_WORKSPACE_ROOT = resolve(SRC_DIR, "..");
export const PROJECT_ROOT = resolve(SRC_DIR, "../../..");
export const CACHE_ROOT = resolve(PROJECT_ROOT, ".cache");
export const DATA_ROOT = resolve(PROJECT_ROOT, ".data");
