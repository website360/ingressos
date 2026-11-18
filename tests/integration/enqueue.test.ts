import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  configureEvolution,
  configureMeta,
  createTestEvent,
  getTestPool,
  register,
  resetWhatsappTables,
} from "../support/db";

const db = getTestPool();
let tenantId = "";
let eventId = "";

async function notificationsFor(registrationId: string) {
  const { rows } = await db.query(
    `select * from public.whatsapp_notifications where registration_id = $1 order by created_at`,
    [registrationId],
  );
  return rows;
}

describe("enfileiramento na inscrição", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId } = await createTestEvent(db));
  });

  beforeEach(async () => {
    await configureMeta(db, tenantId);
    await db.query(`delete from public.whatsapp_optouts`);
  });

  afterAll(async () => {
    await db.end();
  });

  it("com consentimento e Meta: uma notificação pendente, com E.164, modelo e consentimento", async () => {
    const { registrationId } = await register(db, eventId, { whatsappConsent: true });
    const rows = await notificationsFor(registrationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "registration_confirmed",
      status: "pendente",
      phone_e164: "+5511987654321",
      event_id: eventId,
      template_name: "ingresso_confirmado",
      template_version: 1,
      dedupe_key: `wa-confirmed-${registrationId}`,
    });
    expect(rows[0].consent_id).not.toBeNull();
  });

  it("grava o telefone a que o consentimento se refere", async () => {
    const { registrationId } = await register(db, eventId, { whatsappConsent: true });
    const { rows } = await db.query(
      `select subject from public.consents where registration_id = $1 and document_type = 'whatsapp'`,
      [registrationId],
    );
    expect(rows[0].subject).toBe("(11) 98765-4321");
  });

  it("nasce na mesma transação: desfazer a inscrição não deixa notificação", async () => {
    const client = await db.connect();
    let registrationId = "";
    try {
      await client.query("begin");
      ({ registrationId } = await register(client, eventId, { whatsappConsent: true }));
      const inside = await client.query(
        `select count(*)::int as n from public.whatsapp_notifications where registration_id = $1`,
        [registrationId],
      );
      expect(inside.rows[0].n).toBe(1);
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(await notificationsFor(registrationId)).toHaveLength(0);
  });

  it("sem consentimento: bloqueada, com o motivo", async () => {
    const { registrationId } = await register(db, eventId, { whatsappConsent: false });
    const [row] = await notificationsFor(registrationId);
    expect(row).toMatchObject({ status: "bloqueada", block_reason: "sem_consentimento" });
  });

  it("formulário antigo (sem o item de WhatsApp): bloqueada por falta de consentimento", async () => {
    const { registrationId } = await register(db, eventId);
    const [row] = await notificationsFor(registrationId);
    expect(row).toMatchObject({ status: "bloqueada", block_reason: "sem_consentimento" });
  });

  it("número em opt-out: bloqueada", async () => {
    await db.query(
      `insert into public.whatsapp_optouts (tenant_id, phone_e164, reason) values ($1, '+5511987654321', 'pedido')`,
      [tenantId],
    );
    const { registrationId } = await register(db, eventId, { whatsappConsent: true });
    const [row] = await notificationsFor(registrationId);
    expect(row).toMatchObject({ status: "bloqueada", block_reason: "optout" });
  });

  it("telefone inválido: bloqueada, sem número", async () => {
    const { registrationId } = await register(db, eventId, {
      whatsappConsent: true,
      phone: "(10) 1234-5678",
    });
    const [row] = await notificationsFor(registrationId);
    expect(row).toMatchObject({
      status: "bloqueada",
      block_reason: "telefone_invalido",
      phone_e164: null,
    });
  });

  it("com Meta, nenhum job de WhatsApp vai para outbox_jobs (o e-mail continua)", async () => {
    const { registrationId } = await register(db, eventId, { whatsappConsent: true });
    const { rows } = await db.query(
      `select type from public.outbox_jobs where payload ->> 'registration_id' = $1 order by type`,
      [registrationId],
    );
    expect(rows.map((r) => r.type)).toEqual(["email.registration_confirmed"]);
  });

  it("gatilho repetido não duplica (dedupe por inscrição)", async () => {
    const { registrationId } = await register(db, eventId, { whatsappConsent: true });
    await db.query(
      `select private.enqueue_whatsapp_notification(r.tenant_id, r.event_id, r.id,
                'registration_confirmed', a.phone, 'wa-confirmed-' || r.id, true, '{}'::jsonb)
         from public.registrations r join public.attendees a on a.id = r.attendee_id
        where r.id = $1`,
      [registrationId],
    );
    expect(await notificationsFor(registrationId)).toHaveLength(1);
  });

  it("cancelamento: notifica com consentimento e cancela a confirmação ainda na fila", async () => {
    const { registrationId } = await register(db, eventId, { whatsappConsent: true });
    await db.query(`select public.cancel_registration($1, 'teste', null, '{}'::jsonb)`, [
      registrationId,
    ]);
    const rows = await notificationsFor(registrationId);
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind.registration_confirmed.status).toBe("cancelada");
    expect(byKind.registration_cancelled).toMatchObject({
      status: "pendente",
      dedupe_key: `wa-cancelled-${registrationId}`,
    });
  });

  it("segunda via com Meta: notificação de código, sem exigir consentimento", async () => {
    const cpf = "39053344705";
    await register(db, eventId, { cpf, whatsappConsent: false });
    const { rows } = await db.query(
      `select public.request_ticket_code($1, '{"ip": "10.0.0.1"}'::jsonb) as r`,
      [cpf],
    );
    expect(rows[0].r.found).toBe(true);
    const code = await db.query(
      `select status, kind, params ? 'code' as has_code, registration_id
         from public.whatsapp_notifications where kind = 'ticket_code' order by created_at desc limit 1`,
    );
    expect(code.rows[0]).toMatchObject({
      status: "pendente",
      kind: "ticket_code",
      has_code: true,
      registration_id: null,
    });
    const legacy = await db.query(
      `select count(*)::int as n from public.outbox_jobs where type = 'whatsapp.ticket_code'`,
    );
    expect(legacy.rows[0].n).toBe(0);
  });

  describe("com Evolution", () => {
    beforeEach(async () => {
      await configureEvolution(db, tenantId);
    });

    it("segue como hoje: job em outbox_jobs e nada na fila nova", async () => {
      const { registrationId } = await register(db, eventId, { whatsappConsent: true });
      const { rows } = await db.query(
        `select type from public.outbox_jobs where payload ->> 'registration_id' = $1 order by type`,
        [registrationId],
      );
      expect(rows.map((r) => r.type)).toEqual([
        "email.registration_confirmed",
        "whatsapp.registration_confirmed",
      ]);
      expect(await notificationsFor(registrationId)).toHaveLength(0);
    });
  });
});
