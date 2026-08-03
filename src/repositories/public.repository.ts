import { createPublicClient } from "@/lib/supabase/public";
import type { Tables } from "@/lib/supabase/database.types";

export type PublicEvent = Tables<"events">;

export interface EventLandingData {
  event: PublicEvent;
  schedule: Tables<"event_schedule_items">[];
  speakers: Tables<"event_speakers">[];
  faqs: Tables<"event_faqs">[];
  documents: Tables<"event_documents">[];
}

/**
 * Leitura da área pública. Usa o client sem cookies e depende exclusivamente
 * das políticas de RLS para `anon`: só evento publicado é visível.
 */
export const publicRepository = {
  async findEventBySlug(slug: string): Promise<PublicEvent | null> {
    const client = createPublicClient();
    const { data } = await client
      .from("events")
      .select("*")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();
    return data;
  },

  /** Slug antigo continua funcionando: retorna o novo para redirect 301. */
  async resolveOldSlug(slug: string): Promise<string | null> {
    const client = createPublicClient();
    const { data } = await client
      .from("event_slug_history")
      .select("event_id")
      .eq("old_slug", slug)
      .maybeSingle();

    if (!data) return null;

    const { data: event } = await client
      .from("events")
      .select("slug")
      .eq("id", data.event_id)
      .maybeSingle();

    return event?.slug ?? null;
  },

  async landing(slug: string): Promise<EventLandingData | null> {
    const event = await this.findEventBySlug(slug);
    if (!event) return null;

    const client = createPublicClient();
    const [schedule, speakers, faqs, documents] = await Promise.all([
      client.from("event_schedule_items").select("*").eq("event_id", event.id).order("position"),
      client.from("event_speakers").select("*").eq("event_id", event.id).order("position"),
      client.from("event_faqs").select("*").eq("event_id", event.id).order("position"),
      client.from("event_documents").select("*").eq("event_id", event.id),
    ]);

    return {
      event,
      schedule: schedule.data ?? [],
      speakers: speakers.data ?? [],
      faqs: faqs.data ?? [],
      documents: documents.data ?? [],
    };
  },

  /**
   * Disponibilidade ao vivo. Fica FORA do cache da landing de propósito: um
   * contador de vagas desatualizado leva a pessoa a preencher o formulário
   * inteiro e perder a vaga no fim (ADR-006).
   */
  async availability(eventId: string) {
    const client = createPublicClient();
    const { data } = await client
      .from("v_event_stats")
      .select("capacity, seats_taken, seats_available, status")
      .eq("event_id", eventId)
      .maybeSingle();

    return data;
  },

  /**
   * Eventos já realizados — o histórico exibido na raiz do site.
   *
   * Inclui `encerrado` além de `publicado`: um evento que passou costuma ter o
   * status alterado depois, e filtrar só por `publicado` esconderia justamente
   * as edições mais antigas, que são as que dão credibilidade à página.
   */
  async listPastEvents(limit = 12) {
    const client = createPublicClient();
    const { data } = await client
      .from("events")
      .select("*")
      .in("status", ["publicado", "encerrado"])
      .is("deleted_at", null)
      .lt("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  },

  async listPublishedEvents(limit = 24) {
    const client = createPublicClient();
    const { data } = await client
      .from("events")
      .select("*")
      .eq("status", "publicado")
      .is("deleted_at", null)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(limit);
    return data ?? [];
  },

  async getTicket(token: string) {
    const client = createPublicClient();
    const { data, error } = await client.rpc("get_ticket", { p_token: token });
    if (error) return null;
    return data as unknown as TicketView | null;
  },
};

export interface TicketView {
  ticket: { code: string; status: string; issued_at: string };
  registration: { id: string; number: string; status: string };
  attendee: { name: string; email: string };
  event: {
    id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    google_maps_url: string | null;
    banner_url: string | null;
    timezone: string;
  };
}
