import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Link as LinkIcon,
  MapPin,
  Ticket,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EVENT_STATUS } from "@/config/status-maps";
import { ROUTES } from "@/constants/routes";
import { EventContentForm } from "@/features/events/components/event-content-form";
import { EventForm } from "@/features/events/components/event-form";
import { PublicEventLink } from "@/features/events/components/public-event-link";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Evento" };

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission(PERMISSIONS.EVENT_READ);
  const { id } = await params;

  const { events, registrations } = await getRepositories();

  const [event, stats, recent, content] = await Promise.all([
    events.findById(id).catch(() => null),
    events.stats(id),
    registrations.list({ eventId: id, limit: 10 }),
    events.listContent(id),
  ]);

  if (!event) notFound();

  const available = Math.max((event.capacity ?? 0) - (event.seats_taken ?? 0), 0);

  return (
    <>
      <PageHeader
        title={event.name}
        description={
          <>
            {formatDateTime(event.starts_at)}
            {event.city ? ` · ${event.city}${event.state ? `/${event.state}` : ""}` : ""}
          </>
        }
        actions={
          <>
            <StatusBadge map={EVENT_STATUS} value={event.status} />
            {event.status === "publicado" && (
              <Button variant="outline" size="sm" asChild>
                <Link href={ROUTES.public.event(event.slug)} target="_blank">
                  <ExternalLink /> Página pública
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Link de divulgação em destaque: é o que se copia para redes sociais,
          e-mail e WhatsApp — precisa estar visível, não escondido num botão. */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LinkIcon className="size-4 text-primary" />
            Link de inscrição
          </div>
          <PublicEventLink
            slug={event.slug}
            status={event.status}
            className="sm:max-w-2xl sm:flex-1"
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Capacidade" value={event.capacity} icon={Users} />
        <StatCard label="Inscritos" value={event.seats_taken} icon={Ticket} />
        <StatCard
          label="Vagas restantes"
          value={available}
          icon={ClipboardList}
          tone={available === 0 ? "destructive" : "default"}
        />
        <StatCard
          label="Check-ins"
          value={event.checked_in_count}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Comparecimento"
          value={stats?.attendance_pct != null ? formatPercent(stats.attendance_pct) : "—"}
          icon={CheckCircle2}
        />
      </div>

      <Tabs defaultValue="resumo" className="mt-6">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="editar">Editar</TabsTrigger>
          <TabsTrigger value="conteudo">Conteúdo da página</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Local</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{event.venue_name ?? "Local não informado"}</p>
              <p className="text-muted-foreground">
                {[event.address, event.address_number, event.complement, event.district]
                  .filter(Boolean)
                  .join(", ") || "Endereço não informado"}
              </p>
              <p className="text-muted-foreground">
                {[event.city, event.state].filter(Boolean).join("/")}
              </p>
              <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
                <MapPin className="size-3.5" />
                Raio permitido para check-in: {formatNumber(event.allowed_radius_m)} m
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inscrições recentes</CardTitle>
              <CardDescription>
                <Link
                  href={`${ROUTES.admin.attendees}?event=${event.id}`}
                  className="text-primary hover:underline"
                >
                  Ver todos os {formatNumber(recent.total)} participantes
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {recent.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma inscrição ainda.</p>
              ) : (
                recent.items.map((registration) => (
                  <div
                    key={registration.registration_id}
                    className="flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{registration.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{registration.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {registration.checked_in && (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle2 /> Presente
                        </Badge>
                      )}
                      <span className="tabular text-xs text-muted-foreground">
                        {registration.number}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Descrição</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {event.short_description || event.description ? (
                <>
                  {event.short_description && (
                    <p className="mb-2 text-foreground">{event.short_description}</p>
                  )}
                  {event.description && (
                    <div
                      className="prose-sm"
                      // Conteúdo é sanitizado no servidor antes de ser gravado.
                      dangerouslySetInnerHTML={{ __html: event.description }}
                    />
                  )}
                </>
              ) : (
                <p>Nenhuma descrição cadastrada.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conteudo">
          <EventContentForm event={event} content={content} />
        </TabsContent>

        <TabsContent value="editar">
          <EventForm event={event} />
        </TabsContent>
      </Tabs>
    </>
  );
}
