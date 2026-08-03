import { cookies } from "next/headers";

import { createServerClient as createSSRClient, type CookieOptions } from "@supabase/ssr";

import type { Database } from "./database.types";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Client de servidor (Server Components, Server Actions, Route Handlers).
 * Propaga o JWT do usuário via cookies — a RLS enxerga o usuário real.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components não podem escrever cookies; o refresh de sessão
            // acontece no middleware. Ignorar aqui é o comportamento correto.
          }
        },
      },
    },
  );
}
