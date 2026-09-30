import { NextResponse, type NextRequest } from "next/server";

import {
  sendEmailJob,
  sendWhatsappJob,
  type Admin,
  type OutboxJob,
  type WhatsappConnection,
} from "@/lib/outbox/channels";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Worker da fila de efeitos colaterais (ADR-003).
 *
 * Disparado por cron a cada minuto. Pega um lote com trava, processa e devolve
 * o resultado — falha vira retry com backoff exponencial, e depois de 5
 * tentativas o job para na DLQ, visível em tela.
 *
 * Dois canais, dois tipos de job: `email.*` e `whatsapp.*`, independentes.
 *
 * ## Ritmo do WhatsApp
 *
 * O espaçamento entre mensagens é gravado no `run_at` de cada job, pelo
 * alocador de slots do banco — então, em regime, poucos jobs de WhatsApp estão
 * vencidos a cada rodada. Mas o cron acorda de minuto em minuto: com intervalo
 * de 20s, três jobs vencem juntos, e disparar os três colados seria a rajada
 * que o espaçamento existe para evitar.
 *
 * Por isso a rodada também espera entre um envio e o próximo, dentro de um
 * orçamento de tempo que termina antes do tick seguinte. O que não couber volta
 * para a fila sem gastar tentativa.
 *
 * Protegido por segredo compartilhado: escreve no banco com service role.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;

/**
 * Teto de tempo da rodada. O cron roda a cada 60s; parar aos 45 deixa margem
 * para o último envio terminar sem duas rodadas se atropelarem.
 */
const RUN_BUDGET_MS = 45_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Conexão de WhatsApp da empresa, uma leitura por rodada. */
function connectionLoader(admin: Admin) {
  const cache = new Map<string, WhatsappConnection | null>();

  return async (tenantId: string): Promise<WhatsappConnection | null> => {
    if (!cache.has(tenantId)) {
      const { data } = await admin
        .from("whatsapp_connections")
        .select(
          "base_url, api_key, instance_name, instance_token, state, send_interval_seconds, daily_send_limit",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle();
      cache.set(tenantId, data);
    }
    return cache.get(tenantId)!;
  };
}

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const provided =
    request.headers.get("x-job-secret") ?? request.nextUrl.searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = Date.now();
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
  const outcome = { processed: 0, email: 0, whatsapp: 0, failed: 0, adiados: 0 };

  const finish = async (job: OutboxJob, ok: boolean, message?: string) => {
    await admin.rpc("complete_outbox_job", {
      p_id: job.id,
      p_success: ok,
      ...(ok ? {} : { p_error: (message ?? "").slice(0, 500) }),
    });
  };

  // E-mail primeiro: é rápido, não tem ritmo a respeitar, e assim o orçamento
  // de tempo da rodada fica inteiro para o WhatsApp.
  const emailJobs = claimed.filter((j) => j.type.startsWith("email."));
  const whatsappJobs = claimed.filter((j) => j.type.startsWith("whatsapp."));
  const unknownJobs = claimed.filter(
    (j) => !j.type.startsWith("email.") && !j.type.startsWith("whatsapp."),
  );

  for (const job of emailJobs) {
    outcome.processed++;
    try {
      await sendEmailJob(admin, job, appUrl);
      await finish(job, true);
      outcome.email++;
    } catch (jobError) {
      await finish(job, false, jobError instanceof Error ? jobError.message : String(jobError));
      outcome.failed++;
    }
  }

  let lastSentAt = 0;

  for (const job of whatsappJobs) {
    const connection = job.tenant_id ? await loadConnection(job.tenant_id) : null;
    const intervalMs = (connection?.send_interval_seconds ?? 20) * 1000;
    const waitMs = lastSentAt === 0 ? 0 : Math.max(0, intervalMs - (Date.now() - lastSentAt));

    // Não cabe mais nesta rodada: devolve sem gastar tentativa. O `run_at` do
    // job já garante a vez dele; a próxima rodada o encontra.
    if (Date.now() - startedAt + waitMs > RUN_BUDGET_MS) {
      await admin.rpc("release_outbox_job", { p_id: job.id });
      outcome.adiados++;
      continue;
    }

    if (waitMs > 0) await sleep(waitMs);

    outcome.processed++;
    lastSentAt = Date.now();

    try {
      await sendWhatsappJob(admin, job, appUrl, connection);
      await finish(job, true);
      outcome.whatsapp++;
    } catch (jobError) {
      await finish(job, false, jobError instanceof Error ? jobError.message : String(jobError));
      outcome.failed++;
    }
  }

  for (const job of unknownJobs) {
    // Ignorar em silêncio deixaria o job preso em 'processando' para sempre.
    outcome.processed++;
    await finish(job, false, `Tipo de job não suportado: ${job.type}`);
    outcome.failed++;
  }

  return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
}
