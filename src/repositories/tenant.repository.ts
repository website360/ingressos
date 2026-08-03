import type { Tables, TablesUpdate } from "@/lib/supabase/database.types";

import { BaseRepository, type Client } from "./base.repository";

export type Tenant = Tables<"tenants">;
export type Membership = Tables<"memberships">;

export interface TenantMember extends Membership {
  profile: Pick<Tables<"profiles">, "id" | "full_name" | "email" | "avatar_url" | "last_login_at">;
}

export class TenantRepository extends BaseRepository {
  constructor(client: Client) {
    super(client);
  }

  /** Empresa ativa. A RLS já limita ao tenant do JWT. */
  async findById(tenantId: string): Promise<Tenant> {
    return this.unwrap(
      await this.client.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
    );
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.unwrapMaybe(
      await this.client
        .from("tenants")
        .select("*")
        .eq("slug", slug)
        .is("deleted_at", null)
        .maybeSingle(),
    );
  }

  async update(tenantId: string, patch: TablesUpdate<"tenants">): Promise<Tenant> {
    return this.unwrap(
      await this.client.from("tenants").update(patch).eq("id", tenantId).select("*").single(),
    );
  }

  async listMembers(tenantId: string): Promise<TenantMember[]> {
    const data = this.unwrap(
      await this.client
        .from("memberships")
        .select(
          "*, profile:profiles!memberships_user_id_fkey(id, full_name, email, avatar_url, last_login_at)",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
    );
    return data as unknown as TenantMember[];
  }

  async listSettings(tenantId: string): Promise<Record<string, unknown>> {
    const rows = this.unwrap(
      await this.client.from("tenant_settings").select("key, value").eq("tenant_id", tenantId),
    );
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async upsertSetting(tenantId: string, key: string, value: unknown): Promise<void> {
    const { error } = await this.client
      .from("tenant_settings")
      .upsert({ tenant_id: tenantId, key, value: value as never }, { onConflict: "tenant_id,key" });
    if (error) throw error;
  }
}
