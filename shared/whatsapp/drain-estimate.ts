const DAY = 86_400;

/**
 * Em quantos segundos a fila esvazia, na vazão observada.
 *
 * O teto da Meta é de destinatários únicos numa janela de 24 h. O que não
 * cabe no que resta da janela atual espera as próximas janelas — uma conta
 * aproximada (assume que a janela libera de uma vez), mas honesta sobre a
 * ordem de grandeza: "~20 min" e "~3 dias" são decisões diferentes.
 */
export function estimateDrainSeconds(
  queue: number,
  ratePerSec: number,
  dailyRemaining: number,
  dailyLimit: number,
): number | null {
  if (queue <= 0) return 0;
  if (!(ratePerSec > 0)) return null;

  const remaining = Math.max(0, dailyRemaining);
  if (queue <= remaining) return Math.round(queue / ratePerSec);

  const rest = queue - remaining;
  const limit = Math.max(1, dailyLimit);
  const days = Math.ceil(rest / limit);
  const lastChunk = rest - (days - 1) * limit;
  return days * DAY + Math.round(lastChunk / ratePerSec);
}
