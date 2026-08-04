import type {
  EventStatus,
  Tables,
  TablesInsert,
  TablesUpdate,
  Views,
} from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type Event = Tables<"events">;
export type EventStats = Views<"v_event_stats">;
export type Category = Tables<"categories">;

export interface EventFilters {
  q?: string;
  status?: EventStatus;
  categoryId?: string;
  /** Recorte por data de início — usado pelo relatório. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export class EventRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  async list(filters: EventFilters = {}): Promise<{ items: EventStats[]; total: number }> {
    const limit = filters.limit ?? 50;

    let query = this.client
      .from("v_event_stats")
      .select("*", { count: "exact" })
      .order("starts_at", { ascending: false })
      .range(filters.offset ?? 0, (filters.offset ?? 0) + limit - 1);

    if (filters.q) query = query.ilike("name", `%${filters.q}%`);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.from) query = query.gte("starts_at", filters.from);
    if (filters.to) query = query.lte("starts_at", filters.to);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: data ?? [], total: count ?? 0 };
  }

  /** Eventos para popular seletores — só o essencial. */
  async listOptions(): Promise<Pick<Event, "id" | "name" | "starts_at" | "status">[]> {
    return this.unwrap(
      await this.client
        .from("events")
        .select("id, name, starts_at, status")
        .is("deleted_at", null)
        .order("starts_at", { ascending: false })
        .limit(200),
    );
  }

  async findById(id: string): Promise<Event> {
    return this.unwrap(await this.client.from("events").select("*").eq("id", id).single());
  }

  async stats(id: string): Promise<EventStats | null> {
    return this.unwrapMaybe(
      await this.client.from("v_event_stats").select("*").eq("event_id", id).maybeSingle(),
    );
  }

  async create(payload: TablesInsert<"events">): Promise<Event> {
    return this.unwrap(await this.client.from("events").insert(payload).select("*").single());
  }

  async update(id: string, patch: TablesUpdate<"events">): Promise<Event> {
    return this.unwrap(
      await this.client.from("events").update(patch).eq("id", id).select("*").single(),
    );
  }

  /** RN-10: evento com inscrições nunca é apagado, apenas arquivado. */
  async archive(id: string): Promise<void> {
    const { error } = await this.client
      .from("events")
      .update({ deleted_at: new Date().toISOString(), status: "encerrado" })
      .eq("id", id);
    if (error) throw error;
  }

  // ---------------------------------------------------------------------------
  // Conteúdo da landing
  //
  // A gravação é "substitui tudo": apaga as linhas do evento e insere a lista
  // nova. É o que corresponde à edição real — o organizador reordena, remove e
  // adiciona itens numa sessão só. Fazer diff item a item traria complexidade
  // sem benefício para um conteúdo editado por uma pessoa de cada vez.
  // ---------------------------------------------------------------------------
  async listContent(eventId: string) {
    const [schedule, speakers, faqs, documents] = await Promise.all([
      this.client
        .from("event_schedule_items")
        .select("*")
        .eq("event_id", eventId)
        .order("position"),
      this.client.from("event_speakers").select("*").eq("event_id", eventId).order("position"),
      this.client.from("event_faqs").select("*").eq("event_id", eventId).order("position"),
      this.client.from("event_documents").select("*").eq("event_id", eventId),
    ]);

    return {
      schedule: schedule.data ?? [],
      speakers: speakers.data ?? [],
      faqs: faqs.data ?? [],
      documents: documents.data ?? [],
    };
  }

  async replaceContent(
    table: "event_schedule_items" | "event_speakers" | "event_faqs",
    eventId: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    const { error: deleteError } = await this.client.from(table).delete().eq("event_id", eventId);
    if (deleteError) throw deleteError;

    if (rows.length === 0) return;

    const { error } = await this.client.from(table).insert(rows as never);
    if (error) throw error;
  }

  /**
   * Documento versionado: cada gravação cria uma versão nova em vez de
   * sobrescrever. O aceite do participante aponta para a versão exata que ele
   * leu — reescrever o texto apagaria a prova do consentimento (RF-05.4).
   */
  async publishDocument(
    tenantId: string,
    eventId: string,
    documentType: string,
    content: string,
  ): Promise<void> {
    const { data: latest } = await this.client
      .from("event_documents")
      .select("version, content")
      .eq("event_id", eventId)
      .eq("document_type", documentType)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Texto idêntico não gera versão nova.
    if (latest?.content === content) return;

    const { error } = await this.client.from("event_documents").insert({
      tenant_id: tenantId,
      event_id: eventId,
      document_type: documentType,
      version: (latest?.version ?? 0) + 1,
      content,
    });
    if (error) throw error;
  }

  async uploadImage(path: string, file: File): Promise<string> {
    const { error } = await this.client.storage
      .from("event-banners")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (error) throw error;

    const { data } = this.client.storage.from("event-banners").getPublicUrl(path);
    return data.publicUrl;
  }

  async listCategories(): Promise<Category[]> {
    return this.unwrap(await this.client.from("categories").select("*").order("position"));
  }
}
