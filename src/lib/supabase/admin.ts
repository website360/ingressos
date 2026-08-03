import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Client administrativo (service role) — IGNORA RLS.
 *
 * Uso permitido apenas em:
 *  - rotinas de plataforma (super admin);
 *  - workers/jobs do servidor;
 *  - operações de convite e provisionamento de tenant.
 *
 * NUNCA importar em componentes de cliente. O import de "server-only"
 * transforma qualquer violação em erro de build.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
