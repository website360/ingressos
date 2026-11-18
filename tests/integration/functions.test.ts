import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { E164_CASES } from "../support/e164-cases";
import { configureMeta, createTestEvent, getTestPool, resetWhatsappTables } from "../support/db";

const db = getTestPool();
let tenantId = "";
let eventId = "";

async function seedPending(n: number, prefix = "fn") {
  await db.query(
    `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key)
     select $1, $2, 'registration_confirmed', '+55119' || lpad(g::text, 8, '0'), $3 || '-' || g
       from generate_series(1, $4) g`,
    [tenantId, eventId, prefix, n],
  );
}

async function status(id: string) {
  const { rows } = await db.query(`select * from public.whatsapp_notifications where id = $1`, [id]);
  return rows[0];
}

async function claim(limit: number, worker = "w1") {
  const { rows } = await db.query(
    `select * from public.claim_whatsapp_notifications($1, $2, $3)`,
    [tenantId, limit, worker],
  );
  return rows as { id: string }[];
}

async function claimOne(worker = "w1") {
  const [row] = await claim(1, worker);
  if (!row) throw new Error("nada para reivindicar");
  return row;
}

async function record(
  id: string,
  outcome: string,
  extra: { wamid?: string; code?: number; error?: string; retryAt?: Date; count?: boolean } = {},
) {
  await db.query(`select public.record_whatsapp_result($1, $2, $3, $4, $5, $6, $7)`, [
    id,
    outcome,
    extra.wamid ?? null,
    extra.code ?? null,
    extra.error ?? null,
    extra.retryAt ?? null,
    extra.count ?? true,
  ]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("funções do worker", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId } = await createTestEvent(db));
    await configureMeta(db, tenantId);
  });

  beforeEach(async () => {
    await db.query(`delete from public.whatsapp_notifications`);
    await db.query(`delete from public.whatsapp_rate_buckets`);
    await db.query(
      `update public.whatsapp_connections
          set rate_per_second = 10, paused = false, breaker_open_until = null where tenant_id = $1`,
      [tenantId],
    );
  });

  afterAll(async () => {
    await db.end();
  });

  describe("to_e164_br concorda com a versão TypeScript", () => {
    it.each(E164_CASES)("%s → %s", async (input, expected) => {
      const { rows } = await db.query(`select private.to_e164_br($1) as v`, [input]);
      expect(rows[0].v).toBe(expected);
    });
  });

  describe("limitador global", () => {
    it("concede no máximo a capacidade (1 s de vazão) de uma vez", async () => {
      const { rows } = await db.query(`select public.whatsapp_take_tokens($1, 50) as n`, [tenantId]);
      expect(rows[0].n).toBe(10);
    });

    it("repõe com o tempo, na taxa configurada", async () => {
      await db.query(`select public.whatsapp_take_tokens($1, 50)`, [tenantId]);
      await sleep(1000);
      const { rows } = await db.query(`select public.whatsapp_take_tokens($1, 50) as n`, [tenantId]);
      expect(rows[0].n).toBeGreaterThanOrEqual(9);
      expect(rows[0].n).toBeLessThanOrEqual(10);
    });

    it("duas conexões disputando por 2 s não passam de taxa × 2 + capacidade", async () => {
      const until = Date.now() + 2000;
      const worker = async () => {
        let total = 0;
        while (Date.now() < until) {
          const { rows } = await db.query(`select public.whatsapp_take_tokens($1, 7) as n`, [
            tenantId,
          ]);
          total += rows[0].n;
          await sleep(20);
        }
        return total;
      };
      const [a, b] = await Promise.all([worker(), worker()]);
      expect(a + b).toBeLessThanOrEqual(30);
      expect(a + b).toBeGreaterThanOrEqual(25);
    });

    it("o freio da Meta (429) reduz a vazão efetiva", async () => {
      await db.query(`select public.whatsapp_take_tokens($1, 50)`, [tenantId]);
      await db.query(`select public.whatsapp_throttle($1, 0.5, 60)`, [tenantId]);
      await sleep(1000);
      const { rows } = await db.query(`select public.whatsapp_take_tokens($1, 50) as n`, [tenantId]);
      expect(rows[0].n).toBeLessThanOrEqual(5);
    });
  });

  describe("claim", () => {
    it("duas conexões pegando 50 de 100 nunca repetem notificação", async () => {
      await seedPending(100);
      const [a, b] = await Promise.all([claim(50, "w1"), claim(50, "w2")]);
      const ids = [...a, ...b].map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(100);
    });

    it("não pega retry agendado para o futuro", async () => {
      await seedPending(2);
      await db.query(
        `update public.whatsapp_notifications set next_attempt_at = now() + interval '1 hour'
          where dedupe_key = 'fn-1'`,
      );
      const got = await claim(10);
      expect(got).toHaveLength(1);
    });

    it("marca processando, com a trava do worker", async () => {
      await seedPending(1);
      const row = await claimOne("w9");
      const after = await status(row.id);
      expect(after).toMatchObject({ status: "processando", locked_by: "w9", request_started_at: null });
    });
  });

  describe("record_whatsapp_result", () => {
    it("aceita grava o wamid e a hora, e conta a tentativa", async () => {
      await seedPending(1);
      const row = await claimOne();
      await record(row.id, "aceita", { wamid: "wamid.A" });
      expect(await status(row.id)).toMatchObject({
        status: "aceita",
        meta_message_id: "wamid.A",
        attempts: 1,
        locked_at: null,
      });
      expect((await status(row.id)).accepted_at).not.toBeNull();
    });

    it("retry reagenda e, esgotadas as tentativas, vira falhou", async () => {
      await seedPending(1);
      await db.query(`update public.whatsapp_notifications set max_attempts = 2`);
      let row = await claimOne();
      await record(row.id, "retry", { code: 500, error: "x", retryAt: new Date() });
      expect(await status(row.id)).toMatchObject({ status: "pendente", attempts: 1 });
      row = await claimOne();
      await record(row.id, "retry", { code: 500, error: "x", retryAt: new Date() });
      const final = await status(row.id);
      expect(final).toMatchObject({ status: "falhou", attempts: 2, last_error_code: 500 });
      expect(final.failed_at).not.toBeNull();
    });

    it("retry sem contar tentativa (freio da Meta) não esgota", async () => {
      await seedPending(1);
      await db.query(`update public.whatsapp_notifications set max_attempts = 1`);
      const row = await claimOne();
      await record(row.id, "retry", { code: 130429, retryAt: new Date(), count: false });
      expect(await status(row.id)).toMatchObject({ status: "pendente", attempts: 0 });
    });

    it("devolver volta para a fila sem gastar tentativa", async () => {
      await seedPending(1);
      const row = await claimOne();
      await record(row.id, "devolver");
      expect(await status(row.id)).toMatchObject({ status: "pendente", attempts: 0, locked_by: null });
    });

    it("incerta fica parada, sem reenvio", async () => {
      await seedPending(1);
      const row = await claimOne();
      await record(row.id, "incerta", { error: "timeout depois de enviado" });
      expect(await status(row.id)).toMatchObject({ status: "incerta", attempts: 1 });
      expect(await claim(10)).toHaveLength(0);
    });

    it("aceita tardia numa incerta (reconciliação chegou antes): vira aceita", async () => {
      await seedPending(1);
      const row = await claimOne();
      await db.query(`update public.whatsapp_notifications set status = 'incerta' where id = $1`, [row.id]);
      await record(row.id, "aceita", { wamid: "wamid.TARDIA" });
      expect(await status(row.id)).toMatchObject({ status: "aceita", meta_message_id: "wamid.TARDIA" });
    });

    it("não rebaixa o que o webhook já avançou, mas guarda o wamid", async () => {
      await seedPending(1);
      const row = await claimOne();
      // O webhook chegou primeiro (casou pelo biz_opaque_callback_data).
      await db.query(
        `update public.whatsapp_notifications set status = 'entregue', delivered_at = now() where id = $1`,
        [row.id],
      );
      await record(row.id, "aceita", { wamid: "wamid.TARDE" });
      expect(await status(row.id)).toMatchObject({
        status: "entregue",
        meta_message_id: "wamid.TARDE",
      });
    });
  });

  describe("reconciliação", () => {
    it("travada sem requisição volta para a fila; com requisição vira incerta", async () => {
      await seedPending(2);
      const [a, b] = (await claim(2)) as [{ id: string }, { id: string }];
      await db.query(`select public.mark_whatsapp_request_started($1)`, [[b.id]]);
      await db.query(
        `update public.whatsapp_notifications
            set locked_at = now() - interval '5 minutes',
                request_started_at = case when request_started_at is null then null
                                          else now() - interval '5 minutes' end`,
      );
      const { rows } = await db.query(`select public.reconcile_whatsapp('2 minutes') as r`);
      expect(rows[0].r).toMatchObject({ requeued: 1, uncertain: 1 });
      expect((await status(a.id)).status).toBe("pendente");
      expect((await status(b.id)).status).toBe("incerta");
    });

    it("não mexe em travas recentes", async () => {
      await seedPending(1);
      await claim(1);
      const { rows } = await db.query(`select public.reconcile_whatsapp('2 minutes') as r`);
      expect(rows[0].r).toMatchObject({ requeued: 0, uncertain: 0 });
    });
  });

  describe("teto diário, batimento e breaker", () => {
    it("conta destinatários únicos aceitos nas últimas 24 h", async () => {
      await seedPending(3);
      await db.query(
        `update public.whatsapp_notifications
            set status = 'aceita', accepted_at = now(),
                phone_e164 = case when dedupe_key = 'fn-3' then '+5511900000001' else phone_e164 end`,
      );
      await db.query(
        `insert into public.whatsapp_notifications (tenant_id, kind, phone_e164, dedupe_key, status, accepted_at)
         values ($1, 'registration_confirmed', '+5511900000099', 'velha', 'aceita', now() - interval '25 hours')`,
        [tenantId],
      );
      const { rows } = await db.query(`select public.whatsapp_unique_recipients_24h($1) as n`, [
        tenantId,
      ]);
      expect(rows[0].n).toBe(2);
    });

    it("batimento faz upsert por worker", async () => {
      await db.query(`select public.whatsapp_heartbeat('w1', '{"sent": 1}')`);
      await db.query(`select public.whatsapp_heartbeat('w1', '{"sent": 2}')`);
      const { rows } = await db.query(
        `select stats from public.whatsapp_worker_heartbeats where worker_id = 'w1'`,
      );
      expect(rows).toEqual([{ stats: { sent: 2 } }]);
    });

    it("breaker manual pausa a empresa; o automático só fecha a janela", async () => {
      await db.query(`select public.whatsapp_open_breaker($1, now() + interval '5 minutes', 'erro alto', false)`, [
        tenantId,
      ]);
      let { rows } = await db.query(
        `select paused, breaker_open_until > now() as open from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      );
      expect(rows[0]).toEqual({ paused: false, open: true });

      await db.query(`select public.whatsapp_open_breaker($1, null, 'token inválido', true)`, [tenantId]);
      ({ rows } = await db.query(
        `select paused, paused_reason, breaker_manual from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      ));
      expect(rows[0]).toEqual({ paused: true, paused_reason: "token inválido", breaker_manual: true });
    });

    it("claim não entrega nada com a empresa pausada ou com o breaker aberto", async () => {
      await seedPending(3);
      await db.query(`update public.whatsapp_connections set paused = true where tenant_id = $1`, [tenantId]);
      expect(await claim(10)).toHaveLength(0);
      await db.query(
        `update public.whatsapp_connections set paused = false, breaker_open_until = now() + interval '1 minute'
          where tenant_id = $1`,
        [tenantId],
      );
      expect(await claim(10)).toHaveLength(0);
    });
  });

  describe("superfície fechada", () => {
    it("authenticated não executa as funções do worker", async () => {
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query(`set local role authenticated`);
        await expect(
          client.query(`select public.whatsapp_take_tokens($1, 1)`, [tenantId]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });
});
