import type { CheckinResult, Views } from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type CheckinAlert = Views<"v_checkin_alerts">;

export interface CheckinFilters {
  eventId?: string;
  result?: CheckinResult;
  /** Nome do participante ou número da inscrição. */
  q?: string;
  /** Recorte por momento do check-in. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export class CheckinRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  async list(filters: CheckinFilters = {}) {
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    /*
      `!inner` no vínculo da inscrição só quando há busca: sem ele o filtro
      recairia sobre o embed e devolveria a linha do check-in com a inscrição
      vazia, em vez de descartar a linha. Fora da busca o vínculo segue externo,
      para não sumir com check-in cuja inscrição foi apagada.
    */
    const vinculo = filters.q
      ? `registration:registrations!inner(number, attendee:attendees!inner(first_name, last_name, cpf))`
      : `registration:registrations(number, attendee:attendees(first_name, last_name, cpf))`;

    let query = this.client
      .from("checkins")
      .select(
        `id, result, checked_in_at, within_geofence, distance_m, override_confirmed,
         device_id, source, offline_captured,
         event:events(id, name),
         operator:profiles(full_name),
         ${vinculo}`,
        { count: "exact" },
      )
      .order("checked_in_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.eventId) query = query.eq("event_id", filters.eventId);
    if (filters.result) query = query.eq("result", filters.result);
    if (filters.from) query = query.gte("checked_in_at", filters.from);
    if (filters.to) query = query.lte("checked_in_at", filters.to);

    if (filters.q) {
      const termo = filters.q.trim();
      query = query.or([`first_name.ilike.%${termo}%`, `last_name.ilike.%${termo}%`].join(","), {
        referencedTable: "registration.attendee",
      });
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data ?? [], total: count ?? 0 };
  }

  /** Check-in transacional. Toda validação acontece dentro da RPC. */
  async execute(token: string, context: Record<string, unknown>) {
    const { data, error } = await this.client.rpc("checkin", {
      p_token: token,
      p_context: context as never,
    });
    if (error) throw error;
    return data;
  }

  /** Busca da portaria: CPF, nome, e-mail ou número da inscrição. */
  async search(eventId: string, term: string) {
    const { data, error } = await this.client.rpc("search_attendees", {
      p_event_id: eventId,
      p_term: term,
    });
    if (error) throw error;
    return data;
  }

  /** Pacote de dados para operar sem internet. */
  async manifest(eventId: string) {
    const { data, error } = await this.client.rpc("checkin_manifest", { p_event_id: eventId });
    if (error) throw error;
    return data;
  }

  /** Sincronização idempotente da fila offline. */
  async syncBatch(items: unknown[]) {
    const { data, error } = await this.client.rpc("checkin_batch", { p_items: items as never });
    if (error) throw error;
    return data;
  }

  /** Duplicidades, tentativas inválidas e check-ins fora do raio permitido. */
  async listAlerts(limit = 100): Promise<CheckinAlert[]> {
    return this.unwrap(
      await this.client
        .from("v_checkin_alerts")
        .select("*")
        .order("checked_in_at", { ascending: false })
        .limit(limit),
    );
  }
}
