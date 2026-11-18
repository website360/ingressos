import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as outboxCron } from "@/app/api/jobs/outbox/route";
import { GET as qrRoute } from "@/app/api/ingresso/[token]/qr.png/route";
import { POST as webhook } from "@/app/api/webhooks/meta/route";

import {
  configureMeta,
  createTestEvent,
  getTestPool,
  register,
  resetWhatsappTables,
} from "../support/db";

const db = getTestPool();
const SECRET = "segredo-do-app";
const PHONE_ID = "1234567890";
let tenantId = "";
let eventId = "";

function sign(raw: string, secret = SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

function post(body: unknown, opts: { secret?: string; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  return webhook(
    new NextRequest("https://ingressos.example/api/webhooks/meta", {
      method: "POST",
      body: raw,
      headers: { "x-hub-signature-256": sign(raw, opts.secret), "content-type": "application/json" },
    }),
  );
}

function statusPayload(
  statuses: { id: string; status: string; ts?: number; callback?: string; code?: number }[],
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511900000000", phone_number_id: PHONE_ID },
              statuses: statuses.map((s) => ({
                id: s.id,
                status: s.status,
                timestamp: String(s.ts ?? 1_800_000_000),
                recipient_id: "5511987654321",
                ...(s.callback ? { biz_opaque_callback_data: s.callback } : {}),
                ...(s.code
                  ? { errors: [{ code: s.code, title: "erro", error_data: { details: "detalhe" } }] }
                  : {}),
              })),
            },
          },
        ],
      },
    ],
  };
}

async function newNotification(
  opts: { status?: string; wamid?: string | null; phone?: string } = {},
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.whatsapp_notifications
       (tenant_id, event_id, kind, phone_e164, dedupe_key, status, meta_message_id, accepted_at)
     values ($1, $2, 'registration_confirmed', $3, gen_random_uuid()::text, $4, $5,
             case when $5::text is null then null else now() end)
     returning id`,
    [tenantId, eventId, opts.phone ?? "+5511987654321", opts.status ?? "aceita", opts.wamid ?? null],
  );
  return rows[0].id;
}

async function row(id: string) {
  const { rows } = await db.query(`select * from public.whatsapp_notifications where id = $1`, [id]);
  return rows[0];
}

afterAll(async () => {
  await db.end();
});

describe("webhook da Meta", () => {
  beforeAll(async () => {
    await resetWhatsappTables(db);
    ({ tenantId, eventId } = await createTestEvent(db));
    await configureMeta(db, tenantId);
  });

  beforeEach(async () => {
    await db.query(`delete from public.whatsapp_notifications`);
    await db.query(`delete from public.whatsapp_webhook_events`);
    await db.query(`delete from public.whatsapp_optouts`);
    await db.query(
      `update public.whatsapp_connections set paused = false, paused_reason = null, breaker_manual = false,
              quality_rating = null where tenant_id = $1`,
      [tenantId],
    );
  });

  it("assinatura inválida: 401 e nada gravado", async () => {
    const res = await post(statusPayload([{ id: "wamid.X", status: "sent" }]), { secret: "outro" });
    expect(res.status).toBe(401);
    const { rows } = await db.query(`select count(*)::int as n from public.whatsapp_webhook_events`);
    expect(rows[0].n).toBe(0);
  });

  it("corpo acima de 1 MB: 413", async () => {
    const raw = JSON.stringify({ pad: "x".repeat(1_100_000) });
    const res = await post(null, { raw });
    expect(res.status).toBe(413);
  });

  it("evento válido é gravado cru e marcado como processado", async () => {
    const id = await newNotification({ wamid: "wamid.GRAVA" });
    const res = await post(statusPayload([{ id: "wamid.GRAVA", status: "sent" }]));
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      `select phone_number_id, processed_at is not null as done, payload ? 'entry' as raw
         from public.whatsapp_webhook_events`,
    );
    expect(rows).toEqual([{ phone_number_id: PHONE_ID, done: true, raw: true }]);
    expect((await row(id)).status).toBe("enviada");
  });

  it("fora de ordem: 'delivered' antes de 'sent' fica entregue, com as duas horas", async () => {
    const id = await newNotification({ wamid: "wamid.ORDEM" });
    await post(statusPayload([{ id: "wamid.ORDEM", status: "delivered", ts: 1_800_000_010 }]));
    await post(statusPayload([{ id: "wamid.ORDEM", status: "sent", ts: 1_800_000_005 }]));
    const r = await row(id);
    expect(r.status).toBe("entregue");
    expect(r.sent_at).not.toBeNull();
    expect(r.delivered_at).not.toBeNull();
    expect(new Date(r.sent_at).getTime()).toBe(1_800_000_005_000);
  });

  it("o mesmo POST duas vezes não muda nada na segunda", async () => {
    const id = await newNotification({ wamid: "wamid.DUP" });
    const body = statusPayload([{ id: "wamid.DUP", status: "read", ts: 1_800_000_020 }]);
    await post(body);
    const first = await row(id);
    await post(body);
    const second = await row(id);
    expect(second.status).toBe("lida");
    expect(second.read_at).toEqual(first.read_at);
  });

  it("'sent' casa pelo callback antes de o worker gravar o wamid; o resultado tardio não rebaixa", async () => {
    const id = await newNotification({ status: "processando", wamid: null });
    await post(statusPayload([{ id: "wamid.CEDO", status: "sent", callback: id }]));
    let r = await row(id);
    expect(r).toMatchObject({ status: "enviada", meta_message_id: "wamid.CEDO" });
    await db.query(`select public.record_whatsapp_result($1, 'aceita', 'wamid.CEDO', null, null, null, true)`, [id]);
    r = await row(id);
    expect(r.status).toBe("enviada");
    expect(r.accepted_at).not.toBeNull();
  });

  it("incerta que a Meta confirma pelo callback deixa de ser incerta", async () => {
    const id = await newNotification({ status: "incerta", wamid: null });
    await post(statusPayload([{ id: "wamid.SALVA", status: "delivered", callback: id }]));
    expect(await row(id)).toMatchObject({ status: "entregue", meta_message_id: "wamid.SALVA" });
  });

  it("falha 131050 (o usuário parou de receber): opt-out e pendentes do número bloqueadas", async () => {
    const id = await newNotification({ wamid: "wamid.BLOQ" });
    const pending = await newNotification({ status: "pendente" });
    await post(statusPayload([{ id: "wamid.BLOQ", status: "failed", code: 131050 }]));
    expect(await row(id)).toMatchObject({ status: "falhou", last_error_code: 131050 });
    expect(await row(pending)).toMatchObject({ status: "bloqueada", block_reason: "optout" });
    const { rows } = await db.query(`select reason from public.whatsapp_optouts`);
    expect(rows).toEqual([{ reason: "bloqueio" }]);
  });

  it("mensagem recebida 'PARAR' vira opt-out por pedido", async () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_ID },
                messages: [{ from: "5511912345678", id: "wamid.IN", type: "text", text: { body: " PARAR! " } }],
              },
            },
          ],
        },
      ],
    };
    await post(body);
    const { rows } = await db.query(`select phone_e164, reason from public.whatsapp_optouts`);
    expect(rows).toEqual([{ phone_e164: "+5511912345678", reason: "pedido" }]);
  });

  it("queda de qualidade do número pausa os envios", async () => {
    await post({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "phone_number_quality_update",
              value: { display_phone_number: "5511900000000", event: "FLAGGED", current_limit: "TIER_1K" },
            },
          ],
        },
      ],
    });
    const { rows } = await db.query(
      `select paused, breaker_manual, quality_rating, messaging_tier from public.whatsapp_connections where tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0]).toEqual({
      paused: true,
      breaker_manual: true,
      quality_rating: "FLAGGED",
      messaging_tier: "TIER_1K",
    });
  });

  it("situação do modelo aprovada pela Meta atualiza a versão", async () => {
    await post({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_name: "confirmacao_inscricao", message_template_language: "pt_BR" },
            },
          ],
        },
      ],
    });
    const { rows } = await db.query(
      `select meta_status from public.whatsapp_templates where name = 'confirmacao_inscricao'`,
    );
    expect(rows[0].meta_status).toBe("aprovado");
  });

  it("mensagem antiga (só em whatsapp_messages) continua sendo atualizada", async () => {
    await db.query(
      `insert into public.whatsapp_messages (tenant_id, template, to_phone, body, status, provider_message_id)
       values ($1, 'whatsapp.registration_confirmed', '5511987654321', 'x', 'enviado', 'wamid.ANTIGA')`,
      [tenantId],
    );
    await post(statusPayload([{ id: "wamid.ANTIGA", status: "delivered" }]));
    const { rows } = await db.query(
      `select status from public.whatsapp_messages where provider_message_id = 'wamid.ANTIGA'`,
    );
    expect(rows[0].status).toBe("entregue");
  });

  it("evento que falhou ao processar fica guardado e é reprocessado", async () => {
    const { rows } = await db.query(
      `insert into public.whatsapp_webhook_events (phone_number_id, payload, received_at)
       values ($1, $2, now() - interval '5 minutes') returning id`,
      [PHONE_ID, statusPayload([{ id: "wamid.DEPOIS", status: "delivered" }])],
    );
    const id = await newNotification({ wamid: "wamid.DEPOIS" });
    const done = await db.query(`select public.whatsapp_reprocess_webhooks(100) as n`);
    expect(done.rows[0].n).toBe(1);
    expect((await row(id)).status).toBe("entregue");
    const ev = await db.query(`select processed_at is not null as ok from public.whatsapp_webhook_events where id = $1`, [
      rows[0].id,
    ]);
    expect(ev.rows[0].ok).toBe(true);
  });
});

describe("QR do ingresso por link", () => {
  beforeAll(async () => {
    await configureMeta(db, (await createTestEvent(db)).tenantId);
  });

  it("token válido devolve PNG com cache", async () => {
    const { eventId: ev } = await createTestEvent(db);
    const { token } = await register(db, ev, { whatsappConsent: true });
    const res = await qrRoute(new Request("https://x/api/ingresso/t/qr.png"), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("token com assinatura errada: 404", async () => {
    const res = await qrRoute(new Request("https://x/api/ingresso/t/qr.png"), {
      params: Promise.resolve({ token: "ABCDEF123456.assinaturafalsa" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("cron antigo com a Meta ligada", () => {
  it("não envia job de WhatsApp: encerra com explicação", async () => {
    const tenant = (await createTestEvent(db)).tenantId;
    await configureMeta(db, tenant);
    await db.query(`delete from public.outbox_jobs`);
    const { rows } = await db.query(
      `insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key, run_at)
       values ($1, 'whatsapp.registration_confirmed', '{"phone":"11987654321"}', 'legado-1', now() - interval '1 minute')
       returning id`,
      [tenant],
    );
    const res = await outboxCron(
      new NextRequest("http://127.0.0.1:3000/api/jobs/outbox", {
        method: "POST",
        headers: { "x-job-secret": "segredo-de-teste-do-cron" },
      }),
    );
    expect(res.status).toBe(200);
    const job = await db.query(`select status::text, last_error from public.outbox_jobs where id = $1`, [rows[0].id]);
    expect(job.rows[0].status).toBe("falhou");
    expect(job.rows[0].last_error).toMatch(/fila nova/);
    const log = await db.query(`select count(*)::int as n from public.whatsapp_messages where job_id = $1`, [
      rows[0].id,
    ]);
    expect(log.rows[0].n).toBe(0);
  });
});
