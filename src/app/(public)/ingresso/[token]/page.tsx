import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CancelRegistration } from "@/features/tickets/components/cancel-registration";
import { TicketCard } from "@/features/tickets/components/ticket-card";
import { publicRepository } from "@/repositories/public.repository";

export const metadata: Metadata = {
  title: "Meu ingresso",
  // O link é a credencial de acesso: não pode ser indexado.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await publicRepository.getTicket(token);

  if (!ticket) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cancelled =
    ticket.ticket.status === "cancelado" || ticket.registration.status === "cancelada";
  const eventStarted = new Date(ticket.event.starts_at) <= new Date();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Seu ingresso</h1>
        <p className="text-sm text-muted-foreground">
          Apresente o QR Code na entrada do evento. Não precisa imprimir.
        </p>
      </div>

      <TicketCard ticket={ticket} token={token} appUrl={appUrl} />

      {!cancelled && !eventStarted && (
        <CancelRegistration registrationId={ticket.registration.id} eventName={ticket.event.name} />
      )}

      {cancelled && (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>Inscrição cancelada</AlertTitle>
          <AlertDescription>
            Este ingresso não permite mais a entrada. Se quiser participar, faça uma nova inscrição
            na página do evento — um novo ingresso será emitido.
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="info">
        <Info />
        <AlertTitle>Guarde este link</AlertTitle>
        <AlertDescription>
          Ele dá acesso ao seu ingresso e não exige login. Evite compartilhar — quem tiver o link
          consegue apresentar o QR Code na portaria.
        </AlertDescription>
      </Alert>
    </div>
  );
}
