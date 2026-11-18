import type { QueueStats } from "@/features/envios/lib/queue-format";

import { BaseRepository, type Client } from "./base.repository";

export interface QueueFilters {
  eventId?: string | null;
  /** ISO. */
  from?: string | null;
  to?: string | null;
  status?: string | null;
}

export interface QueueRow {
  id: string;
  kind: string;
  status: string;
  block_reason: string | null;
  phone_e164: string | null;
  attempts: number;
  last_error: string | null;
  last_error_code: number | null;
  created_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  event_name: string | null;
}

const STATUSES = [
  "pendente",
  "processando",
  "aceita",
  "enviada",
  "entregue",
  "lida",
  "falhou",
  "cancelada",
  "incerta",
  "bloqueada",
] as const;

export type QueueStatus = (typeof STATUSES)[number];

export function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/**
 * Fila do WhatsApp (Meta) — leitura e ações do painel.
 *
 * Roda com o client do USUÁRIO: as RPCs são `security definer` e conferem
 * `settings.read` / `settings.manage` por dentro, e a lista passa pela RLS.
 */
export class WhatsappQueueRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  async stats(filters: QueueFilters): Promise<QueueStats> {
    const { data, error } = await this.client.rpc("whatsapp_queue_stats", {
      p_event: filters.eventId ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
    });
    if (error) throw error;
    return data as unknown as QueueStats;
  }

  /** Últimas notificações do recorte — telefone sai mascarado na tela. */
  async list(filters: QueueFilters, limit = 50): Promise<QueueRow[]> {
    let query = this.client
      .from("whatsapp_notifications")
      .select(
        "id, kind, status, block_reason, phone_e164, attempts, last_error, last_error_code, created_at, accepted_at, delivered_at, read_at, events(name)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filters.eventId) query = query.eq("event_id", filters.eventId);
    if (filters.from) query = query.gte("created_at", filters.from);
    if (filters.to) query = query.lt("created_at", filters.to);
    if (isQueueStatus(filters.status)) query = query.eq("status", filters.status);

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((row) => {
      const { events, ...rest } = row as typeof row & { events: { name: string } | null };
      return { ...rest, event_name: events?.name ?? null } as QueueRow;
    });
  }

  async setPaused(paused: boolean, reason: string | null): Promise<void> {
    const { error } = await this.client.rpc("whatsapp_set_paused", {
      p_paused: paused,
      p_reason: reason,
    });
    if (error) throw error;
  }

  async cancelPending(filters: QueueFilters): Promise<number> {
    const { data, error } = await this.client.rpc("whatsapp_cancel_pending", {
      p_event: filters.eventId ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  async retry(filters: QueueFilters, includeUncertain: boolean): Promise<number> {
    const { data, error } = await this.client.rpc("whatsapp_retry", {
      p_event: filters.eventId ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_include_uncertain: includeUncertain,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  async updateCapacity(rate: number, daily: number, concurrency: number): Promise<void> {
    const { error } = await this.client.rpc("whatsapp_update_capacity", {
      p_rate: rate,
      p_daily: daily,
      p_concurrency: concurrency,
    });
    if (error) throw error;
  }
}
