import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saúde do envio de WhatsApp (API oficial) — para monitoramento externo.
 *
 * 503 quando há mensagem na fila e nenhum worker deu sinal de vida no último
 * minuto: é o caso em que a confirmação deixa de sair sem ninguém perceber.
 * Fila vazia sem worker é 200 — não há nada parado.
 *
 * Protegido pelo mesmo segredo do cron (`x-job-secret`). O corpo traz só
 * números: nenhum telefone, nome ou token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get("x-job-secret") !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();

  const [workers, queue, oldest, connection] = await Promise.all([
    admin
      .from("whatsapp_worker_heartbeats")
      .select("worker_id", { count: "exact", head: true })
      .gte("last_seen_at", since),
    admin
      .from("whatsapp_notifications")
      .select("id", { count: "exact", head: true })
      .in("status", ["pendente", "processando"]),
    admin
      .from("whatsapp_notifications")
      .select("queued_at")
      .eq("status", "pendente")
      .lte("next_attempt_at", new Date().toISOString())
      .order("queued_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("whatsapp_connections")
      .select("paused, paused_reason, breaker_open_until")
      .eq("provider", "meta")
      .limit(1)
      .maybeSingle(),
  ]);

  if (workers.error || queue.error) {
    return NextResponse.json({ ok: false, error: "Banco indisponível." }, { status: 503 });
  }

  const workerCount = workers.count ?? 0;
  const queueSize = queue.count ?? 0;
  const oldestQueuedSeconds = oldest.data?.queued_at
    ? Math.round((Date.now() - new Date(oldest.data.queued_at).getTime()) / 1000)
    : null;
  const ok = !(queueSize > 0 && workerCount === 0);

  return NextResponse.json(
    {
      ok,
      workers: workerCount,
      queue: queueSize,
      oldestQueuedSeconds,
      paused: connection.data?.paused ?? false,
      pausedReason: connection.data?.paused_reason ?? null,
      breakerUntil: connection.data?.breaker_open_until ?? null,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
