import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as health } from "@/app/api/health/whatsapp/route";

import { configureMeta, createTestEvent, getTestPool, resetWhatsappTables } from "../support/db";

const db = getTestPool();
let tenantId = "";
let eventId = "";

const call = (secret?: string) =>
  health(
    new NextRequest("http://127.0.0.1:3000/api/health/whatsapp", {
      headers: secret ? { "x-job-secret": secret } : {},
    }),
  );

describe("health check do WhatsApp", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId } = await createTestEvent(db));
    await configureMeta(db, tenantId);
  });

  beforeEach(async () => {
    await db.query(`delete from public.whatsapp_notifications`);
    await db.query(`delete from public.whatsapp_worker_heartbeats`);
  });

  afterAll(async () => {
    await db.end();
  });

  it("sem o segredo: 401", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("errado")).status).toBe(401);
  });

  it("fila parada e nenhum worker vivo: 503", async () => {
    await db.query(
      `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key, queued_at)
       values ($1, $2, 'registration_confirmed', '+5511987654321', 'h-1', now() - interval '3 minutes')`,
      [tenantId, eventId],
    );
    const res = await call("segredo-de-teste-do-cron");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, workers: 0, queue: 1 });
    expect(body.oldestQueuedSeconds).toBeGreaterThanOrEqual(170);
  });

  it("worker vivo: 200, sem dado pessoal no corpo", async () => {
    await db.query(
      `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key)
       values ($1, $2, 'registration_confirmed', '+5511987654321', 'h-2')`,
      [tenantId, eventId],
    );
    await db.query(`select public.whatsapp_heartbeat('w-health', '{}')`);
    const res = await call("segredo-de-teste-do-cron");
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("5511");
    expect(JSON.parse(raw)).toMatchObject({ ok: true, workers: 1, queue: 1, paused: false });
    expect(JSON.parse(raw)).not.toHaveProperty("pausedReason");
  });

  it("worker vivo mas fila parada há mais de 15 min (sem pausa): 503", async () => {
    await db.query(
      `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key, queued_at)
       values ($1, $2, 'registration_confirmed', '+5511987654321', 'h-3', now() - interval '20 minutes')`,
      [tenantId, eventId],
    );
    await db.query(`select public.whatsapp_heartbeat('w-health', '{}')`);
    const res = await call("segredo-de-teste-do-cron");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, stalled: true });
  });

  it("fila parada mas pausada de propósito: 200, com paused", async () => {
    await db.query(
      `insert into public.whatsapp_notifications (tenant_id, event_id, kind, phone_e164, dedupe_key, queued_at)
       values ($1, $2, 'registration_confirmed', '+5511987654321', 'h-4', now() - interval '20 minutes')`,
      [tenantId, eventId],
    );
    await db.query(`select public.whatsapp_heartbeat('w-health', '{}')`);
    await db.query(`update public.whatsapp_connections set paused = true where tenant_id = $1`, [tenantId]);
    const res = await call("segredo-de-teste-do-cron");
    await db.query(`update public.whatsapp_connections set paused = false where tenant_id = $1`, [tenantId]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, paused: true });
  });

  it("pausa automática do sistema (breaker manual por erro sistêmico): 503", async () => {
    await db.query(`select public.whatsapp_heartbeat('w-health', '{}')`);
    await db.query(`select public.whatsapp_open_breaker($1, null, 'token inválido', true)`, [tenantId]);
    const res = await call("segredo-de-teste-do-cron");
    await db.query(
      `update public.whatsapp_connections set paused = false, breaker_manual = false where tenant_id = $1`,
      [tenantId],
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, systemPaused: true });
  });

  it("mensagem presa em 'processando' há mais de 5 min: 503", async () => {
    await db.query(
      `insert into public.whatsapp_notifications
         (tenant_id, event_id, kind, phone_e164, dedupe_key, status, locked_at)
       values ($1, $2, 'registration_confirmed', '+5511987654321', 'h-5', 'processando', now() - interval '6 minutes')`,
      [tenantId, eventId],
    );
    await db.query(`select public.whatsapp_heartbeat('w-health', '{}')`);
    const res = await call("segredo-de-teste-do-cron");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, stalled: true });
  });

  it("presa em 'processando' alarma mesmo com pausa de pessoa", async () => {
    await db.query(
      `insert into public.whatsapp_notifications
         (tenant_id, event_id, kind, phone_e164, dedupe_key, status, locked_at)
       values ($1, $2, 'registration_confirmed', '+5511987654321', 'h-6', 'processando', now() - interval '6 minutes')`,
      [tenantId, eventId],
    );
    await db.query(`select public.whatsapp_heartbeat('w-health', '{}')`);
    await db.query(`update public.whatsapp_connections set paused = true where tenant_id = $1`, [tenantId]);
    const res = await call("segredo-de-teste-do-cron");
    await db.query(`update public.whatsapp_connections set paused = false where tenant_id = $1`, [tenantId]);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, stuckProcessing: true });
  });

  it("fila vazia sem worker: 200 (nada parado)", async () => {
    const res = await call("segredo-de-teste-do-cron");
    expect(res.status).toBe(200);
  });
});
