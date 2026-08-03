import { NextResponse, type NextRequest } from "next/server";

import { renderEmail, type EmailPayload } from "@/lib/email/templates";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Worker da fila de efeitos colaterais (ADR-003).
 *
 * Disparado por cron (Cloudways ou pg_cron chamando esta rota). Pega um lote
 * com trava, processa e devolve o resultado — falha vira retry com backoff
 * exponencial, e depois de 5 tentativas o job para na DLQ, visível em tela.
 *
 * Protegido por segredo compartilhado: é um endpoint que escreve no banco com
 * service role e não pode ficar aberto.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;

interface OutboxJob {
  id: string;
  type: string;
  payload: EmailPayload;
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

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const provided =
    request.headers.get("x-job-secret") ?? request.nextUrl.searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data: jobs, error } = await admin.rpc("claim_outbox_jobs", {
    p_limit: BATCH_SIZE,
    p_worker: "next-cron",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as unknown as OutboxJob[];
  const outcome = { processed: 0, sent: 0, failed: 0 };

  for (const job of claimed) {
    outcome.processed++;

    try {
      if (!job.type.startsWith("email.")) {
        // Tipos futuros (webhook, PDF) entram aqui. Ignorar em silêncio
        // deixaria o job preso em 'processando' para sempre.
        throw new Error(`Tipo de job não suportado: ${job.type}`);
      }

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

      await admin.rpc("complete_outbox_job", { p_id: job.id, p_success: true });
      outcome.sent++;
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
