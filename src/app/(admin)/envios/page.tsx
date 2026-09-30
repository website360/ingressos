import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MessageLog } from "@/features/envios/components/message-log";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Envios" };
export const dynamic = "force-dynamic";

/**
 * Log dos dois canais, com reenvio do que falhou.
 *
 * `force-dynamic` porque a lista muda a cada rodada do cron — uma página de
 * acompanhamento servida do cache mostraria um passado tranquilizador.
 */
export default async function EnviosPage() {
  const session = await requirePermission(PERMISSIONS.SETTINGS_READ);
  const { messages, whatsapp } = await getRepositories();

  // Início do dia no fuso da empresa — é o recorte do teto diário, e em UTC a
  // virada cairia às 21h. O Brasil não tem mais horário de verão, então o
  // deslocamento fixo de -03:00 vale o ano todo e evita depender do fuso do
  // processo, que num servidor é UTC.
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const inicioDoDia = new Date(`${dia}T00:00:00-03:00`).toISOString();

  const [rows, connection, sentToday] = await Promise.all([
    messages.list({ limit: 200 }).catch(() => []),
    whatsapp.find(session.activeTenantId!).catch(() => null),
    messages.sentSince("whatsapp", inicioDoDia).catch(() => 0),
  ]);

  const pacing = {
    intervalSeconds: connection?.send_interval_seconds ?? 20,
    dailyLimit: connection?.daily_send_limit ?? 300,
    sentToday,
  };

  // Eventos presentes no log, para o filtro — sem consulta extra.
  const events = [
    ...new Map(
      rows
        .filter((r) => r.event_id && r.event_name)
        .map((r) => [r.event_id!, { id: r.event_id!, name: r.event_name! }]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <>
      <PageHeader
        title="Envios"
        description="Tudo que saiu por e-mail e WhatsApp, com reenvio do que falhou."
      />

      <MessageLog
        rows={rows}
        pacing={pacing}
        events={events}
        canRetry={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
      />
    </>
  );
}
