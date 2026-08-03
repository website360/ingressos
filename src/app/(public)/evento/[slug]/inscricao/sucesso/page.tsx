import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Mail } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ROUTES } from "@/constants/routes";
import { TicketCard } from "@/features/tickets/components/ticket-card";
import { publicRepository } from "@/repositories/public.repository";

export const metadata: Metadata = {
  title: "Inscrição confirmada",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RegistrationSuccessPage({ params, searchParams }: PageProps) {
  const [{ slug }, { token }] = await Promise.all([params, searchParams]);

  const event = await publicRepository.findEventBySlug(slug);
  if (!event) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!token) notFound();

  const ticket = await publicRepository.getTicket(token);
  if (!ticket) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="size-7" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Inscrição confirmada</h1>
        <p className="text-muted-foreground">
          Sua vaga em <span className="font-medium text-foreground">{event.name}</span> está
          garantida.
        </p>
      </div>

      <TicketCard ticket={ticket} token={token} appUrl={appUrl} />

      <Alert variant="info">
        <Mail />
        <AlertTitle>Salve o link do seu ingresso</AlertTitle>
        <AlertDescription>
          <Link href={ROUTES.public.ticket(token)} className="break-all text-primary underline">
            {appUrl}
            {ROUTES.public.ticket(token)}
          </Link>
          <br />
          Ele dá acesso ao QR Code sem precisar de senha, e é por ele que você pode cancelar a
          inscrição se precisar.
        </AlertDescription>
      </Alert>
    </div>
  );
}
