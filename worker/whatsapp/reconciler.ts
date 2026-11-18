import type pg from "pg";

import type { Logger } from "./log";

/** Chave da trava consultiva: só um worker reconcilia por vez. */
const LOCK_KEY = 728_431_001;

export type WebhookReprocessor = (db: pg.Pool) => Promise<number>;

/**
 * Manutenção periódica:
 * - travas abandonadas (worker morto) → pendente ou incerta;
 * - eventos de webhook que falharam ao processar → reprocessa;
 * - eventos crus com mais de 7 dias → apaga (têm telefone dentro).
 *
 * A trava consultiva é de SESSÃO: pega uma conexão do pool e a segura até o
 * fim, para o unlock acontecer na mesma sessão do lock.
 */
export async function reconcile(
  db: pg.Pool,
  staleMs: number,
  log: Logger,
  reprocessWebhooks?: WebhookReprocessor,
): Promise<void> {
  const client = await db.connect();
  let locked = false;
  try {
    const { rows } = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock($1) as ok`, [
      LOCK_KEY,
    ]);
    locked = rows[0]?.ok === true;
    if (!locked) return;

    const result = await client.query<{ r: { requeued: number; uncertain: number } }>(
      `select public.reconcile_whatsapp(make_interval(secs => $1)) as r`,
      [staleMs / 1000],
    );
    const r = result.rows[0]?.r;
    if (r && (r.requeued > 0 || r.uncertain > 0)) {
      log("warn", "travas abandonadas reconciliadas", r);
    }

    if (reprocessWebhooks) {
      const n = await reprocessWebhooks(db);
      if (n > 0) log("info", "eventos de webhook reprocessados", { count: n });
    }

    await client.query(
      `delete from public.whatsapp_webhook_events
        where id in (select id from public.whatsapp_webhook_events
                      where received_at < now() - interval '7 days' limit 5000)`,
    );
  } finally {
    if (locked) await client.query(`select pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
