import "server-only";

import { renderEmail, type EmailPayload } from "@/lib/email/templates";
import { EvolutionClient } from "@/lib/evolution/client";
import { ticketQrDataUrl } from "@/lib/qrcode";
import type { Database } from "@/lib/supabase/database.types";
import { renderWhatsapp, type WhatsappPayload } from "@/lib/whatsapp/templates";
import { toWhatsAppNumber } from "@shared/validation/phone";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Os dois canais da fila de outbox, cada um num lugar.
 *
 * Saíram da rota do worker quando ela passou a fazer três coisas — orquestrar
 * o lote, respeitar o ritmo e saber enviar por dois meios. A rota ficou com a
 * primeira; estas funções sabem enviar e registrar, e nada sobre lote.
 *
 * Cada envio grava a linha de log ANTES de dar o resultado ao chamador, tenha
 * dado certo ou errado — é o que faz a falha aparecer na tela em vez de morrer
 * dentro de `outbox_jobs.last_error`.
 */

export type Admin = SupabaseClient<Database>;

export interface OutboxJob {
  id: string;
  type: string;
  payload: EmailPayload & WhatsappPayload & { registration_id?: string };
  tenant_id: string | null;
  attempts: number;
  max_attempts: number;
}

/**
 * A situação da linha de log é a do JOB, não a da tentativa.
 *
 * Errar isto faz o log mentir: uma tentativa que falhou mas ainda tem retry
 * pela frente não "falhou" — ela continua na fila, e marcá-la como falha
 * enchia a tela de erros que iam se resolver sozinhos e deixava o botão de
 * reenvio sem nada de verdade para reenviar.
 */
function statusFor(job: OutboxJob, ok: boolean): Database["public"]["Enums"]["email_status"] {
  if (ok) return "enviado";
  return job.attempts >= job.max_attempts ? "falhou" : "fila";
}

export interface WhatsappConnection {
  base_url: string;
  api_key: string;
  instance_name: string | null;
  instance_token: string | null;
  state: string;
  send_interval_seconds: number;
  daily_send_limit: number;
}

/** Colunas comuns às duas tabelas de log. */
function baseRow(job: OutboxJob, ok: boolean, error: string | null, providerId: string | null) {
  return {
    job_id: job.id,
    tenant_id: job.tenant_id!,
    template: job.type,
    payload: job.payload as never,
    status: statusFor(job, ok),
    provider_message_id: providerId,
    attempts: job.attempts,
    last_error: error,
    sent_at: ok ? new Date().toISOString() : null,
    entity_type: "registration",
    entity_id: job.payload.registration_id ?? null,
  };
}

// -----------------------------------------------------------------------------
// E-mail
// -----------------------------------------------------------------------------

async function postToResend(to: string, subject: string, html: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY ou EMAIL_FROM não configurados.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as { id?: string };
}

export async function sendEmailJob(admin: Admin, job: OutboxJob, appUrl: string): Promise<void> {
  // O assunto é preciso mesmo no caminho de falha, para a linha de log não
  // ficar anônima. Renderizar antes de tentar enviar garante isso.
  let subject = job.type;
  try {
    subject = renderEmail(job.type, job.payload, appUrl).subject;
  } catch {
    // Template desconhecido: o erro real vem logo abaixo, com contexto melhor.
  }

  try {
    const content = renderEmail(job.type, job.payload, appUrl);
    const result = await postToResend(job.payload.to, content.subject, content.html, content.text);

    await admin.from("email_messages").upsert(
      {
        ...baseRow(job, true, null, result.id ?? null),
        to_email: job.payload.to,
        subject: content.subject,
      },
      { onConflict: "job_id" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("email_messages")
      .upsert(
        { ...baseRow(job, false, message, null), to_email: job.payload.to ?? "", subject },
        { onConflict: "job_id" },
      );
    throw error;
  }
}

// -----------------------------------------------------------------------------
// WhatsApp
// -----------------------------------------------------------------------------

export async function sendWhatsappJob(
  admin: Admin,
  job: OutboxJob,
  appUrl: string,
  connection: WhatsappConnection | null,
): Promise<void> {
  const number = toWhatsAppNumber(job.payload.phone ?? "");

  let body = job.type;
  try {
    body = renderWhatsapp(job.type, job.payload, appUrl).body;
  } catch {
    // idem: o erro com contexto vem abaixo.
  }

  const fail = async (message: string): Promise<never> => {
    await admin.from("whatsapp_messages").upsert(
      {
        ...baseRow(job, false, message, null),
        to_phone: number ?? job.payload.phone ?? "",
        body,
      },
      { onConflict: "job_id" },
    );
    throw new Error(message);
  };

  if (!connection || !connection.instance_name) {
    return fail("WhatsApp não configurado para esta empresa.");
  }

  // Número caído é falha temporária: o backoff dá tempo de alguém reparear
  // antes de o job esgotar as tentativas.
  if (connection.state !== "conectado") {
    return fail(`Número do WhatsApp está ${connection.state}.`);
  }

  if (!number) {
    return fail(`Telefone inválido para WhatsApp: ${job.payload.phone ?? "(vazio)"}`);
  }

  const content = renderWhatsapp(job.type, job.payload, appUrl);

  // Falhar alto em vez de degradar em silêncio: sem token, o envio viraria
  // texto puro e a pessoa receberia a confirmação sem o ingresso.
  if (content.attachTicketQr && !job.payload.token) {
    return fail("Job de confirmação sem token do ingresso — nada a anexar.");
  }

  const client = new EvolutionClient({
    baseUrl: connection.base_url,
    apiKey: connection.api_key,
  });

  try {
    let providerId: string | null;

    if (content.attachTicketQr && job.payload.token) {
      const dataUrl = await ticketQrDataUrl(job.payload.token);
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");

      providerId = await client.sendMedia(
        connection.instance_name,
        number,
        base64,
        content.body,
        `ingresso-${job.payload.ticket_code ?? "qrcode"}.png`,
        connection.instance_token,
      );
    } else {
      providerId = await client.sendText(
        connection.instance_name,
        number,
        content.body,
        connection.instance_token,
      );
    }

    await admin
      .from("whatsapp_messages")
      .upsert(
        { ...baseRow(job, true, null, providerId), to_phone: number, body: content.body },
        { onConflict: "job_id" },
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("whatsapp_messages")
      .upsert(
        { ...baseRow(job, false, message, null), to_phone: number, body: content.body },
        { onConflict: "job_id" },
      );
    throw error;
  }
}
