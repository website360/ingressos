import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saúde do envio de WhatsApp (API oficial) — para monitoramento externo.
 *
 * 503 quando:
 *  - há mensagem na fila e nenhum worker deu sinal de vida no último minuto;
 *  - a mensagem mais antiga pronta para sair espera há mais de 15 min, ou
 *    alguma está presa em "processando" há mais de 5 min — sem pausa feita
 *    por uma pessoa;
 *  - o próprio sistema pausou (erro sistêmico: token, modelo, conta) ou o
 *    breaker por taxa de erro está aberto;
 *  - alguma consulta falhou (não dá para afirmar que está tudo bem).
 * Fila vazia sem worker é 200 — não há nada parado. Pausa feita no painel é
 * 200, com `paused: true`: foi decisão de alguém, e só vale se TODAS as
 * conexões estiverem pausadas assim.
 *
 * Protegido pelo segredo do cron (`x-job-secret`, comparado em tempo
 * constante). O corpo traz só números e booleanos: nenhum telefone, nome,
 * token ou texto livre.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALLED_AFTER_S = 15 * 60;
const STUCK_PROCESSING_MS = 5 * 60_000;

function authorized(provided: string | null, secret: string | undefined): boolean {
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("x-job-secret"), process.env.REVALIDATE_SECRET)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();

  const [workers, queue, oldest, stuck, connections] = await Promise.all([
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
      .from("whatsapp_notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "processando")
      .lt("locked_at", new Date(Date.now() - STUCK_PROCESSING_MS).toISOString()),
    admin
      .from("whatsapp_connections")
      .select("paused, breaker_manual, breaker_open_until")
      .eq("provider", "meta"),
  ]);

  if (workers.error || queue.error || oldest.error || stuck.error || connections.error) {
    return NextResponse.json(
      { ok: false, error: "Banco indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const workerCount = workers.count ?? 0;
  const queueSize = queue.count ?? 0;
  const oldestQueuedSeconds = oldest.data?.queued_at
    ? Math.round((Date.now() - new Date(oldest.data.queued_at).getTime()) / 1000)
    : null;
  const rows = connections.data ?? [];
  // Pausa de pessoa: pausada e NÃO pelo breaker manual do sistema.
  const pausedByPerson = rows.length > 0 && rows.every((c) => c.paused && !c.breaker_manual);
  const systemPaused = rows.some((c) => c.paused && c.breaker_manual);
  const breakerOpen = rows.some(
    (c) => c.breaker_open_until && new Date(c.breaker_open_until).getTime() > Date.now(),
  );

  const noWorker = queueSize > 0 && workerCount === 0;
  const stalled =
    !pausedByPerson &&
    ((oldestQueuedSeconds ?? 0) > STALLED_AFTER_S || (stuck.count ?? 0) > 0);
  const ok = !noWorker && !stalled && !systemPaused && !breakerOpen;

  return NextResponse.json(
    {
      ok,
      workers: workerCount,
      queue: queueSize,
      oldestQueuedSeconds,
      paused: pausedByPerson || systemPaused,
      systemPaused,
      breakerOpen,
      stalled,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
