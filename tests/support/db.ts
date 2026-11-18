import pg from "pg";

/**
 * Banco dos testes de integração — SEMPRE o Supabase local.
 *
 * O `.env.local` deste projeto aponta para o banco de PRODUÇÃO. Por isso o
 * teste não lê `DATABASE_URL`: lê `TEST_DATABASE_URL` e recusa qualquer host
 * que não seja a própria máquina.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function assertLocalDatabaseUrl(url: string | undefined): string {
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  if (!url || !LOCAL_HOSTS.has(host)) {
    throw new Error("TEST_DATABASE_URL precisa apontar para localhost");
  }
  return url;
}

let pool: pg.Pool | null = null;

export function getTestPool(): pg.Pool {
  if (!pool) {
    const created = new pg.Pool({
      connectionString: assertLocalDatabaseUrl(process.env.TEST_DATABASE_URL),
      max: 10,
    });
    const end = created.end.bind(created);
    created.end = (async () => {
      pool = null;
      await end();
    }) as typeof created.end;
    pool = created;
  }
  return pool;
}

export function testDatabaseUrl(): string {
  return assertLocalDatabaseUrl(process.env.TEST_DATABASE_URL);
}

/** Apaga o que os testes criam. A empresa (única) fica. */
export async function resetWhatsappTables(db: pg.Pool): Promise<void> {
  const { rows } = await db.query<{ name: string }>(
    `select table_name as name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [
      [
        "whatsapp_notifications",
        "whatsapp_webhook_events",
        "whatsapp_optouts",
        "whatsapp_rate_buckets",
        "whatsapp_worker_heartbeats",
      ],
    ],
  );
  const tables = rows.map((r) => `public.${r.name}`);
  if (tables.length) await db.query(`truncate ${tables.join(", ")} cascade`);
  for (const table of [
    "outbox_jobs",
    "whatsapp_messages",
    "email_messages",
    "consents",
    "checkins",
    "cancellations",
    "tickets",
    "registrations",
    "attendees",
    "events",
  ]) {
    await db.query(`delete from public.${table}`);
  }
}

export const TEST_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** A empresa é única (uq_single_company): cria uma vez e reaproveita. */
export async function ensureTenant(db: pg.Pool): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`select id from public.tenants limit 1`);
  if (rows[0]) return rows[0].id;
  // `seed_tenant_permissions` ainda tenta dar `waitlist.manage`, que a migration
  // simplify tirou do catálogo — criar empresa nova quebra (bug antigo, fora
  // deste trabalho; produção já tem a sua). No banco local os gatilhos ficam
  // desligados só neste INSERT; os testes usam as permissões do JWT.
  const client = await db.connect();
  try {
    await client.query(`set session_replication_role = replica`);
    await client.query(
      `insert into public.tenants (id, name, slug, status)
       values ($1, 'Empresa Teste', 'empresa-teste', 'ativo')`,
      [TEST_TENANT_ID],
    );
  } finally {
    await client.query(`set session_replication_role = origin`);
    client.release();
  }
  return TEST_TENANT_ID;
}

let eventCounter = 0;

export async function createTestEvent(
  db: pg.Pool,
  opts: { capacity?: number; name?: string } = {},
): Promise<{ tenantId: string; eventId: string }> {
  const tenantId = await ensureTenant(db);
  eventCounter += 1;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.events
       (tenant_id, name, slug, starts_at, ends_at, capacity, status, venue_name, city)
     values ($1, $2, $3, now() + interval '30 days', now() + interval '30 days 4 hours',
             $4, 'publicado', 'Auditório Central', 'São Paulo')
     returning id`,
    [
      tenantId,
      opts.name ?? `Evento de Teste ${eventCounter}`,
      `evento-teste-${Date.now().toString(36)}-${eventCounter}`,
      opts.capacity ?? 200_000,
    ],
  );
  return { tenantId, eventId: rows[0].id };
}

/** Configura a empresa com o provedor Meta (credenciais falsas). */
export async function configureMeta(
  db: pg.Pool,
  tenantId: string,
  metaBaseUrl = "http://127.0.0.1:9/v23.0",
): Promise<void> {
  await db.query(
    `insert into public.whatsapp_connections
       (tenant_id, provider, base_url, api_key, api_key_hint, state,
        meta_phone_number_id, meta_waba_id, meta_app_secret, meta_verify_token)
     values ($1, 'meta', $2, 'token-de-teste-123', 'toke…123', 'conectado',
             '1234567890', '9876543210', 'segredo-do-app', 'verifica')
     on conflict (tenant_id) do update
       set provider = 'meta', base_url = excluded.base_url, api_key = excluded.api_key,
           state = 'conectado', meta_phone_number_id = excluded.meta_phone_number_id,
           meta_waba_id = excluded.meta_waba_id, meta_app_secret = excluded.meta_app_secret,
           meta_verify_token = excluded.meta_verify_token`,
    [tenantId, metaBaseUrl],
  );
}

/** Configura a empresa com o provedor Evolution (comportamento antigo). */
export async function configureEvolution(db: pg.Pool, tenantId: string): Promise<void> {
  await db.query(
    `insert into public.whatsapp_connections
       (tenant_id, provider, base_url, api_key, api_key_hint, state, instance_name)
     values ($1, 'evolution', 'http://127.0.0.1:9', 'chave-evolution-123', 'chav…123',
             'conectado', 'instancia')
     on conflict (tenant_id) do update
       set provider = 'evolution', meta_phone_number_id = null, state = 'conectado',
           instance_name = 'instancia'`,
    [tenantId],
  );
}

let cpfCounter = 0;

/** CPF sintético: 11 dígitos únicos (o banco só exige o formato). */
export function syntheticCpf(): string {
  cpfCounter += 1;
  return String(10_000_000_000 + ((process.pid % 1000) * 1_000_000 + cpfCounter)).slice(-11);
}

export async function register(
  db: pg.Pool | pg.PoolClient,
  eventId: string,
  opts: { phone?: string | null; whatsappConsent?: boolean; cpf?: string; name?: string } = {},
): Promise<{ registrationId: string; token: string }> {
  const phone = opts.phone === undefined ? "(11) 98765-4321" : opts.phone;
  const consents: Record<string, unknown>[] = [
    { type: "lgpd", version: 1, accepted: true },
    { type: "regulamento", version: 1, accepted: true },
  ];
  if (opts.whatsappConsent !== undefined) {
    consents.push({ type: "whatsapp", version: 1, accepted: opts.whatsappConsent, subject: phone });
  }
  const { rows } = await db.query<{ r: { registration_id: string; token: string } }>(
    `select public.create_registration($1, $2::jsonb, $3::jsonb, $4::jsonb) as r`,
    [
      eventId,
      JSON.stringify({
        first_name: opts.name ?? "Maria",
        last_name: "Teste",
        cpf: opts.cpf ?? syntheticCpf(),
        email: "maria@example.com",
        phone,
        city: "São Paulo",
        state: "SP",
      }),
      JSON.stringify(consents),
      JSON.stringify({ source: "teste", ip: "127.0.0.1", user_agent: "vitest" }),
    ],
  );
  return { registrationId: rows[0].r.registration_id, token: rows[0].r.token };
}

/**
 * Roda `fn` como um usuário autenticado (papel `authenticated` + claims do JWT),
 * dentro de uma transação que é desfeita no fim. É assim que a RLS é testada.
 */
export async function asUser<T>(
  db: pg.Pool,
  claims: { tenantId?: string; perms?: string[]; role?: "authenticated" | "anon" },
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const role = claims.role ?? "authenticated";
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: "00000000-0000-0000-0000-0000000000aa",
        role,
        app_metadata: { active_tenant: claims.tenantId ?? "", perms: claims.perms ?? [] },
      }),
    ]);
    await client.query(`select set_config('role', $1, true)`, [role]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Executa um arquivo .sql inteiro (migration ou reversão). */
export async function runSqlFile(db: pg.Pool, path: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  await db.query(readFileSync(path, "utf8"));
}

/**
 * As migrations deste trabalho que têm reversão, em ordem de aplicação.
 * Reverter é na ordem inversa — as posteriores dependem das anteriores.
 */
export async function reversibleMigrations(): Promise<{ up: string; down: string }[]> {
  const { readdirSync, existsSync } = await import("node:fs");
  return readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      up: `supabase/migrations/${f}`,
      down: `supabase/rollbacks/${f.replace(/\.sql$/, ".down.sql")}`,
    }))
    .filter((m) => existsSync(m.down));
}

export async function rollbackAll(db: pg.Pool): Promise<void> {
  for (const m of (await reversibleMigrations()).reverse()) await runSqlFile(db, m.down);
}

export async function reapplyAll(db: pg.Pool): Promise<void> {
  for (const m of await reversibleMigrations()) await runSqlFile(db, m.up);
}
