import type { RegistrationStatus, Views } from "@/lib/supabase/database.types";

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
