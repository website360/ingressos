import type { Tables } from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type Notification = Tables<"notifications">;

export interface DashboardKpis {
  events_total: number;
  events_active: number;
  events_finished: number;
  registrations: number;
  checkins: number;
  cancellations: number;
  attendance_pct: number | null;
  attendees_unique: number;
  by_day: { day: string; total: number }[];
  by_state: { state: string; total: number }[];
  top_events: {
    id: string;
    name: string;
    seats_taken: number;
    capacity: number;
    checked_in: number;
  }[];
}

export class OperationsRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  async dashboard(from?: string, to?: string): Promise<DashboardKpis> {
    const { data, error } = await this.client.rpc("dashboard_kpis", {
      p_from: from ?? null,
      p_to: to ?? null,
    });
    if (error) throw error;
    return data as unknown as DashboardKpis;
  }

  async listNotifications(limit = 100): Promise<Notification[]> {
    return this.unwrap(
      await this.client
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit),
    );
  }

  async listEmails(limit = 100) {
    const { data, error } = await this.client
      .from("email_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listUsers() {
    const { data, error } = await this.client
      .from("memberships")
      .select("*, profile:profiles(id, full_name, email, avatar_url, last_login_at, mfa_enabled)")
      .order("created_at");
    if (error) throw error;
    return data ?? [];
  }
}
