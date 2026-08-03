import { NextResponse } from "next/server";

import { publicRepository } from "@/repositories/public.repository";

/**
 * Arquivo .ics do evento — Apple Calendar, Outlook e afins.
 *
 * O token assinado é a credencial: quem tem o link tem o ingresso. A RPC
 * `get_ticket` valida a assinatura antes de devolver qualquer dado.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await publicRepository.getTicket(token);

  if (!ticket) {
    return new NextResponse("Ingresso não encontrado.", { status: 404 });
  }

  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, "");

  // Quebra de linha do iCalendar é CRLF, e valores longos precisam de escape.
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  const location = [
    ticket.event.venue_name,
    ticket.event.address,
    ticket.event.city,
    ticket.event.state,
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ingressos//Gestao de Eventos//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ticket.ticket.code}@ingressos`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(ticket.event.starts_at)}`,
    `DTEND:${stamp(ticket.event.ends_at)}`,
    `SUMMARY:${escape(ticket.event.name)}`,
    `DESCRIPTION:${escape(`Inscrição ${ticket.registration.number} · Ingresso ${ticket.ticket.code}`)}`,
    `LOCATION:${escape(location)}`,
    "STATUS:CONFIRMED",
    // Lembrete 1 dia antes — o motivo mais comum de ausência é esquecimento.
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(`Amanhã: ${ticket.event.name}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ticket.ticket.code}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
