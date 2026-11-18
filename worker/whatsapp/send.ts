import type pg from "pg";

import { nextRetryAt } from "../../shared/whatsapp/backoff";
import { classifyMetaFailure } from "../../shared/whatsapp/errors";
import { maskPhone } from "../../shared/whatsapp/mask";
import { MetaGraphClient, MetaSendError } from "../../shared/whatsapp/meta-api";
import {
  buildTemplateMessage,
  templateValues,
  type TemplateRow,
} from "../../shared/whatsapp/template-message";
import { sanitize, type Logger } from "./log";

export interface Notification {
  id: string;
  tenant_id: string;
  registration_id: string | null;
  kind: "registration_confirmed" | "registration_cancelled" | "ticket_code";
  phone_e164: string | null;
  template_id: string | null;
  attempts: number;
  params: Record<string, unknown>;
}

export interface TenantConnection {
  tenant_id: string;
  access_token: string;
  phone_number_id: string;
}

/** O que aconteceu, para o despachante alimentar o breaker e o freio. */
export type SendOutcome =
  | "aceita"
  | "retry"
  | "throttle"
  | "recipient_error"
  | "message_error"
  | "systemic"
  | "incerta"
  | "skipped"
  | "returned";

interface Context {
  reg_status: string | null;
  first_name: string | null;
  event_name: string | null;
  starts_at: string | null;
  timezone: string | null;
  venue_name: string | null;
  city: string | null;
  number: string | null;
  ticket_code: string | null;
  ticket_signature: string | null;
}

const RECIPIENT_OPTOUT: Record<number, string> = {
  131026: "invalido",
  131049: "bloqueio",
  131050: "bloqueio",
};

async function record(
  db: pg.Pool,
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

async function loadContext(db: pg.Pool, n: Notification): Promise<Context | null> {
  if (!n.registration_id) return null;
  const { rows } = await db.query<Context>(
    `select r.status::text      as reg_status,
            a.first_name,
            e.name              as event_name,
            e.starts_at,
            e.timezone,
            e.venue_name,
            e.city,
            r.number,
            t.code              as ticket_code,
            t.signature         as ticket_signature
       from public.registrations r
       join public.attendees a on a.id = r.attendee_id
       join public.events e    on e.id = r.event_id
       left join lateral (
         select code, signature from public.tickets
          where registration_id = r.id and status = 'valido'
          order by created_at desc limit 1
       ) t on true
      where r.id = $1`,
    [n.registration_id],
  );
  return rows[0] ?? null;
}

async function loadTemplate(db: pg.Pool, n: Notification): Promise<TemplateRow | null> {
  const { rows } = await db.query<TemplateRow>(
    `select name, language, header_type, param_order, button_param
       from public.whatsapp_templates
      where tenant_id = $1
        and (id = $2 or ($2::uuid is null and key = $3::public.whatsapp_notification_kind and active))
      order by (id = $2) desc nulls last
      limit 1`,
    [n.tenant_id, n.template_id, n.kind],
  );
  return rows[0] ?? null;
}

/**
 * Envia UMA notificação já reivindicada e grava o resultado.
 *
 * Os dados (nome, evento, token) são lidos AGORA: editar o evento ou cancelar
 * o ingresso antes do envio já reflete. A requisição só é marcada como
 * iniciada imediatamente antes do POST — é essa marca que separa "pode
 * repetir" de "pode ter chegado".
 */
export async function sendNotification(args: {
  db: pg.Pool;
  n: Notification;
  conn: TenantConnection;
  metaBaseUrl: string;
  appUrl: string;
  metaTimeoutMs: number;
  stopping: () => boolean;
  log: Logger;
}): Promise<SendOutcome> {
  const { db, n, conn, log } = args;

  if (args.stopping()) {
    await record(db, n.id, "devolver");
    return "returned";
  }

  if (!n.phone_e164) {
    await record(db, n.id, "bloqueada", { error: "telefone_invalido" });
    return "skipped";
  }

  const optout = await db.query(
    `select 1 from public.whatsapp_optouts where tenant_id = $1 and phone_e164 = $2`,
    [n.tenant_id, n.phone_e164],
  );
  if (optout.rowCount) {
    await record(db, n.id, "bloqueada", { error: "optout" });
    return "skipped";
  }

  const ctx = await loadContext(db, n);
  if (n.kind === "registration_confirmed" && (!ctx || ctx.reg_status !== "confirmada" || !ctx.ticket_code)) {
    await record(db, n.id, "cancelada", { error: "Inscrição ou ingresso cancelado antes do envio." });
    return "skipped";
  }

  const template = await loadTemplate(db, n);
  if (!template) {
    await record(db, n.id, "devolver");
    await db.query(`select public.whatsapp_open_breaker($1, null, $2, true)`, [
      n.tenant_id,
      `Nenhum modelo ativo para ${n.kind}.`,
    ]);
    return "systemic";
  }

  const token = ctx?.ticket_code ? `${ctx.ticket_code}.${ctx.ticket_signature}` : "";
  const values = templateValues({
    name: ctx?.first_name ?? (n.params.name as string | undefined) ?? null,
    eventName: ctx?.event_name ?? null,
    startsAt: ctx?.starts_at ? new Date(ctx.starts_at).toISOString() : null,
    timezone: ctx?.timezone ?? null,
    venue: ctx?.venue_name ?? null,
    city: ctx?.city ?? null,
    number: ctx?.number ?? null,
    token,
    code: (n.params.code as string | undefined) ?? null,
  });

  let message;
  try {
    message = buildTemplateMessage(template, values, {
      headerImageUrl: token
        ? `${args.appUrl.replace(/\/+$/, "")}/api/ingresso/${encodeURIComponent(token)}/qr.png`
        : undefined,
    });
  } catch (error) {
    await record(db, n.id, "falhou", { error: (error as Error).message });
    return "message_error";
  }

  const client = new MetaGraphClient({
    baseUrl: args.metaBaseUrl,
    accessToken: conn.access_token,
    phoneNumberId: conn.phone_number_id,
    timeoutMs: args.metaTimeoutMs,
  });

  await db.query(`select public.mark_whatsapp_request_started($1)`, [[n.id]]);

  try {
    const wamid = await client.sendTemplate(n.phone_e164, message, { callbackData: n.id });
    await record(db, n.id, "aceita", { wamid });
    return "aceita";
  } catch (error) {
    if (!(error instanceof MetaSendError)) throw error;

    const kind = classifyMetaFailure(error);
    const detail = sanitize(error.message);
    const fields = { id: n.id, to: maskPhone(n.phone_e164), code: error.code, status: error.status };

    switch (kind) {
      case "retry_safe":
        await record(db, n.id, "retry", {
          code: error.code ?? error.status,
          error: detail,
          retryAt: nextRetryAt(n.attempts + 1, new Date()),
        });
        log("warn", "falha temporária; nova tentativa agendada", fields);
        return "retry";

      case "throttle":
        // Não é culpa da mensagem: volta logo, sem gastar tentativa.
        await record(db, n.id, "retry", {
          code: error.code ?? error.status,
          error: detail,
          retryAt: new Date(Date.now() + 2_000 + Math.random() * 3_000),
          count: false,
        });
        await db.query(`select public.whatsapp_throttle($1, 0.5, 60)`, [n.tenant_id]);
        log("warn", "Meta pediu para desacelerar; vazão reduzida por 60 s", fields);
        return "throttle";

      case "permanent_recipient": {
        await record(db, n.id, "falhou", { code: error.code, error: detail });
        const reason = error.code !== undefined ? RECIPIENT_OPTOUT[error.code] : undefined;
        if (reason) {
          await db.query(
            `insert into public.whatsapp_optouts (tenant_id, phone_e164, reason, source)
             values ($1, $2, $3, 'meta') on conflict do nothing`,
            [n.tenant_id, n.phone_e164, reason],
          );
        }
        return "recipient_error";
      }

      case "permanent_message":
        await record(db, n.id, "falhou", { code: error.code ?? error.status, error: detail });
        log("error", "mensagem recusada pela Meta", fields);
        return "message_error";

      case "systemic":
        await record(db, n.id, "devolver");
        await db.query(`select public.whatsapp_open_breaker($1, null, $2, true)`, [
          n.tenant_id,
          detail,
        ]);
        log("error", "erro sistêmico da Meta; envios pausados até retomada manual", fields);
        return "systemic";

      case "uncertain":
        await record(db, n.id, "incerta", { error: detail });
        log("warn", "resultado incerto; não será reenviada automaticamente", fields);
        return "incerta";
    }
  }
}
