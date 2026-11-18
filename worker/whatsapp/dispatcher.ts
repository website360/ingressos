import { hostname } from "node:os";

import type pg from "pg";

import { Breaker } from "../../shared/whatsapp/breaker";
import { metaGraphBase } from "../../shared/whatsapp/meta-api";
import { createPool } from "./db";
import { jsonLogger, type Logger } from "./log";
import { reconcile, type WebhookReprocessor } from "./reconciler";
import { sendNotification, type Notification, type SendOutcome, type TenantConnection } from "./send";

/**
 * Despachante do WhatsApp — o laço do worker.
 *
 * A cada volta, por empresa com Meta ativa:
 *   1. vagas = concorrência configurada − envios em voo;
 *   2. respeita o teto de destinatários únicos em 24 h;
 *   3. retira fichas do limitador GLOBAL (Postgres) — é ele que faz o limite
 *      valer para o número, somando todos os workers;
 *   4. reivindica exatamente esse tanto (SKIP LOCKED) e dispara os envios.
 *
 * Reivindicar no máximo o que cabe em voo significa que nada fica "pego e
 * esperando": parar o worker é só esperar os envios em andamento.
 */
export interface WorkerOptions {
  databaseUrl: string;
  appUrl: string;
  /** URL base da Graph API (com versão). Padrão: META_GRAPH_VERSION. */
  metaBaseUrl?: string;
  workerId?: string;
  pollMs?: number;
  /** Espera quando a fila está vazia (consulta barata, mas o banco é dividido). */
  idlePollMs?: number;
  reconcileEveryMs?: number;
  heartbeatEveryMs?: number;
  staleMs?: number;
  metaTimeoutMs?: number;
  /** Tempo máximo esperando envios em voo ao parar. */
  drainTimeoutMs?: number;
  env?: Record<string, string | undefined>;
  log?: Logger;
  reprocessWebhooks?: WebhookReprocessor;
}

export interface RunningWorker {
  id: string;
  stop(): Promise<void>;
}

interface TenantRow {
  tenant_id: string;
  api_key: string;
  meta_phone_number_id: string | null;
  worker_concurrency: number;
  daily_unique_limit: number;
  paused: boolean;
  paused_reason: string | null;
  breaker_open: boolean;
}

const BREAKER_OPEN_MS = 5 * 60_000;
const MAX_BATCH = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startWorker(opts: WorkerOptions): Promise<RunningWorker> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? jsonLogger;
  const id = opts.workerId ?? `${hostname()}-${process.pid}`;
  const pollMs = opts.pollMs ?? 200;
  const idlePollMs = opts.idlePollMs ?? Math.max(pollMs, 1_000);
  const reconcileEveryMs = opts.reconcileEveryMs ?? 30_000;
  const heartbeatEveryMs = opts.heartbeatEveryMs ?? 10_000;
  const staleMs = opts.staleMs ?? 120_000;
  const metaTimeoutMs = opts.metaTimeoutMs ?? 15_000;
  const metaBaseUrl = opts.metaBaseUrl ?? metaGraphBase(env);

  const db: pg.Pool = createPool(opts.databaseUrl, log, env);

  let running = true;
  let stopping = false;
  const inflight = new Map<string, number>();
  const pending = new Set<Promise<unknown>>();
  const breakers = new Map<string, Breaker>();
  const stats = { aceitas: 0, falhas: 0, incertas: 0, startedAt: new Date().toISOString() };

  let lastReconcile = 0;
  let lastHeartbeat = 0;
  let tenantsCache: { at: number; rows: TenantRow[] } = { at: 0, rows: [] };

  const loadTenants = async (): Promise<TenantRow[]> => {
    if (Date.now() - tenantsCache.at < 1_000) return tenantsCache.rows;
    const { rows } = await db.query<TenantRow>(
      `select tenant_id, api_key, meta_phone_number_id, worker_concurrency, daily_unique_limit,
              paused, paused_reason,
              coalesce(breaker_open_until > now(), false) as breaker_open
         from public.whatsapp_connections
        where provider = 'meta'`,
    );
    tenantsCache = { at: Date.now(), rows };
    return rows;
  };

  const credentials = (t: TenantRow): TenantConnection | null => {
    // Variáveis de ambiente têm precedência sobre o que foi salvo na tela.
    const token = env.META_ACCESS_TOKEN || t.api_key;
    const phoneId = env.META_PHONE_NUMBER_ID || t.meta_phone_number_id;
    if (!token || !phoneId) return null;
    return { tenant_id: t.tenant_id, access_token: token, phone_number_id: phoneId };
  };

  const afterSend = async (tenantId: string, outcome: SendOutcome) => {
    const breaker = breakers.get(tenantId) ?? new Breaker();
    breakers.set(tenantId, breaker);
    const now = Date.now();

    if (outcome === "aceita") {
      stats.aceitas++;
      breaker.record("ok", now);
    } else if (outcome === "recipient_error") {
      stats.falhas++;
      breaker.record("recipient_error", now);
    } else if (outcome === "retry" || outcome === "message_error" || outcome === "incerta") {
      if (outcome === "incerta") stats.incertas++;
      else stats.falhas++;
      breaker.record("error", now);
    }

    if (breaker.shouldOpen(now)) {
      breaker.reset();
      await db.query(`select public.whatsapp_open_breaker($1, $2, $3, false)`, [
        tenantId,
        new Date(now + BREAKER_OPEN_MS),
        "Taxa de erro acima de 20% no último minuto; envios suspensos por 5 minutos.",
      ]);
      tenantsCache.at = 0;
      log("error", "breaker aberto por taxa de erro", { tenant: tenantId });
    }
  };

  const dispatchTenant = async (t: TenantRow): Promise<number> => {
    if (t.paused || t.breaker_open) return 0;
    const conn = credentials(t);
    if (!conn) return 0;

    const busy = inflight.get(t.tenant_id) ?? 0;
    const free = Math.max(0, t.worker_concurrency - busy);
    if (free === 0) return 0;

    // Fila vazia: uma consulta pelo índice e mais nada.
    const due = await db.query(
      `select 1 from public.whatsapp_notifications
        where tenant_id = $1 and status = 'pendente' and next_attempt_at <= now() limit 1`,
      [t.tenant_id],
    );
    if (!due.rowCount) return 0;

    const used = await db.query<{ n: number }>(`select public.whatsapp_unique_recipients_24h($1) as n`, [
      t.tenant_id,
    ]);
    const dailyLeft = t.daily_unique_limit - (used.rows[0]?.n ?? 0) - busy;
    if (dailyLeft <= 0) {
      if (t.paused_reason !== "teto_diario") {
        await db.query(
          `update public.whatsapp_connections set paused_reason = 'teto_diario'
            where tenant_id = $1 and not paused`,
          [t.tenant_id],
        );
        tenantsCache.at = 0;
        log("warn", "teto diário de destinatários atingido; aguardando a janela de 24 h");
      }
      return 0;
    }
    if (t.paused_reason === "teto_diario") {
      await db.query(
        `update public.whatsapp_connections set paused_reason = null
          where tenant_id = $1 and paused_reason = 'teto_diario'`,
        [t.tenant_id],
      );
      tenantsCache.at = 0;
    }

    const want = Math.min(free, MAX_BATCH, dailyLeft);
    const granted = await db.query<{ n: number }>(`select public.whatsapp_take_tokens($1, $2) as n`, [
      t.tenant_id,
      want,
    ]);
    const tokens = granted.rows[0]?.n ?? 0;
    if (tokens <= 0) return 0;

    const claimed = await db.query<Notification>(
      `select id, tenant_id, registration_id, kind, phone_e164, template_id, attempts, params
         from public.claim_whatsapp_notifications($1, $2, $3)`,
      [t.tenant_id, tokens, id],
    );

    for (const n of claimed.rows) {
      inflight.set(t.tenant_id, (inflight.get(t.tenant_id) ?? 0) + 1);
      const job = sendNotification({
        db,
        n,
        conn,
        metaBaseUrl,
        appUrl: opts.appUrl,
        metaTimeoutMs,
        stopping: () => stopping,
        log,
      })
        .then((outcome) => afterSend(t.tenant_id, outcome))
        .catch((error: Error) => {
          // Falha de banco ao gravar: a trava vence e a reconciliação decide.
          log("error", "erro no envio; a reconciliação vai tratar", {
            id: n.id,
            error: error.message,
          });
        })
        .finally(() => {
          inflight.set(t.tenant_id, (inflight.get(t.tenant_id) ?? 1) - 1);
          pending.delete(job);
        });
      pending.add(job);
    }
    return claimed.rows.length;
  };

  const tick = async () => {
    const now = Date.now();
    if (now - lastHeartbeat >= heartbeatEveryMs) {
      lastHeartbeat = now;
      const cpu = process.cpuUsage();
      await db.query(`select public.whatsapp_heartbeat($1, $2)`, [
        id,
        JSON.stringify({
          ...stats,
          emVoo: pending.size,
          rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
          cpuMs: Math.round((cpu.user + cpu.system) / 1000),
        }),
      ]);
    }
    if (now - lastReconcile >= reconcileEveryMs) {
      lastReconcile = now;
      await reconcile(db, staleMs, log, opts.reprocessWebhooks);
    }
    let started = 0;
    for (const t of await loadTenants()) started += await dispatchTenant(t);
    return started;
  };

  const loop = (async () => {
    let failures = 0;
    log("info", "worker do WhatsApp iniciado", { worker: id });
    while (running) {
      try {
        const started = await tick();
        failures = 0;
        await sleep(started > 0 ? Math.min(pollMs, 50) : pending.size > 0 ? pollMs : idlePollMs);
      } catch (error) {
        failures++;
        const wait = Math.min(30_000, 500 * 2 ** Math.min(failures, 6));
        log("error", "falha no laço do worker; tentando de novo", {
          error: (error as Error).message,
          waitMs: wait,
        });
        await sleep(wait);
      }
    }
  })();

  return {
    id,
    async stop() {
      if (!running) return;
      stopping = true;
      running = false;
      await loop;
      const drained = Promise.allSettled([...pending]);
      await Promise.race([drained, sleep(opts.drainTimeoutMs ?? 20_000)]);
      await db
        .query(`delete from public.whatsapp_worker_heartbeats where worker_id = $1`, [id])
        .catch(() => undefined);
      await db.end();
      log("info", "worker do WhatsApp parado", { worker: id });
    },
  };
}
