import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isWhatsappOptInEnabled } from "@/lib/whatsapp-optin";

import { configureEvolution, configureMeta, createTestEvent, getTestPool } from "../support/db";

const db = getTestPool();
let tenantId = "";
let eventId = "";

describe("caixa de WhatsApp no formulário", () => {
  beforeAll(async () => {
    ({ tenantId, eventId } = await createTestEvent(db));
  });

  afterAll(async () => {
    await db.end();
  });

  it("aparece com a Meta configurada e conectada", async () => {
    await configureMeta(db, tenantId);
    expect(await isWhatsappOptInEnabled(eventId)).toBe(true);
  });

  it("some com a Meta desconectada", async () => {
    await configureMeta(db, tenantId);
    await db.query(`update public.whatsapp_connections set state = 'desconectado' where tenant_id = $1`, [
      tenantId,
    ]);
    expect(await isWhatsappOptInEnabled(eventId)).toBe(false);
  });

  it("evento inexistente: não oferece", async () => {
    await configureMeta(db, tenantId);
    expect(await isWhatsappOptInEnabled("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("some com a Evolution", async () => {
    await configureEvolution(db, tenantId);
    expect(await isWhatsappOptInEnabled(eventId)).toBe(false);
  });
});
