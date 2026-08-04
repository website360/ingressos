import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EVENT_STATUS } from "@/config/status-maps";
import { StatusBadge } from "@/components/shared/status-badge";
import { ROUTES } from "@/constants/routes";
import { SeatCounter } from "@/features/registrations/components/seat-counter";
import { formatDate, formatInTimezone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { publicRepository } from "@/repositories/public.repository";

/**
 * Landing pública do evento.
 *
 * ISR de 5 minutos: o conteúdo (descrição, programação, palestrantes) muda
 * raramente e é servido do cache. O contador de vagas é um componente de
 * cliente separado, com dado ao vivo.
 */
export const revalidate = 300;

/**
 * Sem isto a rota é sempre dinâmica: um segmento `[slug]` sem lista de
 * parâmetros não entra no cache, e o `revalidate` acima vira letra morta.
 * Eventos publicados depois do build continuam funcionando — são renderizados
 * sob demanda na primeira visita e cacheados a partir dali.
 */
export async function generateStaticParams() {
  const events = await publicRepository.listPublishedEvents(100);
  return events.map((event) => ({ slug: event.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await publicRepository.findEventBySlug(slug);

  if (!event) return { title: "Evento não encontrado" };

  return {
    title: event.name,
    description: event.short_description ?? undefined,
    openGraph: {
      title: event.name,
      description: event.short_description ?? undefined,
      images: event.banner_url ? [event.banner_url] : undefined,
      type: "website",
    },
    robots: event.status === "publicado" ? undefined : { index: false, follow: false },
  };
}

export default async function EventLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await publicRepository.landing(slug);

  if (!data) {
    // Slug renomeado: o link antigo continua funcionando com redirect 301.
    const currentSlug = await publicRepository.resolveOldSlug(slug);
    if (currentSlug) permanentRedirect(ROUTES.public.event(currentSlug));
    notFound();
  }

  const { event, schedule, speakers, faqs, documents } = data;
  const availability = await publicRepository.availability(event.id);

  // Evento que já passou aparece em preto e branco, como no card da listagem:
  // a cor sinaliza "acontece ainda", e mantê-la aqui faria a página de um
  // evento encerrado se parecer com a de um evento aberto.
  const hasEnded = new Date(event.ends_at).getTime() < Date.now();

  const rules = documents.find((doc) => doc.document_type === "regulamento");
  const lgpd = documents.find((doc) => doc.document_type === "lgpd");
  const cancellation = documents.find((doc) => doc.document_type === "cancelamento");

  // JSON-LD: o buscador entende que a página descreve um evento, com data e local.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    description: event.short_description ?? undefined,
    startDate: event.starts_at,
    endDate: event.ends_at,
    eventStatus:
      event.status === "cancelado"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: event.venue_name ?? event.city ?? "",
      address: [event.address, event.address_number, event.city, event.state]
        .filter(Boolean)
        .join(", "),
    },
    organizer: event.organizer_name
      ? { "@type": "Organization", name: event.organizer_name }
      : undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ---------------------------------------------------------------- */}
      <section className="relative border-b">
        <div className="bg-radial-primary pointer-events-none absolute inset-0" aria-hidden />

        {event.banner_url && (
          /*
            O banner é a arte desta página, e ela preenche a moldura inteira: a
            moldura é que segue a proporção do arquivo, não o contrário. Assim
            não há recorte — a altura fixa anterior comia metade da arte numa
            tela de 1440 — nem tarja sobrando ao lado, que é o que uma moldura
            de proporção fixa produz quando o arquivo não bate com ela.

            A capa (`cover_url`) não entra aqui: ela é a arte de cartão, e o
            lugar dela é o destaque da página inicial.
          */
          <div className="relative mx-auto w-full max-w-6xl px-4 pt-8">
            <Image
              src={event.banner_url}
              alt=""
              width={1600}
              height={600}
              priority
              sizes="(max-width: 1224px) 100vw, 1224px"
              className={cn("h-auto w-full rounded-2xl border", hasEnded && "grayscale")}
            />
          </div>
        )}

        <div className="relative mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-5">
            {/*
              Caminho de volta explícito, só no celular. No desktop o logo do
              cabeçalho leva para a home e fica sempre à vista; no celular ele
              divide a barra com pouco espaço e não se lê como botão de voltar.
              Quem chegou por link direto — que é a maioria no celular — não
              tem histórico para o "voltar" do navegador usar.
            */}
            <Link
              href={ROUTES.home}
              className="-mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:hidden"
            >
              <ArrowLeft className="size-4" />
              Ver todos os eventos
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge map={EVENT_STATUS} value={event.status} />
              {event.city && (
                <Badge variant="muted">
                  <MapPin /> {event.city}
                  {event.state ? `/${event.state}` : ""}
                </Badge>
              )}
            </div>

            <h1 className="text-gradient text-3xl font-semibold tracking-tight sm:text-4xl">
              {event.name}
            </h1>

            {event.short_description && (
              <p className="max-w-2xl text-lg text-muted-foreground">{event.short_description}</p>
            )}

            {/*
              Uma informação por linha no celular; lado a lado a partir do
              tablet. Em fila, a quebra caía onde a largura do nome do local
              mandasse — data emendando no horário, "Estádio" numa linha e
              "Beira-Rio" na seguinte. Empilhado, os três ícones formam uma
              coluna e a leitura é sempre a mesma.
            */}
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4 shrink-0 text-primary" />
                {formatDate(event.starts_at, "EEEE, dd 'de' MMMM 'de' yyyy")}
              </span>
              <span className="flex items-center gap-2">
                <Clock className="size-4 shrink-0 text-primary" />
                {formatInTimezone(event.starts_at, event.timezone, { timeStyle: "short" })}
                {" às "}
                {formatInTimezone(event.ends_at, event.timezone, { timeStyle: "short" })}
              </span>
              {event.venue_name && (
                <span className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 text-primary" />
                  {event.venue_name}
                </span>
              )}
            </div>
          </div>

          {/* Cartão de inscrição fixo, sempre visível ao rolar. */}
          <Card className="h-fit lg:sticky lg:top-20">
            <CardContent className="space-y-4 p-6">
              <div>
                <p className="text-2xl font-semibold">Gratuito</p>
                <p className="text-sm text-muted-foreground">
                  Inscrição individual · vaga garantida na confirmação
                </p>
              </div>

              <Separator />

              <SeatCounter
                eventId={event.id}
                registrationHref={ROUTES.public.registration(event.slug)}
                initial={{
                  capacity: availability?.capacity ?? event.capacity,
                  seats_taken: availability?.seats_taken ?? event.seats_taken,
                  seats_available: availability?.seats_available ?? 0,
                  status: availability?.status ?? event.status,
                }}
              />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto w-full max-w-6xl space-y-12 px-4 py-12">
        {event.description && (
          <Section title="Sobre o evento">
            <div
              className="space-y-3 text-sm leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: event.description }}
            />
          </Section>
        )}

        {schedule.length > 0 && (
          <Section title="Programação">
            <div className="space-y-3">
              {schedule.map((item) => (
                <div key={item.id} className="flex gap-4 border-l-2 border-l-primary/30 pl-4">
                  <span className="tabular w-20 shrink-0 text-sm font-medium">
                    {item.starts_at?.slice(0, 5) ?? "—"}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.speaker && <p className="text-xs text-primary">{item.speaker}</p>}
                    {item.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {speakers.length > 0 && (
          <Section title="Palestrantes">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {speakers.map((speaker) => (
                <Card key={speaker.id}>
                  <CardContent className="flex gap-3 p-5">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <User className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{speaker.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[speaker.role, speaker.company].filter(Boolean).join(" · ")}
                      </p>
                      {speaker.bio && (
                        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                          {speaker.bio}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </Section>
        )}

        <Section title="Local">
          <Card>
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                <p className="font-medium">{event.venue_name ?? "Local a confirmar"}</p>
                <p className="text-muted-foreground">
                  {[event.address, event.address_number, event.complement, event.district]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="text-muted-foreground">
                  {[event.city, event.state].filter(Boolean).join("/")}
                  {event.zip_code ? ` · CEP ${event.zip_code}` : ""}
                </p>
              </div>

              {event.google_maps_url && (
                <a
                  href={event.google_maps_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  Ver no mapa <ExternalLink className="size-3.5" />
                </a>
              )}
            </CardContent>
          </Card>
        </Section>

        {faqs.length > 0 && (
          <Section title="Perguntas frequentes">
            <div className="space-y-3">
              {faqs.map((faq) => (
                <details key={faq.id} className="group rounded-lg border p-4">
                  <summary className="cursor-pointer list-none text-sm font-medium">
                    {faq.question}
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </Section>
        )}

        {(rules || cancellation || lgpd) && (
          <Section title="Regulamento e políticas">
            <div className="space-y-4 text-sm text-muted-foreground">
              {rules && <Policy title="Regulamento" content={rules.content} />}
              {cancellation && (
                <Policy title="Política de cancelamento" content={cancellation.content} />
              )}
              {lgpd && <Policy title="Tratamento de dados (LGPD)" content={lgpd.content} />}
            </div>
          </Section>
        )}

        {(event.contact_email || event.contact_phone || event.organizer_name) && (
          <Section title="Contato">
            <div className="space-y-2 text-sm">
              {event.organizer_name && (
                <p className="flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  {event.organizer_name}
                </p>
              )}
              {event.contact_email && (
                <a
                  href={`mailto:${event.contact_email}`}
                  className="flex items-center gap-2 hover:text-primary"
                >
                  <Mail className="size-4 text-muted-foreground" />
                  {event.contact_email}
                </a>
              )}
              {event.contact_phone && (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 text-muted-foreground" />
                  {event.contact_phone}
                </p>
              )}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Policy({ title, content }: { title: string; content: string }) {
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer list-none font-medium text-foreground">{title}</summary>
      <div className="mt-2 whitespace-pre-line">{content}</div>
    </details>
  );
}
