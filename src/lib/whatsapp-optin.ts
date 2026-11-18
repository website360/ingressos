import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O formulário público oferece a caixa "receber pelo WhatsApp"?
 *
 * Só com a API oficial (Meta) configurada e conectada: oferecer o envio e não
 * ter como fazê-lo seria prometer em vão. Lê pelo service role porque a
 * conexão não é legível pelo público — e devolve só um booleano.
 */
export async function isWhatsappOptInEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("whatsapp_connections")
    .select("provider, state")
    .eq("provider", "meta")
    .eq("state", "conectado")
    .limit(1);
  return (data ?? []).length > 0;
}
