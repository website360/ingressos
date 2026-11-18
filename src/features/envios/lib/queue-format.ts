/**
 * Os números da fila do WhatsApp, prontos para a tela.
 *
 * Função pura sobre o retorno de `whatsapp_queue_stats`: o painel atualiza a
 * cada 5 s e só reformata — e o teste cobre os casos chatos (nada enviado
 * ainda, fila parada, teto atingido) sem precisar de banco.
 */
import { estimateDrainSeconds } from "@shared/whatsapp/drain-estimate";

import { formatDuration } from "@/lib/outbox/estimate";

export interface QueueStats {
  por_status: Partial<Record<string, number>>;
  em_fila: number;
  agendadas: number;
  tamanho_fila: number;
  marcos: { aceitas: number; enviadas: number; entregues: number; lidas: number };
  taxa_1min: number;
  taxa_5min: number;
  idade_mais_antiga_s: number | null;
  inscricoes: number;
  destinatarios_24h: number;
  teto_diario: number;
  vazao_configurada: number;
  concorrencia: number;
  pausado: boolean;
  motivo: string | null;
  breaker_ate: string | null;
  breaker_manual: boolean;
  qualidade: string | null;
  nivel: string | null;
  workers: number;
  gerado_em: string;
}

export interface QueueView {
  deliveryPct: string;
  failurePct: string;
  speed: string;
  oldest: string;
  drain: string;
  daily: string;
  alerts: string[];
}

const pct = (part: number, total: number) =>
  total > 0
    ? `${((part / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : "—";

const int = (n: number) => n.toLocaleString("pt-BR");

function shortAge(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatDuration(seconds).replace(/^~/, "");
}

export function queueView(stats: QueueStats): QueueView {
  const accepted = stats.marcos.aceitas;
  const failed = stats.por_status.falhou ?? 0;
  const attempted = accepted + failed;

  const speed =
    stats.taxa_1min > 0
      ? `${stats.taxa_1min.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} msg/s`
      : "0 msg/s";

  const remaining = Math.max(0, stats.teto_diario - stats.destinatarios_24h);
  const seconds = estimateDrainSeconds(
    stats.tamanho_fila,
    stats.taxa_5min,
    remaining,
    stats.teto_diario,
  );
  const drain =
    stats.tamanho_fila === 0
      ? "fila vazia"
      : seconds === null
        ? "sem vazão para estimar"
        : formatDuration(seconds);

  const alerts: string[] = [];
  if (stats.pausado) alerts.push(`Envios pausados: ${stats.motivo ?? "pelo painel"}`);
  if (!stats.pausado && stats.breaker_ate && new Date(stats.breaker_ate) > new Date(stats.gerado_em)) {
    alerts.push(
      `Envios suspensos por excesso de erros até ${new Date(stats.breaker_ate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}.`,
    );
  }
  if (!stats.pausado && stats.motivo === "teto_diario") {
    alerts.push(
      "Teto diário de destinatários atingido: a fila volta a andar quando a janela de 24 h liberar.",
    );
  }
  if (stats.workers === 0 && stats.tamanho_fila > 0) {
    alerts.push("Nenhum worker ativo: as mensagens não estão saindo.");
  }

  return {
    deliveryPct: pct(stats.marcos.entregues, accepted),
    failurePct: pct(failed, attempted),
    speed,
    oldest: shortAge(stats.idade_mais_antiga_s),
    drain,
    daily: `${int(stats.destinatarios_24h)} de ${int(stats.teto_diario)}`,
    alerts,
  };
}
