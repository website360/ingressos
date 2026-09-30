import type { EmailStatus, Views } from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type MessageLogRow = Views<"v_message_log">;

export interface MessageLogFilters {
  channel?: "email" | "whatsapp";
  status?: EmailStatus;
  eventId?: string;
  /** Busca no destinatário (e-mail ou telefone). */
  search?: string;
  limit?: number;
}

/**
 * Log de envios dos dois canais.
 *
 * Lê a view `v_message_log`, que é `security_invoker` — a RLS das tabelas base
 * continua valendo, e quem não tem `settings.read` simplesmente não vê linha
 * nenhuma.
 */
export class MessageRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  async list(filters: MessageLogFilters = {}): Promise<MessageLogRow[]> {
    let query = this.client
      .from("v_message_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 200);

    if (filters.channel) query = query.eq("channel", filters.channel);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.eventId) query = query.eq("event_id", filters.eventId);
    if (filters.search) query = query.ilike("recipient", `%${filters.search}%`);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Quantas mensagens de WhatsApp já saíram hoje.
   *
   * Alimenta a estimativa do botão de reenvio: o que resta do teto diário é o
   * que ainda cabe hoje. O dia é o do fuso da empresa, calculado por quem
   * chama — aqui só se aplica o corte.
   */
  async sentSince(channel: "email" | "whatsapp", since: string): Promise<number> {
    const { count, error } = await this.client
      .from("v_message_log")
      .select("id", { count: "exact", head: true })
      .eq("channel", channel)
      .eq("status", "enviado")
      .gte("sent_at", since);

    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Recoloca na fila os jobs indicados.
   *
   * A RPC é `security definer` e checa `settings.manage` por dentro, então o
   * client do usuário é o certo aqui: quem autoriza é o banco, não a camada
   * de aplicação.
   */
  async retry(jobIds: string[]): Promise<number> {
    const { data, error } = await this.client.rpc("retry_messages", { p_job_ids: jobIds });
    if (error) throw error;
    return (data as { requeued?: number } | null)?.requeued ?? 0;
  }
}
