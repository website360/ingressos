import "server-only";

import { createServerClient } from "@/lib/supabase/server";

import { CheckinRepository } from "./checkin.repository";
import { EventRepository } from "./event.repository";
import { OperationsRepository } from "./operations.repository";
import { RegistrationRepository } from "./registration.repository";
import { TenantRepository } from "./tenant.repository";

export type { EventStats, Event, Category } from "./event.repository";
export type { RegistrationRow } from "./registration.repository";
export type { CheckinAlert } from "./checkin.repository";
export type { DashboardKpis, AuditEntry } from "./operations.repository";

/**
 * Ponto único de acesso a dados no servidor.
 *
 * As páginas pedem repositórios daqui e nunca instanciam o client do Supabase —
 * é o que mantém a regra do ADR-009 verificável por lint.
 */
export async function getRepositories() {
  const client = await createServerClient();

  return {
    events: new EventRepository(client),
    registrations: new RegistrationRepository(client),
    checkins: new CheckinRepository(client),
    operations: new OperationsRepository(client),
    tenant: new TenantRepository(client),
  };
}
