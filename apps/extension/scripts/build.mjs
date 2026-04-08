import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const distDir = resolve(appRoot, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await cp(resolve(appRoot, "manifest.json"), resolve(distDir, "manifest.json"));

for (const entry of await readdir(resolve(appRoot, "src"))) {
  await cp(resolve(appRoot, "src", entry), resolve(distDir, entry), { recursive: true });
}
