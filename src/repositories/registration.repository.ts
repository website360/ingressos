import type { RegistrationStatus, Views } from "@/lib/supabase/database.types";

import type { CityCount } from "@/lib/geo/city-locator";

import { BaseRepository, type Client } from "./base.repository";

export type RegistrationRow = Views<"v_registration_full">;

export interface RegistrationFilters {
  q?: string;
  eventId?: string;
  status?: RegistrationStatus;
  state?: string;
  checkedIn?: "sim" | "nao";
  limit?: number;
  offset?: number;
}

export class RegistrationRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  /**
   * Inscrições ativas agrupadas pela cidade/UF que o participante digitou.
   * Ativas = tudo que ocupa ou ocupou vaga: cancelada e lista de espera ficam
   * de fora. Paginado porque o PostgREST corta em 1000 linhas por resposta.
   */
  async cityCounts(): Promise<CityCount[]> {
    const PAGE = 1000;
    const counts = new Map<string, CityCount>();

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from("registrations")
        .select("attendee:attendees(city, state)")
        .in("status", ["confirmada", "pendente", "no_show"])
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw error;

      for (const row of data ?? []) {
        // Os tipos gerados não descrevem relações; o embed funciona pela FK attendee_id.
        const attendee = row.attendee as unknown as {
          city: string | null;
          state: string | null;
        } | null;
        const key = `${attendee?.city ?? ""}|${attendee?.state ?? ""}`;
        const current = counts.get(key);
        if (current) current.count += 1;
        else
          counts.set(key, {
            city: attendee?.city ?? null,
            state: attendee?.state ?? null,
            count: 1,
          });
      }

      if (!data || data.length < PAGE) break;
    }

    return [...counts.values()];
  }

  async list(
    filters: RegistrationFilters = {},
  ): Promise<{ items: RegistrationRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    let query = this.client
      .from("v_registration_full")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.q) {
      // Busca unificada: nome, e-mail, CPF ou número da inscrição.
      const term = filters.q.trim();
      const digits = term.replace(/\D/g, "");
      const conditions = [
        `full_name.ilike.%${term}%`,
        `email.ilike.%${term}%`,
        `number.ilike.%${term}%`,
      ];
      if (digits.length >= 3) conditions.push(`cpf.ilike.%${digits}%`);
      query = query.or(conditions.join(","));
    }

    if (filters.eventId) query = query.eq("event_id", filters.eventId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.state) query = query.eq("state", filters.state);
    if (filters.checkedIn) query = query.eq("checked_in", filters.checkedIn === "sim");

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: data ?? [], total: count ?? 0 };
  }

  async findByRegistrationId(id: string): Promise<RegistrationRow | null> {
    return this.unwrapMaybe(
      await this.client
        .from("v_registration_full")
        .select("*")
        .eq("registration_id", id)
        .maybeSingle(),
    );
  }
}
