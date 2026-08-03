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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /*
    Falhar cedo e com nome. Sem estas duas, o `createClient` morre com
    "supabaseUrl is required" no meio do `next build` — uma mensagem que não
    diz qual variável falta nem que o problema é de ambiente de build.

    E o build precisa mesmo delas: `generateStaticParams` da página do evento
    consulta o banco para saber quais slugs pré-renderizar, e o Next embute as
    NEXT_PUBLIC_* no bundle do navegador nesse mesmo passo. Em plataformas que
    separam variáveis de build e de execução — App Platform, Cloudways — elas
    precisam estar declaradas nos dois escopos.
  */
  if (!url || !anonKey) {
    const ausentes = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ].filter(Boolean) as string[];

    const faltando =
      ausentes.length > 1
        ? `${ausentes.join(" e ")} não estão definidas`
        : `${ausentes[0]} não está definida`;

    throw new Error(
      `${faltando}. As variáveis NEXT_PUBLIC_* precisam existir ` +
        `também no ambiente de BUILD, não só no de execução — o Next as embute no ` +
        `bundle e as usa para pré-renderizar as páginas de evento.`,
    );
  }

  publicClient ??= createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return publicClient;
}
