import "server-only";

import { revalidatePath } from "next/cache";

import { ROUTES } from "@/constants/routes";

/**
 * Derruba o cache das páginas públicas de um evento (ISR de 5 min).
 *
 * Vai pelo caminho CONCRETO de cada página. `revalidatePath("/evento",
 * "layout")` não pegava nada — não existe layout em /evento — e o banner novo
 * só aparecia quando o cache vencia sozinho. O padrão "[slug]" entra junto
 * como rede de segurança para qualquer outro endereço do mesmo evento.
 */
export function revalidatePublicEvent(...slugs: (string | null | undefined)[]) {
  for (const slug of new Set(slugs.filter(Boolean) as string[])) {
    const base = ROUTES.public.event(slug);
    revalidatePath(base);
    revalidatePath(`${base}/inscricao`);
  }
  revalidatePath("/evento/[slug]", "page");
  revalidatePath("/evento/[slug]/inscricao", "page");
}
