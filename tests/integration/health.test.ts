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
  });

  it("fila vazia sem worker: 200 (nada parado)", async () => {
    const res = await call("segredo-de-teste-do-cron");
    expect(res.status).toBe(200);
  });
});
