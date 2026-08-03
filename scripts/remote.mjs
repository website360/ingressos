#!/usr/bin/env node
/**
 * Operações contra um projeto Supabase na nuvem.
 *
 *   npm run db:push     aplica as migrations
 *   npm run db:seed     cria usuários e dados de demonstração (Admin API)
 *   npm run db:types    regenera database.types.ts a partir do schema remoto
 *
 * As credenciais são lidas do .env.local e NUNCA são impressas.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.local");

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    fatal("Arquivo .env.local não encontrado. Copie o .env.example e preencha as credenciais.");
  }

  const env = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function fatal(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function requireVar(env, key, hint) {
  const value = env[key];
  if (!value || value.startsWith("COLE_")) {
    fatal(`${key} não está preenchido no .env.local.\n  ${hint}`);
  }
  if (value.includes("[YOUR-PASSWORD]")) {
    fatal(
      `${key} ainda contém o marcador [YOUR-PASSWORD].\n` +
        "  Troque pela senha real do banco no .env.local (inclusive os colchetes).",
    );
  }
  return value;
}

function runSupabase(args, options = {}) {
  return execFileSync("npx", ["supabase", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

// ---------------------------------------------------------------------------
// db:push — aplica as migrations no banco remoto
// ---------------------------------------------------------------------------
function push(env) {
  const dbUrl = requireVar(
    env,
    "DATABASE_URL",
    "Pegue em: Supabase → Project Settings → Database → Connection string → aba 'Session pooler'\n" +
      "  (troque [YOUR-PASSWORD] pela senha do banco)",
  );

  console.log("\n▸ Aplicando migrations no banco remoto...\n");
  runSupabase(["db", "push", "--db-url", dbUrl, "--include-all", "--yes"]);
  console.log("\n✓ Migrations aplicadas.\n");
}

// ---------------------------------------------------------------------------
// db:types — regenera os tipos a partir do schema remoto
// ---------------------------------------------------------------------------
function types(env) {
  // O CLI roda o pg-meta em contêiner quando recebe --db-url, então exige Docker
  // mesmo para um banco remoto. Com um Personal Access Token ele usa a
  // Management API e dispensa Docker — é o caminho preferido aqui.
  const token = env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(
    /https:\/\/([a-z0-9]+)\.supabase\.co/,
  )?.[1];

  let args;
  if (token && projectRef) {
    process.env.SUPABASE_ACCESS_TOKEN = token;
    args = ["gen", "types", "typescript", "--project-id", projectRef];
  } else {
    console.log(
      "\n⚠ SUPABASE_ACCESS_TOKEN ausente — tentando via --db-url (requer Docker).\n" +
        "  Para dispensar o Docker, gere um token em\n" +
        "  https://supabase.com/dashboard/account/tokens e adicione ao .env.local:\n" +
        '    SUPABASE_ACCESS_TOKEN="sbp_..."\n',
    );
    args = [
      "gen",
      "types",
      "typescript",
      "--db-url",
      requireVar(env, "DATABASE_URL", "Necessário para ler o schema."),
    ];
  }

  console.log("▸ Gerando tipos a partir do schema remoto...");
  const output = runSupabase([...args, "--schema", "public,api,audit"], { capture: true });

  const target = resolve(process.cwd(), "src/lib/supabase/database.types.ts");
  const header = "/**\n * ARQUIVO GERADO — não editar à mão.\n *   npm run db:types\n */\n\n";

  writeFileSync(target, header + output, "utf8");
  console.log("✓ src/lib/supabase/database.types.ts atualizado.\n");
}

// ---------------------------------------------------------------------------
// db:seed — dados de demonstração via Admin API
//
// Na nuvem não inserimos em auth.users diretamente: usamos a Admin API, que
// dispara os mesmos triggers (criação de profile) e mantém o Auth consistente.
// ---------------------------------------------------------------------------
const TENANT_MAY = "11111111-1111-1111-1111-111111111111";
const TENANT_HORIZONTE = "22222222-2222-2222-2222-222222222222";
const DEFAULT_PASSWORD = "Ingressos@2026";

const SEED_USERS = [
  { email: "admin@agenciamay.com.br", name: "Caio Almeida", memberships: [[TENANT_MAY, "admin", true]] },
  { email: "organizador@agenciamay.com.br", name: "Renata Duarte", memberships: [[TENANT_MAY, "organizador", false]] },
  { email: "recepcao@agenciamay.com.br", name: "Paulo Ferreira", memberships: [[TENANT_MAY, "recepcao", false]] },
  { email: "suporte@agenciamay.com.br", name: "Bianca Rocha", memberships: [[TENANT_MAY, "suporte", false]] },
  { email: "admin@horizonte.org.br", name: "Marcos Vieira", memberships: [[TENANT_HORIZONTE, "admin", true]] },
  {
    email: "multi@agenciamay.com.br",
    name: "Helena Souza",
    memberships: [
      [TENANT_MAY, "organizador", false],
      [TENANT_HORIZONTE, "suporte", false],
    ],
  },
];

async function seed(env) {
  const url = requireVar(env, "NEXT_PUBLIC_SUPABASE_URL", "Project Settings → API → Project URL");
  const serviceKey = requireVar(
    env,
    "SUPABASE_SERVICE_ROLE_KEY",
    "Project Settings → API → service_role (secret)",
  );

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("\n▸ Criando empresas...");
  const { error: tenantError } = await admin.from("tenants").upsert(
    [
      {
        id: TENANT_MAY,
        name: "Agência May Eventos",
        slug: "agencia-may",
        document: "12345678000190",
        brand_color: "#2563eb",
        status: "ativo",
        plan: "pro",
      },
      {
        id: TENANT_HORIZONTE,
        name: "Instituto Horizonte",
        slug: "horizonte",
        document: "98765432000110",
        brand_color: "#7c3aed",
        status: "ativo",
        plan: "trial",
      },
    ],
    { onConflict: "id" },
  );
  if (tenantError) fatal(`Falha ao criar empresas: ${tenantError.message}`);

  console.log("▸ Criando usuários...");
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const byEmail = new Map((existing?.users ?? []).map((user) => [user.email, user.id]));

  const memberships = [];

  for (const user of SEED_USERS) {
    let userId = byEmail.get(user.email);

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: user.name },
      });
      if (error) fatal(`Falha ao criar ${user.email}: ${error.message}`);
      userId = data.user.id;
      console.log(`  + ${user.email}`);
    } else {
      console.log(`  = ${user.email} (já existia)`);
    }

    await admin.from("profiles").update({ full_name: user.name }).eq("id", userId);

    for (const [tenantId, role, isOwner] of user.memberships) {
      memberships.push({
        tenant_id: tenantId,
        user_id: userId,
        role,
        status: "ativo",
        is_owner: isOwner,
        accepted_at: new Date().toISOString(),
      });
    }

    const firstTenant = user.memberships[0][0];
    await admin.from("profiles").update({ active_tenant_id: firstTenant }).eq("id", userId);
  }

  console.log("▸ Criando vínculos...");
  const { error: membershipError } = await admin
    .from("memberships")
    .upsert(memberships, { onConflict: "tenant_id,user_id" });
  if (membershipError) fatal(`Falha ao criar vínculos: ${membershipError.message}`);

  console.log("▸ Configurações padrão...");
  await admin.from("tenant_settings").upsert(
    [
      { tenant_id: TENANT_MAY, key: "lgpd.retention_months", value: 24 },
      { tenant_id: TENANT_MAY, key: "auth.require_mfa_admin", value: false },
      { tenant_id: TENANT_MAY, key: "checkin.default_radius_m", value: 300 },
      { tenant_id: TENANT_HORIZONTE, key: "lgpd.retention_months", value: 12 },
    ],
    { onConflict: "tenant_id,key" },
  );

  console.log(`\n✓ Seed concluído. Login: admin@agenciamay.com.br / ${DEFAULT_PASSWORD}\n`);
}

// ---------------------------------------------------------------------------
const command = process.argv[2];
const env = loadEnv();

switch (command) {
  case "push":
    push(env);
    break;
  case "types":
    types(env);
    break;
  case "seed":
    await seed(env);
    break;
  default:
    fatal("Uso: node scripts/remote.mjs <push|seed|types>");
}
