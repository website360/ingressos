import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  asUser,
  configureMeta,
  createTestEvent,
  getTestPool,
  resetWhatsappTables,
} from "../support/db";

const db = getTestPool();
let tenantId = "";
let eventA = "";
let eventB = "";

const MANAGE = ["settings.read", "settings.manage"];
const READ = ["settings.read"];

async function seed(eventId: string, status: string, n: number, extra = "") {
  await db.query(
    `insert into public.whatsapp_notifications
       (tenant_id, event_id, kind, phone_e164, dedupe_key, status ${extra ? ", " + extra.split("=")[0] : ""})
     select $1, $2, 'registration_confirmed', '+55119' || lpad((g + $5)::text, 8, '0'),
            'adm-' || $3 || '-' || $5 || '-' || g, $3::public.whatsapp_notification_status
            ${extra ? ", " + extra.split("=")[1] : ""}
       from generate_series(1, $4) g`,
    [tenantId, eventId, status, n, Math.floor(Math.random() * 1_000_000)],
  );
}

async function countBy(status: string, eventId?: string) {
  const { rows } = await db.query(
    `select count(*)::int as n from public.whatsapp_notifications
      where status = $1 and ($2::uuid is null or event_id = $2)`,
    [status, eventId ?? null],
  );
  return rows[0].n as number;
}

describe("ações e números do painel", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId: eventA } = await createTestEvent(db));
    ({ eventId: eventB } = await createTestEvent(db));
    await configureMeta(db, tenantId);
  });

  beforeEach(async () => {
    await db.query(`delete from public.whatsapp_notifications`);
    await db.query(
      `update public.whatsapp_connections set paused = false, paused_reason = null,
              breaker_open_until = null, breaker_manual = false where tenant_id = $1`,
      [tenantId],
    );
  });

  afterAll(async () => {
    await db.end();
  });

  it("sem settings.manage, as ações recusam com IG005", async () => {
    await expect(
      asUser(db, { tenantId, perms: READ }, (c) =>
        c.query(`select public.whatsapp_set_paused(true, 'teste')`),
      ),
    ).rejects.toMatchObject({ code: "IG005" });
    await expect(
      asUser(db, { tenantId, perms: READ }, (c) =>
        c.query(`select public.whatsapp_cancel_pending(null, null, null)`),
      ),
    ).rejects.toMatchObject({ code: "IG005" });
  });

  it("anônimo não executa nada", async () => {
    await expect(
      asUser(db, { role: "anon" }, (c) => c.query(`select public.whatsapp_queue_stats(null, null, null)`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("pausar e retomar; retomar também fecha o breaker", async () => {
    await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      await c.query(`select public.whatsapp_set_paused(true, 'manutenção')`);
      let { rows } = await c.query(
        `select paused, paused_reason from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      );
      expect(rows[0]).toEqual({ paused: true, paused_reason: "manutenção" });

      await c.query(
        `select public.whatsapp_set_paused(false, null)`,
      );
      ({ rows } = await c.query(
        `select paused, breaker_open_until, breaker_manual from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      ));
      expect(rows[0]).toEqual({ paused: false, breaker_open_until: null, breaker_manual: false });
    });
  });

  it("cancelar pendentes respeita o filtro de evento e não toca nas demais", async () => {
    await seed(eventA, "pendente", 3);
    await seed(eventB, "pendente", 2);
    await seed(eventA, "aceita", 1);
    const cancelled = await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      const { rows } = await c.query(`select public.whatsapp_cancel_pending($1, null, null) as n`, [
        eventA,
      ]);
      await c.query("commit");
      return rows[0].n;
    });
    expect(cancelled).toBe(3);
    expect(await countBy("cancelada", eventA)).toBe(3);
    expect(await countBy("pendente", eventB)).toBe(2);
    expect(await countBy("aceita", eventA)).toBe(1);
  });

  it("reenviar: falhas elegíveis voltam; erro definitivo de destinatário não", async () => {
    await seed(eventA, "falhou", 2, "last_error_code=500");
    await seed(eventA, "falhou", 1, "last_error_code=131026");
    await seed(eventA, "incerta", 1);
    const requeued = await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      const { rows } = await c.query(`select public.whatsapp_retry($1, null, null, false) as n`, [eventA]);
      await c.query("commit");
      return rows[0].n;
    });
    expect(requeued).toBe(2);
    expect(await countBy("pendente", eventA)).toBe(2);
    expect(await countBy("falhou", eventA)).toBe(1);
    expect(await countBy("incerta", eventA)).toBe(1);
  });

  it("reenviar incertas só quando pedido", async () => {
    await seed(eventA, "incerta", 2);
    const requeued = await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      const { rows } = await c.query(`select public.whatsapp_retry(null, null, null, true) as n`);
      await c.query("commit");
      return rows[0].n;
    });
    expect(requeued).toBe(2);
    const { rows } = await db.query(
      `select attempts, next_attempt_at <= now() as due from public.whatsapp_notifications where status = 'pendente'`,
    );
    expect(rows.every((r) => r.attempts === 0 && r.due)).toBe(true);
  });

  it("opt-out manual bloqueia as pendentes daquele número", async () => {
    await db.query(
      `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key)
       values ($1, $2, 'registration_confirmed', '+5511912345678', 'opt-1')`,
      [tenantId, eventA],
    );
    await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      await c.query(`select public.whatsapp_optout_set('(11) 91234-5678', true)`);
      await c.query("commit");
    });
    const { rows } = await db.query(
      `select status, block_reason from public.whatsapp_notifications where dedupe_key = 'opt-1'`,
    );
    expect(rows[0]).toEqual({ status: "bloqueada", block_reason: "optout" });
    await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      await c.query(`select public.whatsapp_optout_set('(11) 91234-5678', false)`);
      await c.query("commit");
    });
    const after = await db.query(`select count(*)::int as n from public.whatsapp_optouts`);
    expect(after.rows[0].n).toBe(0);
  });

  it("capacidade: grava valores válidos e recusa fora da faixa", async () => {
    await asUser(db, { tenantId, perms: MANAGE }, async (c) => {
      await c.query(`select public.whatsapp_update_capacity(80, 100000, 32)`);
      const { rows } = await c.query(
        `select rate_per_second, daily_unique_limit, worker_concurrency
           from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      );
      expect(rows[0]).toEqual({ rate_per_second: 80, daily_unique_limit: 100000, worker_concurrency: 32 });
    });
    await expect(
      asUser(db, { tenantId, perms: MANAGE }, (c) =>
        c.query(`select public.whatsapp_update_capacity(0, 100, 1)`),
      ),
    ).rejects.toThrow();
  });

  it("estatísticas batem com as linhas e respeitam o filtro", async () => {
    await seed(eventA, "pendente", 4);
    await seed(eventA, "falhou", 1);
    await seed(eventB, "pendente", 2);
    await db.query(
      `insert into public.whatsapp_notifications
         (tenant_id, event_id, kind, phone_e164, dedupe_key, status, accepted_at, sent_at, delivered_at)
       values ($1, $2, 'registration_confirmed', '+5511900000777', 'st-1', 'entregue', now(), now(), now())`,
      [tenantId, eventA],
    );
    await db.query(
      `update public.whatsapp_notifications set next_attempt_at = now() + interval '1 hour'
        where dedupe_key in (select dedupe_key from public.whatsapp_notifications
                              where event_id = $1 and status = 'pendente' limit 1)`,
      [eventA],
    );
    await db.query(`select public.whatsapp_heartbeat('w-stats', '{}')`);

    const stats = await asUser(db, { tenantId, perms: READ }, async (c) => {
      const { rows } = await c.query(`select public.whatsapp_queue_stats($1, null, null) as s`, [eventA]);
      return rows[0].s;
    });
    expect(stats.por_status).toMatchObject({ pendente: 4, falhou: 1, entregue: 1 });
    expect(stats).toMatchObject({
      em_fila: 3,
      agendadas: 1,
      tamanho_fila: 4,
      teto_diario: 1000,
      pausado: false,
      workers: 1,
    });
    expect(stats.marcos).toMatchObject({ aceitas: 1, enviadas: 1, entregues: 1, lidas: 0 });
    expect(stats.destinatarios_24h).toBe(1);
    expect(stats.taxa_1min).toBeCloseTo(1 / 60, 5);
    expect(stats.idade_mais_antiga_s).toBeGreaterThanOrEqual(0);
  });

  it("v_message_log mostra as notificações da Meta no histórico antigo", async () => {
    await db.query(
      `insert into public.whatsapp_notifications
         (tenant_id, event_id, kind, phone_e164, dedupe_key, status, accepted_at)
       values ($1, $2, 'registration_confirmed', '+5511900000888', 'log-1', 'aceita', now())`,
      [tenantId, eventA],
    );
    const { rows } = await db.query(
      `select channel, status, recipient, event_id from public.v_message_log where recipient = '+5511900000888'`,
    );
    expect(rows).toEqual([
      { channel: "whatsapp", status: "enviado", recipient: "+5511900000888", event_id: eventA },
    ]);
  });
});
