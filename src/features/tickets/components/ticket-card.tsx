import Image from "next/image";
import { CalendarPlus, Clock, ExternalLink, FileDown, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/status-badge";
import { TICKET_STATUS } from "@/config/status-maps";
import { ROUTES } from "@/constants/routes";
import { formatDate, formatInTimezone } from "@/lib/format";
import { ticketQrDataUrl } from "@/lib/qrcode";
import type { TicketView } from "@/repositories/public.repository";

/** Link "Adicionar ao Google Calendar" — parâmetros no formato UTC compacto. */
function googleCalendarUrl(ticket: TicketView, token: string, appUrl: string) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, "");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ticket.event.name,
    dates: `${stamp(ticket.event.starts_at)}/${stamp(ticket.event.ends_at)}`,
    details: `Ingresso ${ticket.registration.number}\n${appUrl}${ROUTES.public.ticket(token)}`,
    location: [ticket.event.venue_name, ticket.event.address, ticket.event.city]
      .filter(Boolean)
      .join(", "),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

interface Props {
  ticket: TicketView;
  token: string;
  appUrl: string;
}

export async function TicketCard({ ticket, token, appUrl }: Props) {
  const qr = await ticketQrDataUrl(token);
  const cancelled =
    ticket.ticket.status === "cancelado" || ticket.registration.status === "cancelada";
  const used = ticket.ticket.status === "utilizado";

  return (
    <Card className="overflow-hidden">
      {ticket.event.banner_url && (
        <div className="relative h-32 w-full">
          <Image src={ticket.event.banner_url} alt="" fill sizes="600px" className="object-cover" />
        </div>
      )}

      <CardContent className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Participante</p>
            <p className="truncate text-lg font-semibold">{ticket.attendee.name}</p>
          </div>
          <StatusBadge map={TICKET_STATUS} value={ticket.ticket.status} />
        </div>

        <Separator />

        <div className="flex flex-col items-center gap-3">
          {/* QR em fundo branco fixo: leitor de câmera falha com tema escuro. */}
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <Image
              src={qr}
              alt={`QR Code do ingresso ${ticket.ticket.code}`}
              width={200}
              height={200}
              className={cancelled ? "opacity-25 grayscale" : undefined}
              unoptimized
            />
          </div>

          <p className="tabular text-sm font-medium tracking-widest">{ticket.ticket.code}</p>

          {cancelled && (
            <Badge variant="destructive">Ingresso cancelado — não permite entrada</Badge>
          )}
          {used && <Badge variant="default">Entrada já registrada</Badge>}
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Evento</p>
            <p className="font-medium">{ticket.event.name}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2 text-sm">
              <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                {formatDate(ticket.event.starts_at, "dd/MM/yyyy")}
                <br />
                <span className="text-muted-foreground">
                  {formatInTimezone(ticket.event.starts_at, ticket.event.timezone, {
                    timeStyle: "short",
                  })}
                  {" às "}
                  {formatInTimezone(ticket.event.ends_at, ticket.event.timezone, {
                    timeStyle: "short",
                  })}
                </span>
              </span>
            </div>

            <div className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                {ticket.event.venue_name ?? "Local a confirmar"}
                <br />
                <span className="text-muted-foreground">
                  {[ticket.event.city, ticket.event.state].filter(Boolean).join("/")}
                </span>
              </span>
            </div>
          </div>

          <p className="tabular text-xs text-muted-foreground">
            Inscrição {ticket.registration.number}
          </p>
        </div>

        {!cancelled && (
          <>
            <Separator />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" asChild>
                <a href={ROUTES.public.ticketPdf(token)} target="_blank" rel="noreferrer">
                  <FileDown /> Baixar PDF
                </a>
              </Button>
              <Button variant="outline" className="flex-1" asChild>
                <a href={googleCalendarUrl(ticket, token, appUrl)} target="_blank" rel="noreferrer">
                  <CalendarPlus /> Google Agenda
                </a>
              </Button>
              <Button variant="outline" className="flex-1" asChild>
                {/* .ics cobre Apple, Outlook e qualquer app de calendário. */}
                <a href={ROUTES.public.calendar(token)}>
                  <CalendarPlus /> Apple / Outlook
                </a>
              </Button>
              {ticket.event.google_maps_url && (
                <Button variant="outline" className="flex-1" asChild>
                  <a href={ticket.event.google_maps_url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Como chegar
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
