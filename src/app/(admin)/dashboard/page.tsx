import type { Metadata } from "next";
import Link from "next/link";
import {
  Calendar,
  CalendarCheck,
  CheckCircle2,
  MapPin,
  TicketCheck,
  Users,
  XCircle,
} from "lucide-react";

import {
  ByStateChart,
  RegistrationsByDayChart,
  TopEventsChart,
} from "@/components/charts/dashboard-charts";
import { RegistrationsMap } from "@/components/maps/registrations-map";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_STATUS } from "@/config/status-maps";
import { ROUTES } from "@/constants/routes";
import { PERMISSIONS, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { locateCities } from "@/lib/geo/city-locator";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requirePermission(PERMISSIONS.DASHBOARD_READ);
  const { operations, events, registrations } = await getRepositories();

  // O mapa lê inscrições: sem registration.read (a RLS devolveria vazio), o
  // cartão nem aparece.
  const canSeeMap = session.permissions.includes(PERMISSIONS.REGISTRATION_READ);

  const [kpis, upcoming, cityCounts] = await Promise.all([
    operations.dashboard(),
    events.list({ status: "publicado", limit: 5 }),
    canSeeMap ? registrations.cityCounts().catch(() => null) : Promise.resolve(null),
  ]);
  const map = cityCounts ? locateCities(cityCounts) : null;
  const mapTotal = map ? map.points.reduce((sum, p) => sum + p.count, 0) : 0;

  const firstName = session.user.full_name.split(" ")[0] ?? "";

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={`${session.activeTenant?.name ?? ""} · ${session.role ? ROLE_LABELS[session.role] : ""}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Eventos ativos" value={kpis.events_active} icon={Calendar} />
        <StatCard label="Inscritos" value={kpis.registrations} icon={Users} />
        <StatCard label="Check-ins" value={kpis.checkins} icon={CheckCircle2} tone="success" />
        <StatCard
          label="Comparecimento"
          value={kpis.attendance_pct != null ? formatPercent(kpis.attendance_pct) : "—"}
          icon={TicketCheck}
        />
        <StatCard
          label="Cancelamentos"
          value={kpis.cancellations}
          icon={XCircle}
          tone="destructive"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Inscrições por dia</CardTitle>
            <CardDescription>Últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            <RegistrationsByDayChart data={kpis.by_day ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Participantes por estado</CardTitle>
            <CardDescription>Dez maiores</CardDescription>
          </CardHeader>
          <CardContent>
            <ByStateChart data={kpis.by_state ?? []} />
          </CardContent>
        </Card>

        {map && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="size-4" /> De onde vêm os inscritos
              </CardTitle>
              <CardDescription>
                Inscrições ativas de todos os eventos, pela cidade informada na inscrição.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-3">
              <div className="isolate h-[360px] lg:col-span-2 lg:h-[420px]">
                <RegistrationsMap points={map.points} />
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Cidades com mais inscrições</p>
                {map.points.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma inscrição ainda.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {map.points.slice(0, 8).map((p) => (
                      <li key={`${p.name}|${p.uf}`} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate">
                            {p.name}
                            <span className="text-muted-foreground">/{p.uf}</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatNumber(p.count)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(p.count / map.points[0]!.count) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="pt-1 text-xs text-muted-foreground">
                  {formatNumber(map.points.length)} {map.points.length === 1 ? "cidade" : "cidades"}{" "}
                  · {formatNumber(mapTotal)} {mapTotal === 1 ? "inscrição" : "inscrições"} no mapa
                  {map.unmatched > 0 && ` · ${formatNumber(map.unmatched)} sem cidade reconhecida`}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Eventos com mais inscrições</CardTitle>
          </CardHeader>
          <CardContent>
            <TopEventsChart data={kpis.top_events ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="size-4" /> Próximos eventos
            </CardTitle>
            <CardDescription>
              <Link href={ROUTES.admin.events} className="text-primary hover:underline">
                Ver todos
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcoming.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento publicado.</p>
            ) : (
              upcoming.items.map((event) => (
                <Link
                  key={event.event_id}
                  href={ROUTES.admin.event(event.event_id!)}
                  className="block border-l-2 border-l-primary/40 pl-3 transition-colors hover:border-l-primary"
                >
                  <p className="truncate text-sm font-medium">{event.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.starts_at)}</p>
                  <p className="tabular mt-0.5 text-xs text-muted-foreground">
                    {formatNumber(event.seats_taken ?? 0)} / {formatNumber(event.capacity ?? 0)}{" "}
                    vagas
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Resumo geral</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Total de eventos", formatNumber(kpis.events_total)],
            ["Eventos encerrados", formatNumber(kpis.events_finished)],
            ["Participantes únicos", formatNumber(kpis.attendees_unique)],
            ["Status mais comum", <StatusBadge key="s" map={EVENT_STATUS} value="publicado" />],
          ].map(([label, value], index) => (
            <div key={index} className="space-y-1">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="tabular text-lg font-semibold">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
