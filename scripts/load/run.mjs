#!/usr/bin/env node
/**
 * Empacota o worker e a ferramenta de carga e roda a carga.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     node scripts/load/run.mjs --profile 15m [--window-minutes 10] [--rate 80]
 *
 * Detalhes: scripts/load/README.md.
 */
import { spawnSync } from "node:child_process";

import { build } from "esbuild";

const worker = spawnSync(process.execPath, ["scripts/build-worker.mjs"], { stdio: "inherit" });
if (worker.status !== 0) process.exit(worker.status ?? 1);

await build({
  entryPoints: ["scripts/load/whatsapp-load.ts"],
  outfile: "dist/load.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  logLevel: "warning",
});

const run = spawnSync(process.execPath, ["dist/load.cjs", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(run.status ?? 1);
