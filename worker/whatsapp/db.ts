import { readFileSync } from "node:fs";

import pg from "pg";

import type { Logger } from "./log";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLocal(databaseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * TLS da conexão com o banco — falha FECHADO.
 *
 * O pooler do Supabase usa certificado assinado pela CA própria do Supabase
 * (baixável no painel: Database → SSL Configuration). Com `DATABASE_SSL_CA`
 * apontando para esse arquivo, o certificado é VERIFICADO.
 *
 * Sem a CA, o worker se recusa a subir. A única saída é a liberação
 * explícita `DATABASE_SSL_INSECURE=1` (cifra sem verificar, como os scripts
 * do projeto fazem hoje), que fica registrada no log a cada partida — a
 * decisão de aceitar o risco é de quem opera, e fica visível.
 */
export function sslConfig(
  databaseUrl: string,
  env: Record<string, string | undefined>,
  log: Logger,
): pg.ClientConfig["ssl"] {
  if (isLocal(databaseUrl)) return false;

  const caPath = env.DATABASE_SSL_CA;
  if (caPath) return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };

  if (env.DATABASE_SSL_INSECURE === "1") {
    log("warn", "DATABASE_SSL_INSECURE=1: TLS com o banco SEM verificação de certificado");
    return { rejectUnauthorized: false };
  }

  throw new Error(
    "DATABASE_SSL_CA não configurada: baixe a CA do Supabase (Database → SSL Configuration) " +
      "e aponte DATABASE_SSL_CA para o arquivo — ou, assumindo o risco, DATABASE_SSL_INSECURE=1.",
  );
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
