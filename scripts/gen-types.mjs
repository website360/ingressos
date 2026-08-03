#!/usr/bin/env node
/**
 * Gera src/lib/supabase/database.types.ts por introspecção do banco.
 *
 * O `supabase gen types` roda o pg-meta em contêiner e exige Docker mesmo para
 * um banco remoto. Este gerador usa a conexão que já temos.
 *
 *   npm run db:types
 */
import pg from "pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "src/lib/supabase/database.types.ts");

/** Assinaturas das RPCs expostas. Mantidas à mão: são poucas e são contrato. */
const FUNCTIONS = {
  my_context: { args: "Record<string, never>", returns: "Json" },
  switch_tenant: { args: "{ p_tenant_id: string }", returns: "Json" },
  accept_invitation: { args: "{ p_token: string }", returns: "Json" },
  log_auth_event: {
    args: "{ p_event_type: string; p_success?: boolean; p_email?: string | null; p_metadata?: Json }",
    returns: "undefined",
  },
  create_registration: {
    args: "{ p_event_id: string; p_attendee: Json; p_consents?: Json; p_context?: Json }",
    returns: "Json",
  },
  cancel_registration: {
    args: "{ p_registration_id: string; p_reason_code?: string | null; p_reason_text?: string | null; p_context?: Json }",
    returns: "Json",
  },
  checkin: { args: "{ p_token: string; p_context?: Json }", returns: "Json" },
  get_ticket: { args: "{ p_token: string }", returns: "Json" },
  dashboard_kpis: { args: "{ p_from?: string | null; p_to?: string | null }", returns: "Json" },
  search_attendees: { args: "{ p_event_id: string; p_term: string }", returns: "Json" },
  checkin_batch: { args: "{ p_items: Json }", returns: "Json" },
  checkin_manifest: { args: "{ p_event_id: string }", returns: "Json" },
  // Worker da fila — EXECUTE apenas para service_role (ver 20260801092000).
  claim_outbox_jobs: { args: "{ p_limit?: number; p_worker?: string }", returns: "Json" },
  complete_outbox_job: {
    args: "{ p_id: string; p_success: boolean; p_error?: string | null }",
    returns: "undefined",
  },
  requeue_stale_outbox_jobs: { args: "{ p_older_than?: string }", returns: "number" },
};

function loadDatabaseUrl() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error(".env.local não encontrado.");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

const SCALARS = {
  uuid: "string",
  text: "string",
  citext: "string",
  varchar: "string",
  bpchar: "string",
  name: "string",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  bool: "boolean",
  timestamptz: "string",
  timestamp: "string",
  date: "string",
  time: "string",
  interval: "string",
  json: "Json",
  jsonb: "Json",
  bytea: "string",
  inet: "string",
};

function tsType(udt, enums) {
  if (udt.startsWith("_")) return `${tsType(udt.slice(1), enums)}[]`;
  if (enums[udt]) return pascal(udt);
  return SCALARS[udt] ?? "unknown";
}

function pascal(name) {
  return name.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());
}

const client = new pg.Client({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();

// Enums -----------------------------------------------------------------------
const { rows: enumRows } = await client.query(`
  -- O cast para text é necessário: array do tipo "name" nao e parseado pelo driver.
  select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public','audit')
   group by t.typname
`);
const enums = Object.fromEntries(enumRows.map((r) => [r.typname, r.labels]));

// Colunas ---------------------------------------------------------------------
const { rows: cols } = await client.query(`
  select c.relname as table_name,
         c.relkind as kind,
         a.attname as column_name,
         t.typname as udt,
         not a.attnotnull as nullable,
         (a.atthasdef or a.attidentity <> '') as has_default,
         a.attnum
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
   where n.nspname = 'public'
     and c.relkind in ('r','v')
     and a.attnum > 0
     and not a.attisdropped
     and not c.relispartition
     and c.relname <> 'spatial_ref_sys'
     and c.relname not in ('geography_columns','geometry_columns')
   order by c.relname, a.attnum
`);

const tables = new Map();
for (const col of cols) {
  if (!tables.has(col.table_name)) tables.set(col.table_name, { kind: col.kind, columns: [] });
  tables.get(col.table_name).columns.push(col);
}

// Emissão ---------------------------------------------------------------------
const lines = [
  "/**",
  " * ARQUIVO GERADO — não editar à mão.",
  " *   npm run db:types",
  " *",
  " * Gerado por introspecção do schema real (scripts/gen-types.mjs).",
  " * Linhas são `type`, não `interface`: o supabase-js exige que cada tabela",
  " * satisfaça Record<string, unknown>, e só type aliases ganham index",
  " * signature implícita.",
  " */",
  "",
  "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
  "",
];

for (const [name, labels] of Object.entries(enums)) {
  lines.push(`export type ${pascal(name)} = ${labels.map((l) => `"${l}"`).join(" | ")};`);
}
lines.push("");

for (const [table, { columns }] of tables) {
  lines.push(`type ${pascal(table)}Row = {`);
  for (const c of columns) {
    lines.push(`  ${c.column_name}: ${tsType(c.udt, enums)}${c.nullable ? " | null" : ""};`);
  }
  lines.push("};");
  lines.push("");
}

lines.push("type Insertable<T, Optional extends keyof T> = Omit<T, Optional> & Partial<Pick<T, Optional>>;");
lines.push("");
lines.push("export type Database = {");
lines.push("  public: {");
lines.push("    Tables: {");

for (const [table, { kind, columns }] of tables) {
  if (kind !== "r") continue;
  const optional = columns
    .filter((c) => c.has_default || c.nullable)
    .map((c) => `"${c.column_name}"`);
  const row = `${pascal(table)}Row`;
  lines.push(`      ${table}: {`);
  lines.push(`        Row: ${row};`);
  lines.push(
    optional.length
      ? `        Insert: Insertable<${row}, ${optional.join(" | ")}>;`
      : `        Insert: ${row};`,
  );
  lines.push(`        Update: Partial<${row}>;`);
  lines.push(`        Relationships: [];`);
  lines.push(`      };`);
}

lines.push("    };");
lines.push("    Views: {");
for (const [table, { kind }] of tables) {
  if (kind !== "v") continue;
  lines.push(`      ${table}: { Row: ${pascal(table)}Row; Relationships: [] };`);
}
lines.push("    };");
lines.push("    Functions: {");
for (const [name, fn] of Object.entries(FUNCTIONS)) {
  lines.push(`      ${name}: { Args: ${fn.args}; Returns: ${fn.returns} };`);
}
lines.push("    };");
lines.push("    Enums: {");
for (const name of Object.keys(enums)) {
  lines.push(`      ${name}: ${pascal(name)};`);
}
lines.push("    };");
lines.push("    CompositeTypes: Record<string, never>;");
lines.push("  };");
lines.push("};");
lines.push("");
lines.push(`export type Tables<T extends keyof Database["public"]["Tables"]> =`);
lines.push(`  Database["public"]["Tables"][T]["Row"];`);
lines.push(`export type TablesInsert<T extends keyof Database["public"]["Tables"]> =`);
lines.push(`  Database["public"]["Tables"][T]["Insert"];`);
lines.push(`export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =`);
lines.push(`  Database["public"]["Tables"][T]["Update"];`);
lines.push(`export type Views<T extends keyof Database["public"]["Views"]> =`);
lines.push(`  Database["public"]["Views"][T]["Row"];`);
lines.push("");

writeFileSync(OUT, lines.join("\n"), "utf8");
await client.end();

const tableCount = [...tables.values()].filter((t) => t.kind === "r").length;
const viewCount = [...tables.values()].filter((t) => t.kind === "v").length;
console.log(
  `\n✓ database.types.ts gerado — ${tableCount} tabelas, ${viewCount} views, ${Object.keys(enums).length} enums\n`,
);
