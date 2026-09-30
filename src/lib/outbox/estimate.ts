/**
 * Quanto tempo um lote de mensagens leva para sair, no ritmo configurado.
 *
 * A tela de envios usa isto para o botão de reenviar dizer o tamanho do
 * estrago antes de você clicar — "reenviar 183 · termina em ~1h" é uma
 * informação diferente de "reenviar 183".
 *
 * Função pura, sem `server-only`: o teste unitário importa daqui, e a tela
 * também (o cálculo roda no cliente, sem ida ao servidor).
 */

export interface PacingConfig {
  /** Segundos entre uma mensagem e a próxima. */
  intervalSeconds: number;
  /** Máximo de mensagens por dia. */
  dailyLimit: number;
  /** Quantas já saíram hoje — o que sobra do teto é o que cabe hoje. */
  sentToday: number;
}

export interface Estimate {
  /** Quantas saem ainda hoje. */
  today: number;
  /** Quantas ficam para os próximos dias. */
  deferred: number;
  /** Dias adicionais necessários (0 se tudo sai hoje). */
  extraDays: number;
  /** Duração do que sai hoje, em segundos. */
  todaySeconds: number;
}

export function estimateBatch(count: number, pacing: PacingConfig): Estimate {
  const total = Math.max(0, Math.trunc(count));
  const remainingToday = Math.max(0, pacing.dailyLimit - Math.max(0, pacing.sentToday));

  const today = Math.min(total, remainingToday);
  const deferred = total - today;

  // A primeira sai imediatamente; o intervalo só existe ENTRE mensagens. Com
  // uma única mensagem a duração é zero, não um intervalo.
  const todaySeconds = today > 1 ? (today - 1) * pacing.intervalSeconds : 0;

  const extraDays = deferred > 0 ? Math.ceil(deferred / Math.max(1, pacing.dailyLimit)) : 0;

  return { today, deferred, extraDays, todaySeconds };
}

/** "~1h20" / "~45min" / "imediato" — texto curto para caber num botão. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "imediato";
  if (seconds < 60) return `~${Math.round(seconds)}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes}min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours}h` : `~${hours}h${String(rest).padStart(2, "0")}`;
}

/** Frase completa para o botão de reenvio. */
export function describeBatch(count: number, pacing: PacingConfig): string {
  if (count <= 0) return "Nenhuma mensagem selecionada";

  const { today, deferred, extraDays, todaySeconds } = estimateBatch(count, pacing);
  const plural = count === 1 ? "mensagem" : "mensagens";

  if (deferred === 0) {
    return `Reenviar ${count} ${plural} · ${formatDuration(todaySeconds)}`;
  }

  if (today === 0) {
    return `Reenviar ${count} ${plural} · teto diário atingido, começa amanhã`;
  }

  const dias = extraDays === 1 ? "mais 1 dia" : `mais ${extraDays} dias`;
  return `Reenviar ${count} ${plural} · ${today} hoje (${formatDuration(todaySeconds)}), ${deferred} em ${dias}`;
}
