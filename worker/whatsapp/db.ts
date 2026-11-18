import { readFileSync } from "node:fs";

import pg from "pg";

import type { Logger } from "./log";

/**
 * TLS da conexão com o banco.
 *
 * O pooler do Supabase usa certificado assinado pela CA própria do Supabase
 * (baixável no painel: Database → SSL Configuration). Com `DATABASE_SSL_CA`
 * apontando para esse arquivo, o certificado é VERIFICADO. Sem ele, a conexão
 * continua cifrada mas sem verificação — o mesmo que os scripts do projeto
 * fazem hoje — e o worker avisa no log na partida.
 */
export function sslConfig(
  databaseUrl: string,
  env: Record<string, string | undefined>,
  log: Logger,
): pg.ClientConfig["ssl"] {
  if (/@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) return false;
  const caPath = env.DATABASE_SSL_CA;
  if (caPath) return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  log("warn", "DATABASE_SSL_CA não configurada: TLS com o banco sem verificação de certificado");
  return { rejectUnauthorized: false };
}

/**
 * Pool do worker — conexão direta ao Postgres (no Supabase, o pooler em modo
 * SESSÃO, porta 5432: `SKIP LOCKED` e trava consultiva precisam de sessão).
 *
 * Poucas conexões de propósito: o banco de produção aceita 60 no total, e o
 * site divide o mesmo orçamento. Conexão que cai sai do pool sozinha; o erro
 * é logado e a próxima consulta abre outra.
 */
export function createPool(
  databaseUrl: string,
  log: Logger,
  env: Record<string, string | undefined> = process.env,
  max = 4,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    application_name: "whatsapp-worker",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig(databaseUrl, env, log),
  });
  pool.on("error", (error) => {
    log("warn", "conexão com o banco caiu; o pool abre outra", { error: error.message });
  });
  return pool;
}
