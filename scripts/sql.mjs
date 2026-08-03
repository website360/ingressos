#!/usr/bin/env node
/**
 * Executa SQL no banco remoto e imprime o erro COMPLETO do Postgres.
 *
 * O `supabase db push` resume a falha em "Failed to execute statement", sem
 * código, detalhe ou hint — o que torna o diagnóstico impossível. Este script
 * existe para isso.
 *
 *   node scripts/sql.mjs -c "select 1"
 *   node scripts/sql.mjs -f supabase/migrations/xxxx.sql
 */
import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDatabaseUrl() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error(".env.local não encontrado.");

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada no .env.local.");
}

const [flag, value] = process.argv.slice(2);
if (!flag || !value) {
  console.error('Uso: node scripts/sql.mjs -c "SQL"  |  -f caminho/arquivo.sql');
  process.exit(1);
}

const sql = flag === "-f" ? readFileSync(resolve(process.cwd(), value), "utf8") : value;

const client = new pg.Client({
  connectionString: loadDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query(sql);
  const rows = Array.isArray(result) ? result.at(-1)?.rows : result.rows;
  if (rows?.length) console.table(rows);
  else console.log("✓ OK (sem linhas retornadas)");
} catch (error) {
  console.error("\n✗ ERRO DO POSTGRES");
  for (const key of ["severity", "code", "message", "detail", "hint", "where", "position"]) {
    if (error[key]) console.error(`  ${key.padEnd(9)}: ${error[key]}`);
  }
  console.error("");
  process.exitCode = 1;
} finally {
  await client.end();
}
