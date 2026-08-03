"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

/**
 * Client do navegador. Usa exclusivamente a anon key — toda a autorização
 * é aplicada por RLS no banco (docs/07, seção 2).
 *
 * Uso direto é restrito a repositories/, providers/ e features/auth
 * (regra do ESLint em eslint.config.mjs).
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}
