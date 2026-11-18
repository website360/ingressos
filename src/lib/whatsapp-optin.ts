import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O formulário deste evento oferece a caixa "receber pelo WhatsApp"?
 *
 * Só com a API oficial (Meta) configurada e conectada NA EMPRESA DO EVENTO:
 * oferecer o envio e não ter como fazê-lo seria prometer em vão. Lê pelo
 * service role porque a conexão não é legível pelo público — e devolve só um
 * booleano. A mesma checagem roda na página (para mostrar a caixa) e na
 * action (para não confiar no que veio do navegador).
 */
export async function isWhatsappOptInEnabled(eventId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("tenant_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return false;

  const { data } = await admin
    .from("whatsapp_connections")
    .select("tenant_id")
    .eq("tenant_id", event.tenant_id)
    .eq("provider", "meta")
    .eq("state", "conectado")
    .maybeSingle();
  return data !== null;
}
