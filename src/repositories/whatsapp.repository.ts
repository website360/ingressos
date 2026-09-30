import type { Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type WhatsappConnection = Tables<"whatsapp_connections">;
export type WhatsappMessage = Tables<"whatsapp_messages">;

/**
 * O que o painel pode ler. `api_key` e `instance_token` estão fora: a coluna
 * não é legível por `authenticated` (ver a migration 20260801093100), então
 * pedi-las devolveria erro de permissão, não `null`.
 */
export type WhatsappConnectionView = Omit<WhatsappConnection, "api_key" | "instance_token">;

const VISIBLE = [
  "tenant_id",
  "base_url",
  "api_key_hint",
  "server_version",
  "webhook_dialect",
  "instance_name",
  "state",
  "phone_number",
  "qr_code",
  "qr_expires_at",
  "last_connected_at",
  "last_error",
  "created_at",
  "updated_at",
  "updated_by",
].join(", ");

export class WhatsappRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  /** Conexão sem os segredos — é o que a tela usa. */
  async find(tenantId: string): Promise<WhatsappConnectionView | null> {
    return this.unwrapMaybe(
      await this.client
        .from("whatsapp_connections")
        .select(VISIBLE)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ) as WhatsappConnectionView | null;
  }

  /**
   * Conexão COM os segredos. Só funciona com o client de service role: com o
   * client do usuário, o Postgres recusa a leitura das colunas. É essa recusa
   * — e não uma convenção de código — que impede a chave de chegar à tela.
   */
  async findWithSecret(tenantId: string): Promise<WhatsappConnection | null> {
    return this.unwrapMaybe(
      await this.client
        .from("whatsapp_connections")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    );
  }

  async upsert(row: TablesInsert<"whatsapp_connections">): Promise<void> {
    const { error } = await this.client
      .from("whatsapp_connections")
      .upsert(row, { onConflict: "tenant_id" });
    if (error) throw error;
  }

  async update(tenantId: string, patch: TablesUpdate<"whatsapp_connections">): Promise<void> {
    const { error } = await this.client
      .from("whatsapp_connections")
      .update(patch)
      .eq("tenant_id", tenantId);
    if (error) throw error;
  }

  async remove(tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("whatsapp_connections")
      .delete()
      .eq("tenant_id", tenantId);
    if (error) throw error;
  }

  async listMessages(limit = 20): Promise<WhatsappMessage[]> {
    const { data, error } = await this.client
      .from("whatsapp_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
}
