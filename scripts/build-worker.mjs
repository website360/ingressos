#!/usr/bin/env node
/**
 * Empacota o worker do WhatsApp em dist/worker.js.
 *
 * Dependências ficam de fora do pacote (`packages: "external"`): o processo
 * roda no diretório da aplicação, com o node_modules do `npm ci`.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["worker/whatsapp/index.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
