import type pg from "pg";

/**
 * Reprocessa eventos de webhook que a rota gravou mas não conseguiu processar
 * (o processamento em si é a função `whatsapp_reprocess_webhooks`, no banco).
 */
export async function reprocessPendingWebhooks(db: pg.Pool): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select public.whatsapp_reprocess_webhooks(200) as n`);
  return rows[0]?.n ?? 0;
}
