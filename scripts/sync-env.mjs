#!/usr/bin/env node
/**
 * Sincroniza o .env.local com as credenciais do Supabase local.
 *
 * Lê `supabase status -o env` e reescreve apenas as chaves de conexão,
 * preservando todo o resto do arquivo (comentários, RESEND_API_KEY etc).
 *
 *   npm run db:env
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

function readSupabaseStatus() {
  try {
    const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return Object.fromEntries(
      output
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z0-9_]+)="?(.*?)"?$/))
        .filter(Boolean)
        .map((match) => [match[1], match[2]]),
    );
  } catch {
    console.error(
      "\n✗ Não consegui ler o status do Supabase.\n" +
        "  Verifique se o Docker Desktop está rodando e execute: npx supabase start\n",
    );
    process.exit(1);
  }
}

/** Substitui a chave se existir; acrescenta ao final se não existir. */
function upsert(content, key, value) {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

const status = readSupabaseStatus();

const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;

if (!anonKey || !serviceKey) {
  console.error(
    "\n✗ O status não trouxe as chaves esperadas.\n" +
      `  Chaves recebidas: ${Object.keys(status).join(", ") || "(nenhuma)"}\n`,
  );
  process.exit(1);
}

let content = existsSync(ENV_PATH)
  ? readFileSync(ENV_PATH, "utf8")
  : readFileSync(EXAMPLE_PATH, "utf8");

const updates = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  ...(status.JWT_SECRET ? { SUPABASE_JWT_SECRET: status.JWT_SECRET } : {}),
  ...(status.DB_URL ? { DATABASE_URL: status.DB_URL } : {}),
};

for (const [key, value] of Object.entries(updates)) {
  content = upsert(content, key, value);
}

writeFileSync(ENV_PATH, content, "utf8");

console.log("\n✓ .env.local sincronizado com o Supabase local:");
for (const key of Object.keys(updates)) {
  console.log(`  · ${key}`);
}
console.log(`\n  Studio:   ${status.STUDIO_URL ?? "http://127.0.0.1:54323"}`);
console.log(`  E-mails:  ${status.INBUCKET_URL ?? "http://127.0.0.1:54324"}\n`);
