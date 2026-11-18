import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asUser,
  createTestEvent,
  getTestPool,
  resetWhatsappTables,
  reapplyAll,
  rollbackAll,
} from "../support/db";


const db = getTestPool();
let tenantId = "";
let eventId = "";

async function insertNotification(dedupe: string) {
  return db.query(
    `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key)
     values ($1, $2, 'registration_confirmed', '+5511987654321', $3) returning id`,
    [tenantId, eventId, dedupe],
  );
}

describe("esquema do WhatsApp em escala", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId } = await createTestEvent(db));
  });

  afterAll(async () => {
    await db.end();
  });

  it("recusa a segunda notificação com a mesma dedupe_key", async () => {
    await insertNotification("dup-1");
    await expect(insertNotification("dup-1")).rejects.toThrow(/duplicate key/);
  });

  it("nasce pendente, com 5 tentativas e vencida agora", async () => {
    const { rows } = await db.query(
      `select status, attempts, max_attempts, next_attempt_at <= now() as due
         from public.whatsapp_notifications where dedupe_key = 'dup-1'`,
    );
    expect(rows[0]).toMatchObject({ status: "pendente", attempts: 0, max_attempts: 5, due: true });
  });

  it("recusa telefone fora do E.164", async () => {
    await expect(
      db.query(
        `insert into public.whatsapp_notifications (tenant_id, kind, phone_e164, dedupe_key)
         values ($1, 'registration_confirmed', '11987654321', 'e164-ruim')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("autenticado sem settings.read não enxerga notificações", async () => {
    const count = await asUser(db, { tenantId, perms: [] }, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.whatsapp_notifications`);
      return rows[0].n;
    });
    expect(count).toBe(0);
  });

  it("autenticado com settings.read enxerga as da própria empresa", async () => {
    const count = await asUser(db, { tenantId, perms: ["settings.read"] }, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.whatsapp_notifications`);
      return rows[0].n;
    });
    expect(count).toBeGreaterThan(0);
  });

  it("autenticado não grava direto na fila", async () => {
    await expect(
      asUser(db, { tenantId, perms: ["settings.manage", "settings.read"] }, (c) =>
        c.query(`update public.whatsapp_notifications set status = 'cancelada'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("anônimo não lê nada", async () => {
    await expect(
      asUser(db, { role: "anon" }, (c) => c.query(`select 1 from public.whatsapp_notifications`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("eventos crus do webhook não são legíveis pelo painel", async () => {
    await expect(
      asUser(db, { tenantId, perms: ["settings.read"] }, (c) =>
        c.query(`select 1 from public.whatsapp_webhook_events`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("a conexão ganha os controles de capacidade com padrões conservadores", async () => {
    const { rows } = await db.query(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'whatsapp_connections'
          and column_name in ('rate_per_second', 'daily_unique_limit', 'worker_concurrency', 'paused')`,
    );
    const defaults = Object.fromEntries(rows.map((r) => [r.column_name, r.column_default]));
    expect(defaults).toEqual({
      rate_per_second: "20",
      daily_unique_limit: "1000",
      worker_concurrency: "16",
      paused: "false",
    });
  });

  it("as reversões desfazem tudo e as migrations reaplicam sem erro", async () => {
    await rollbackAll(db);
    const gone = await db.query(`select to_regclass('public.whatsapp_notifications') as t`);
    expect(gone.rows[0].t).toBeNull();
    await reapplyAll(db);
    const back = await db.query(`select to_regclass('public.whatsapp_notifications') as t`);
    expect(back.rows[0].t).toBe("whatsapp_notifications");
  });
  // Depois da reaplicação: a migration semeia as empresas que já existem.
  it("semeia os modelos: v1 ativa e a v2 de confirmação em rascunho", async () => {
    const { rows } = await db.query(
      `select key, name, version, active, meta_status
         from public.whatsapp_templates where tenant_id = $1 order by key, version`,
      [tenantId],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "registration_confirmed", version: 1, active: true }),
        expect.objectContaining({
          key: "registration_confirmed",
          name: "confirmacao_inscricao",
          version: 2,
          active: false,
          meta_status: "rascunho",
        }),
        expect.objectContaining({ key: "registration_cancelled", version: 1, active: true }),
        expect.objectContaining({ key: "ticket_code", version: 1, active: true }),
      ]),
    );
  });

});
