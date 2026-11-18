import type pg from "pg";

/**
 * Reprocessamento de eventos de webhook que falharam ao processar.
 *
 * O processamento em si vive em `shared/whatsapp/webhook-processor.ts`
 * (Tarefa 7). Até lá, nada a reprocessar.
 */
export async function reprocessPendingWebhooks(_db: pg.Pool): Promise<number> {
  return 0;
}
