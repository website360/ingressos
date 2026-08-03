import type { Tables } from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type SupportTicket = Tables<"support_tickets">;
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

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  ip: string | null;
  created_at: string;
  changes: unknown;
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

  async listSupport(status?: string, limit = 100) {
    let query = this.client
      .from("support_tickets")
      .select(
        "*, requester:profiles!support_tickets_requester_id_fkey(full_name), event:events(name)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status as never);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
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

  /**
   * Trilha de auditoria pela view exposta em `public` — a tabela vive em
   * `audit`, schema que não é exposto pela Data API (ADR-014). A view usa
   * `security_invoker`, então a RLS da tabela base continua valendo.
   */
  async listAudit(limit = 200): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from("v_audit_logs")
      .select(
        "id, action, entity_type, entity_id, actor_email, actor_role, ip, created_at, changes",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as unknown as AuditEntry[];
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
