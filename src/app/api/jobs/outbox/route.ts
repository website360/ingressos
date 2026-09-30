import { NextResponse, type NextRequest } from "next/server";

import { renderEmail, type EmailPayload } from "@/lib/email/templates";
import { EvolutionClient } from "@/lib/evolution/client";
import { ticketQrDataUrl } from "@/lib/qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderWhatsapp, type WhatsappPayload } from "@/lib/whatsapp/templates";
import { toWhatsAppNumber } from "@shared/validation/phone";

/**
 * Worker da fila de efeitos colaterais (ADR-003).
 *
 * Disparado por cron (Cloudways ou pg_cron chamando esta rota). Pega um lote
 * com trava, processa e devolve o resultado — falha vira retry com backoff
 * exponencial, e depois de 5 tentativas o job para na DLQ, visível em tela.
 *
 * Dois canais, dois tipos de job: `email.*` e `whatsapp.*`. São jobs separados
 * de propósito — o WhatsApp fora do ar não segura o e-mail, e cada um tem o
 * seu próprio ciclo de tentativas.
 *
 * Protegido por segredo compartilhado: é um endpoint que escreve no banco com
 * service role e não pode ficar aberto.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;

type Admin = ReturnType<typeof createAdminClient>;

interface OutboxJob {
  id: string;
  type: string;
  payload: EmailPayload & WhatsappPayload;
  tenant_id: string | null;
}

async function sendWithResend(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY ou EMAIL_FROM não configurados.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!response.ok) {
    throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Conexão do WhatsApp da empresa, uma leitura por lote.
 *
 * Vinte jobs da mesma empresa não precisam de vinte consultas — e o cache
 * dura só o tempo da rodada, então uma queda de conexão é notada na próxima.
 */
function connectionLoader(admin: Admin) {
  const cache = new Map<string, Awaited<ReturnType<typeof read>>>();

  async function read(tenantId: string) {
    const { data } = await admin
      .from("whatsapp_connections")
      .select("base_url, api_key, instance_name, instance_token, state")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return data;
  }

  return async (tenantId: string) => {
    if (!cache.has(tenantId)) cache.set(tenantId, await read(tenantId));
    return cache.get(tenantId)!;
  };
}

async function sendWhatsapp(
  admin: Admin,
  job: OutboxJob,
  appUrl: string,
  loadConnection: (tenantId: string) => Promise<{
    base_url: string;
    api_key: string;
    instance_name: string | null;
    instance_token: string | null;
    state: string;
  } | null>,
): Promise<void> {
  if (!job.tenant_id) throw new Error("Job de WhatsApp sem empresa.");

  const connection = await loadConnection(job.tenant_id);
  if (!connection || !connection.instance_name) {
    throw new Error("WhatsApp não configurado para esta empresa.");
  }

  // Número caído é falha temporária de verdade: o retry com backoff dá tempo
  // de alguém reparear antes de o job cair na DLQ.
  if (connection.state !== "conectado") {
    throw new Error(`Número do WhatsApp está ${connection.state}.`);
  }

  const number = toWhatsAppNumber(job.payload.phone ?? "");
  if (!number) {
    throw new Error(`Telefone inválido para WhatsApp: ${job.payload.phone ?? "(vazio)"}`);
  }

  const content = renderWhatsapp(job.type, job.payload, appUrl);
  const client = new EvolutionClient({
    baseUrl: connection.base_url,
    apiKey: connection.api_key,
  });

  // Falhar alto em vez de degradar em silêncio. Sem esta checagem, um payload
  // sem token cai no envio de texto puro e a pessoa recebe a confirmação sem o
  // ingresso — que foi exatamente o defeito que o gatilho de mensagens tinha
  // (ver a migration 20260801093300). Job que falha aparece; mensagem torta,
  // não.
  if (content.attachTicketQr && !job.payload.token) {
    throw new Error("Job de confirmação sem token do ingresso — nada a anexar.");
  }

  let providerId: string | null;

  if (content.attachTicketQr && job.payload.token) {
    // O mesmo QR do ingresso e do PDF — o conteúdo é o token assinado, e
    // nenhum dado pessoal viaja na imagem.
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

  await admin.from("whatsapp_messages").insert({
    tenant_id: job.tenant_id,
    template: job.type,
    to_phone: number,
    body: content.body,
    payload: job.payload as never,
    status: "enviado",
    provider_message_id: providerId,
    sent_at: new Date().toISOString(),
    entity_type: "registration",
    entity_id: (job.payload as { registration_id?: string }).registration_id ?? null,
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const provided =
    request.headers.get("x-job-secret") ?? request.nextUrl.searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const loadConnection = connectionLoader(admin);

  const { data: jobs, error } = await admin.rpc("claim_outbox_jobs", {
    p_limit: BATCH_SIZE,
    p_worker: "next-cron",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as unknown as OutboxJob[];
  const outcome = { processed: 0, sent: 0, whatsapp: 0, failed: 0 };

  for (const job of claimed) {
    outcome.processed++;

    try {
      if (job.type.startsWith("email.")) {
        const content = renderEmail(job.type, job.payload, appUrl);
        const result = await sendWithResend(
          job.payload.to,
          content.subject,
          content.html,
          content.text,
        );

        await admin.from("email_messages").insert({
          tenant_id: job.tenant_id!,
          template: job.type,
          to_email: job.payload.to,
          subject: content.subject,
          payload: job.payload as never,
          status: "enviado",
          provider_message_id: result.id ?? null,
          sent_at: new Date().toISOString(),
        });

        outcome.sent++;
      } else if (job.type.startsWith("whatsapp.")) {
        await sendWhatsapp(admin, job, appUrl, loadConnection);
        outcome.whatsapp++;
      } else {
        // Tipos futuros (webhook, PDF) entram aqui. Ignorar em silêncio
        // deixaria o job preso em 'processando' para sempre.
        throw new Error(`Tipo de job não suportado: ${job.type}`);
      }

      await admin.rpc("complete_outbox_job", { p_id: job.id, p_success: true });
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError);

      await admin.rpc("complete_outbox_job", {
        p_id: job.id,
        p_success: false,
        p_error: message.slice(0, 500),
      });
      outcome.failed++;
    }
  }

  return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
}
