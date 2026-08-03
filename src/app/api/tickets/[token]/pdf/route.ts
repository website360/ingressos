import { NextResponse } from "next/server";

import { renderToBuffer } from "@react-pdf/renderer";

import { TicketDocument } from "@/features/tickets/pdf/ticket-document";
import { ticketQrDataUrl } from "@/lib/qrcode";
import { createPublicClient } from "@/lib/supabase/public";
import { publicRepository } from "@/repositories/public.repository";

/**
 * Ingresso em PDF.
 *
 * Runtime Node (ADR-008): @react-pdf/renderer precisa de APIs que a borda não
 * tem. O token assinado é a credencial — `get_ticket` valida a assinatura antes
 * de devolver qualquer dado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await publicRepository.getTicket(token);

  if (!ticket) {
    return new NextResponse("Ingresso não encontrado.", { status: 404 });
  }

  const client = createPublicClient();
  const { data: company } = await client.from("tenants").select("name, logo_url").limit(1).single();

  const qr = await ticketQrDataUrl(token);

  const buffer = await renderToBuffer(
    TicketDocument({
      ticket,
      qrDataUrl: qr,
      companyName: company?.name ?? "Ingressos",
      logoUrl: company?.logo_url,
    }),
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ingresso-${ticket.ticket.code}.pdf"`,
      // Ingresso cancelado precisa refletir na hora: nada de cache.
      "Cache-Control": "no-store",
    },
  });
}
