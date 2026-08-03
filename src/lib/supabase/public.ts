import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Client público, SEM cookies.
 *
 * Ler cookies torna a rota dinâmica no App Router e mata o ISR. Como as páginas
 * públicas não têm sessão — a autorização vem da política de RLS para `anon` —,
 * um client sem cookies permite que a landing seja cacheada e revalidada
 * (ADR-006), servindo em milissegundos mesmo sob campanha de tráfego.
 */
let publicClient: ReturnType<typeof createClient<Database>> | undefined;

export function createPublicClient() {
  publicClient ??= createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return publicClient;
}
