import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";

import { ROUTES } from "@/constants/routes";
import { RegistrationForm } from "@/features/registrations/components/registration-form";
import { formatDateTime } from "@/lib/format";
import { publicRepository } from "@/repositories/public.repository";

export const metadata: Metadata = {
  title: "Inscrição",
  robots: { index: false, follow: true },
};

/** Formulário nunca é cacheado: a disponibilidade precisa ser a do momento. */
export const dynamic = "force-dynamic";

export default async function RegistrationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await publicRepository.findEventBySlug(slug);

  if (!event || event.status !== "publicado") notFound();

  const availability = await publicRepository.availability(event.id);
  const isFull = (availability?.seats_available ?? 0) <= 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      {/* Os dois destinos: um passo atrás e a agenda inteira. No celular, sem
          o menu à vista, só o "voltar" do navegador levaria à home — e quem
          abriu o link direto do WhatsApp não tem para onde voltar. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <Link
          href={ROUTES.public.event(event.slug)}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar para o evento
        </Link>
        <Link href={ROUTES.home} className="transition-colors hover:text-foreground sm:hidden">
          Ver todos os eventos
        </Link>
      </div>

      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4" />
            {formatDateTime(event.starts_at)}
          </span>
          {event.venue_name && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" />
              {event.venue_name}
              {event.city ? ` · ${event.city}` : ""}
            </span>
          )}
        </div>
      </div>

      <RegistrationForm
        eventId={event.id}
        eventSlug={event.slug}
        eventName={event.name}
        isFull={isFull}
      />
    </div>
  );
}
