#!/usr/bin/env node
/**
 * Diagnóstico do ambiente: `npm run doctor`
 *
 * Verifica, em ordem de dependência, tudo que precisa estar certo para o painel
 * abrir — incluindo as configurações que vivem apenas no painel do Supabase e
 * que o config.toml não aplica na nuvem.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const results = [];

function record(ok, label, detail, fix) {
  results.push({ ok, label, detail, fix });
}

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;

// 1. Variáveis de ambiente ----------------------------------------------------
const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"].filter(
  (key) => !env[key] || env[key].startsWith("COLE_") || env[key].includes("[YOUR-PASSWORD]"),
);
record(
  missing.length === 0,
  "Variáveis de ambiente",
  missing.length ? `faltando: ${missing.join(", ")}` : "as 4 chaves estão preenchidas",
  "Preencher no .env.local — ver docs/10-instalacao.md, seção 0.2",
);

if (missing.includes("NEXT_PUBLIC_SUPABASE_URL")) {
  report();
  process.exit(1);
}

// 2. Projeto acessível --------------------------------------------------------
let projectUp = false;
try {
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
  projectUp = response.ok;
  record(response.ok, "Projeto Supabase acessível", `HTTP ${response.status}`, "Conferir se o projeto não está pausado");
} catch (error) {
  record(false, "Projeto Supabase acessível", error.message, "Conferir a URL e a conexão");
}

// 3. Fachada de RPC acessível -------------------------------------------------
if (projectUp) {
  const response = await fetch(`${url}/rest/v1/rpc/my_context`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await response.json().catch(() => ({}));

  // Sem sessão, a função responde IG005 ("Não autenticado") — o que já prova
  // que ela existe e está exposta. PGRST202 significaria função inexistente.
  const exists = body.code !== "PGRST202";
  record(
    exists,
    "RPC public.my_context disponível",
    exists ? "exposta" : (body.message ?? "não encontrada"),
    "Rodar `npm run db:push`",
  );
}

// 4. Hook de token ativo ------------------------------------------------------
if (projectUp) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@agenciamay.com.br", password: "Ingressos@2026" }),
  });
  const body = await response.json().catch(() => ({}));

  if (!body.access_token) {
    record(false, "Login do usuário de teste", body.error_description ?? body.msg ?? "falhou", "Rodar `npm run db:seed`");
  } else {
    record(true, "Login do usuário de teste", "admin@agenciamay.com.br autenticou", null);

    const claims = JSON.parse(Buffer.from(body.access_token.split(".")[1], "base64url").toString());
    const meta = claims.app_metadata ?? {};
    const hookOk = Array.isArray(meta.tenant_ids) && meta.active_tenant;

    // Otimização, não pré-requisito: sem o hook, os helpers de RLS consultam o
    // banco (migration 20260801091100_zero_config).
    record(
      true,
      "Custom Access Token Hook",
      hookOk
        ? `ativo — ${meta.tenant_ids.length} empresa(s), papel ${meta.tenant_role}, ${meta.perms?.length ?? 0} permissões`
        : "inativo — sistema funciona, mas cada consulta faz um lookup a mais (opcional: ligar no painel)",
      null,
    );

    // Prova de ponta a ponta: com o token real, a RPC devolve o contexto?
    const contextResponse = await fetch(`${url}/rest/v1/rpc/my_context`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${body.access_token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const context = await contextResponse.json().catch(() => null);
    const ok = contextResponse.ok && context?.active_tenant_id;

    record(
      Boolean(ok),
      "Contexto da sessão (my_context)",
      ok
        ? `empresa ${context.tenants?.[0]?.name ?? "?"}, papel ${context.role}, ${context.permissions?.length ?? 0} permissões`
        : (context?.message ?? `HTTP ${contextResponse.status}`),
      "Rodar `npm run db:push` e conferir o log do servidor",
    );
  }
}

// 5. Empresa e dados ----------------------------------------------------------
// Sistema de empresa única: exatamente uma empresa é o estado correto.
if (projectUp && secret) {
  const head = { apikey: secret, Authorization: `Bearer ${secret}` };

  const [tenants, events, registrations] = await Promise.all(
    ["tenants?select=id", "events?select=id", "registrations?select=id&limit=1000"].map((path) =>
      fetch(`${url}/rest/v1/${path}`, { headers: head })
        .then((response) => response.json())
        .catch(() => []),
    ),
  );

  const tenantCount = Array.isArray(tenants) ? tenants.length : 0;
  record(
    tenantCount === 1,
    "Empresa configurada",
    tenantCount === 1
      ? "1 empresa (correto para sistema de empresa única)"
      : `${tenantCount} empresas — esperado exatamente 1`,
    "Rodar `npm run db:seed`",
  );

  const eventCount = Array.isArray(events) ? events.length : 0;
  record(
    true,
    "Dados de demonstração",
    `${eventCount} evento(s), ${Array.isArray(registrations) ? registrations.length : 0} inscrição(ões)`,
    null,
  );
}

report();

function report() {
  console.log("\n  Diagnóstico do ambiente\n  " + "─".repeat(60));
  for (const { ok, label, detail } of results) {
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(38)} ${detail ?? ""}`);
  }

  const failures = results.filter((r) => !r.ok && r.fix);
  if (failures.length) {
    console.log("\n  Ações necessárias\n  " + "─".repeat(60));
    failures.forEach(({ label, fix }, index) => console.log(`  ${index + 1}. ${label}\n     → ${fix}`));
    console.log("");
    process.exitCode = 1;
  } else {
    console.log("\n  Tudo certo.\n");
  }
}
