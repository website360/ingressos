const BASE_SECONDS = 30;
const CAP_SECONDS = 15 * 60;

/**
 * Próxima tentativa: 30 s × 2^tentativa — 60 s, 120 s, 240 s depois das
 * tentativas 1, 2, 3 — com teto de 15 min e jitter de 0,5× a 1,5×,
 * para mil falhas simultâneas não voltarem todas no mesmo segundo.
 */
export function nextRetryAt(attempt: number, now: Date, rand: () => number = Math.random): Date {
  const base = Math.min(BASE_SECONDS * 2 ** Math.max(attempt, 0), CAP_SECONDS);
  const jitter = 0.5 + Math.min(Math.max(rand(), 0), 1);
  return new Date(now.getTime() + Math.round(base * jitter * 1000));
}
