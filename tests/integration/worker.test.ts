import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startWorker, type RunningWorker } from "../../worker/whatsapp/dispatcher";
import {
  configureMeta,
  createTestEvent,
  getTestPool,
  register,
  resetWhatsappTables,
  testDatabaseUrl,
} from "../support/db";
import { errorReply, okReply, startMockMeta, type MockMeta, type MockReply } from "../support/mock-meta";

const db = getTestPool();
let tenantId = "";
let eventId = "";
let meta: MockMeta | null = null;
const workers: RunningWorker[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const silent = () => undefined;

async function until(check: () => Promise<boolean>, timeoutMs = 20_000, stepMs = 100) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(stepMs);
  }
  throw new Error("condição não atingida a tempo");
}

async function counts() {
  const { rows } = await db.query(
    `select status::text, count(*)::int as n from public.whatsapp_notifications group by status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

async function settle(total: number) {
  await until(async () => {
    const c = await counts();
    return (c.pendente ?? 0) + (c.processando ?? 0) === 0 && Object.values(c).reduce((a, b) => a + b, 0) >= total;
  });
}

/** Inscreve N pessoas com consentimento (telefones distintos). */
async function enroll(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const phone = `119${String(10_000_000 + i).slice(-8)}`;
    const { registrationId } = await register(db, eventId, { whatsappConsent: true, phone });
    ids.push(registrationId);
  }
  return ids;
}

async function start(
  script?: (req: import("../support/mock-meta").MockRequest, i: number) => MockReply,
  opts: { latencyMs?: number; workerId?: string } = {},
) {
  if (!meta) meta = await startMockMeta({ script, latencyMs: opts.latencyMs });
  const worker = await startWorker({
    databaseUrl: testDatabaseUrl(),
    metaBaseUrl: `${meta.url}/v23.0`,
    appUrl: "https://ingressos.example",
    workerId: opts.workerId ?? `w-${workers.length + 1}`,
    pollMs: 50,
    idlePollMs: 100,
    reconcileEveryMs: 500,
    staleMs: 1_000,
    log: silent,
  });
  workers.push(worker);
  return worker;
}

async function setCapacity(rate: number, daily = 1_000_000, concurrency = 16) {
  await db.query(
    `update public.whatsapp_connections
        set rate_per_second = $2, daily_unique_limit = $3, worker_concurrency = $4,
            paused = false, paused_reason = null, breaker_open_until = null, breaker_manual = false
      where tenant_id = $1`,
    [tenantId, rate, daily, concurrency],
  );
  await db.query(`delete from public.whatsapp_rate_buckets`);
}

describe("worker do WhatsApp", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId } = await createTestEvent(db));
    await configureMeta(db, tenantId);
  });

  beforeEach(async () => {
    await db.query(`delete from public.whatsapp_notifications`);
    await db.query(`delete from public.whatsapp_optouts`);
    await db.query(`delete from public.whatsapp_worker_heartbeats`);
    await db.query(`delete from public.registrations`);
    await db.query(`delete from public.attendees`);
    await setCapacity(100);
  });

  afterEach(async () => {
    while (workers.length) await workers.pop()!.stop();
    if (meta) {
      await meta.close();
      meta = null;
    }
  });

  afterAll(async () => {
    await db.end();
  });

  it("envia tudo, grava o wamid e manda o id da notificação como callback", async () => {
    await enroll(60);
    await start();
    await settle(60);
    expect(await counts()).toEqual({ aceita: 60 });
    const { rows } = await db.query(
      `select id, meta_message_id from public.whatsapp_notifications limit 1`,
    );
    expect(rows[0].meta_message_id).toMatch(/^wamid\./);
    const sent = meta!.requests.find(
      (r) => (r.body as { biz_opaque_callback_data?: string }).biz_opaque_callback_data === rows[0].id,
    );
    expect(sent).toBeDefined();
    const body = sent!.body as { to: string; template: { components: { type: string }[] } };
    expect(body.to).toMatch(/^55119/);
    expect(body.template.components[0]).toMatchObject({
      type: "header",
      parameters: [{ type: "image", image: { link: expect.stringMatching(/\/api\/ingresso\/.+\/qr\.png$/) } }],
    });
  });

  it("respeita a vazão global configurada", async () => {
    await setCapacity(20);
    await enroll(70);
    await start();
    await settle(70);
    const times = meta!.requests.map((r) => r.at).sort((a, b) => a - b);
    // Em qualquer janela de 1 s: no máximo taxa + capacidade (20 + 20).
    for (let i = 0; i < times.length; i++) {
      const inWindow = times.filter((t) => t >= times[i]! && t < times[i]! + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(40);
    }
    // 70 a 20/s com 20 de largada: pelo menos ~2 s.
    expect(times[times.length - 1]! - times[0]!).toBeGreaterThanOrEqual(2000);
  });

  it("dois workers dividem a fila sem repetir ninguém", async () => {
    await enroll(150);
    await start(undefined, { workerId: "w-a" });
    await start(undefined, { workerId: "w-b" });
    await settle(150);
    const ids = meta!.requests.map(
      (r) => (r.body as { biz_opaque_callback_data: string }).biz_opaque_callback_data,
    );
    expect(ids).toHaveLength(150);
    expect(new Set(ids).size).toBe(150);
  });

  it("429 da Meta: volta para a fila sem gastar tentativa e depois sai", async () => {
    await enroll(5);
    await start((_req, i) => (i < 3 ? errorReply(429, 130429, "limite") : okReply()));
    await settle(5);
    expect(await counts()).toEqual({ aceita: 5 });
    const { rows } = await db.query(`select max(attempts)::int as m from public.whatsapp_notifications`);
    expect(rows[0].m).toBe(1);
    const bucket = await db.query(`select throttle_until > now() as braking from public.whatsapp_rate_buckets`);
    expect(bucket.rows[0].braking).toBe(true);
  });

  it("5xx: retry com backoff (fica agendada, não falha)", async () => {
    await enroll(1);
    await start(() => errorReply(503, 131000, "instável"));
    await until(async () => (await counts()).pendente === 1 && meta!.requests.length >= 1);
    const { rows } = await db.query(
      `select attempts, next_attempt_at > now() + interval '20 seconds' as later, last_error_code
         from public.whatsapp_notifications`,
    );
    expect(rows[0]).toMatchObject({ attempts: 1, later: true, last_error_code: 131000 });
  });

  it("timeout depois de enviada: incerta, e a Meta recebeu exatamente uma vez", async () => {
    await enroll(1);
    const worker = await startWorker({
      databaseUrl: testDatabaseUrl(),
      metaBaseUrl: `${(meta = await startMockMeta({ script: () => ({ hang: true }) })).url}/v23.0`,
      appUrl: "https://ingressos.example",
      workerId: "w-timeout",
      pollMs: 50,
      reconcileEveryMs: 500,
      staleMs: 60_000,
      metaTimeoutMs: 500,
      log: silent,
    });
    workers.push(worker);
    await until(async () => (await counts()).incerta === 1);
    await sleep(1500);
    expect(meta.requests).toHaveLength(1);
  });

  it("número inexistente (131026): falha definitiva e opt-out como inválido", async () => {
    await enroll(1);
    await start(() => errorReply(400, 131026, "não é usuário do WhatsApp"));
    await settle(1);
    expect(await counts()).toEqual({ falhou: 1 });
    const { rows } = await db.query(`select reason from public.whatsapp_optouts`);
    expect(rows).toEqual([{ reason: "invalido" }]);
  });

  it("token inválido (190): abre o breaker manual e nada mais sai até retomar", async () => {
    await enroll(5);
    await start(() => errorReply(401, 190, "token expirado"));
    await until(async () => {
      const { rows } = await db.query(
        `select paused, breaker_manual from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      );
      return rows[0].paused && rows[0].breaker_manual;
    });
    await sleep(500);
    const before = meta!.requests.length;
    await sleep(800);
    expect(meta!.requests.length).toBe(before);
    const c = await counts();
    expect(c.pendente).toBe(5);
    const { rows } = await db.query(`select max(attempts)::int as m from public.whatsapp_notifications`);
    expect(rows[0].m).toBe(0);
  });

  it("taxa de erro alta: breaker automático por alguns minutos", async () => {
    await enroll(60);
    await start((_req, i) => (i % 10 < 3 ? errorReply(500, 131000) : okReply()));
    await until(async () => {
      const { rows } = await db.query(
        `select breaker_open_until > now() as open from public.whatsapp_connections where tenant_id = $1`,
        [tenantId],
      );
      return rows[0].open === true;
    });
    const { rows } = await db.query(
      `select paused, breaker_manual from public.whatsapp_connections where tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0]).toEqual({ paused: false, breaker_manual: false });
  });

  it("parar no meio: termina o que está em voo e não deixa nada travado", async () => {
    await enroll(20);
    const worker = await start(undefined, { latencyMs: 400 });
    await until(async () => meta!.requests.length > 0);
    await worker.stop();
    workers.splice(workers.indexOf(worker), 1);
    const c = await counts();
    expect(c.processando ?? 0).toBe(0);
    expect((c.aceita ?? 0) + (c.pendente ?? 0)).toBe(20);
  });

  it("reconciliação: travada sem requisição volta; com requisição vira incerta", async () => {
    await enroll(2);
    await db.query(
      `update public.whatsapp_notifications n
          set status = 'processando', locked_at = now() - interval '10 minutes', locked_by = 'morto',
              request_started_at = case when n.id = (select min(id::text)::uuid from public.whatsapp_notifications)
                                        then now() - interval '10 minutes' end`,
    );
    await db.query(`update public.whatsapp_connections set paused = true where tenant_id = $1`, [tenantId]);
    await start();
    await until(async () => {
      const c = await counts();
      return c.incerta === 1 && c.pendente === 1;
    });
  });

  it("teto diário: só sai até o limite e o motivo aparece", async () => {
    await setCapacity(100, 5);
    await enroll(12);
    await start();
    await until(async () => (await counts()).aceita === 5);
    await sleep(600);
    expect((await counts()).aceita).toBe(5);
    const { rows } = await db.query(
      `select paused, paused_reason from public.whatsapp_connections where tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0]).toEqual({ paused: false, paused_reason: "teto_diario" });
  });

  it("dados lidos na hora do envio: evento renomeado antes de sair vai com o nome novo", async () => {
    await enroll(1);
    await db.query(`update public.events set name = 'Nome Novo do Evento' where id = $1`, [eventId]);
    await start();
    await settle(1);
    const body = meta!.requests[0]!.body as {
      template: { components: { type: string; parameters: { text?: string }[] }[] };
    };
    const bodyParams = body.template.components.find((c) => c.type === "body")!.parameters;
    expect(bodyParams.map((p) => p.text)).toContain("Nome Novo do Evento");
    await db.query(`update public.events set name = 'Evento de Teste' where id = $1`, [eventId]);
  });

  it("conexões derrubadas no meio: o worker se recupera e termina", async () => {
    await enroll(40);
    await setCapacity(10);
    await start();
    await until(async () => ((await counts()).aceita ?? 0) >= 5);
    await db.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'whatsapp-worker'`,
    );
    await settle(40);
    expect(await counts()).toEqual({ aceita: 40 });
  });

  it("grava batimento com memória e CPU do processo", async () => {
    await start(undefined, { workerId: "w-batimento" });
    await until(async () => {
      const { rows } = await db.query(
        `select count(*)::int as n from public.whatsapp_worker_heartbeats where worker_id = 'w-batimento'`,
      );
      return rows[0].n === 1;
    });
    const { rows } = await db.query(
      `select stats from public.whatsapp_worker_heartbeats where worker_id = 'w-batimento'`,
    );
    expect(rows[0].stats.rssMb).toBeGreaterThan(0);
    expect(rows[0].stats.cpuMs).toBeGreaterThanOrEqual(0);
  });
});
