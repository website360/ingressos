import { Suspense } from "react";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, MapPinOff, ScanLine } from "lucide-react";

import { ListFilters } from "@/components/shared/list-filters";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CHECKIN_RESULT } from "@/config/status-maps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { formatDateTime, formatDistanceMeters, formatNumber } from "@/lib/format";
import { getRepositories } from "@/repositories";
import type { CheckinResult } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Check-ins" };

interface PageProps {
  searchParams: Promise<{ event?: string; result?: string }>;
}

interface CheckinRow {
  id: string;
  result: CheckinResult;
  checked_in_at: string;
  within_geofence: boolean | null;
  distance_m: number | null;
  override_confirmed: boolean;
  device_id: string | null;
  source: string;
  offline_captured: boolean;
  event: { id: string; name: string } | null;
  operator: { full_name: string } | null;
  registration: {
    number: string;
    attendee: { first_name: string; last_name: string } | null;
  } | null;
}

export default async function CheckinsPage({ searchParams }: PageProps) {
  await requireAnyPermission([PERMISSIONS.CHECKIN_READ, PERMISSIONS.CHECKIN_EXECUTE]);
  const params = await searchParams;

  const { checkins, events } = await getRepositories();
  const [eventOptions, result, alerts] = await Promise.all([
    events.listOptions(),
    checkins.list({
      eventId: params.event,
      result: params.result as CheckinResult | undefined,
      limit: 100,
    }),
    checkins.listAlerts(50),
  ]);

  const rows = result.items as unknown as CheckinRow[];
  const successes = rows.filter((row) => row.result === "sucesso").length;
  const outOfRange = rows.filter((row) => row.within_geofence === false).length;
  const duplicates = rows.filter((row) => row.result === "duplicado").length;

  return (
    <>
      <PageHeader
        title="Check-ins"
        description={`${formatNumber(result.total)} registros de entrada`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total registrado" value={result.total} icon={ScanLine} />
        <StatCard label="Confirmados" value={successes} icon={CheckCircle2} tone="success" />
        <StatCard label="Duplicados" value={duplicates} icon={AlertTriangle} tone="warning" />
        <StatCard label="Fora do raio" value={outOfRange} icon={MapPinOff} tone="destructive" />
      </div>

      <div className="mt-6">
        <Suspense fallback={<Skeleton className="mb-4 h-9 w-full max-w-xs" />}>
          <ListFilters
            searchPlaceholder="Buscar participante..."
            selects={[
              {
                key: "event",
                placeholder: "Todos os eventos",
                options: eventOptions.map((event) => ({ value: event.id, label: event.name })),
              },
              {
                key: "result",
                placeholder: "Todos os resultados",
                options: Object.entries(CHECKIN_RESULT).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                })),
              },
            ]}
          />
        </Suspense>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Participante</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Data e hora</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>Recepcionista</TableHead>
                <TableHead>Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Nenhum check-in registrado ainda.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="text-sm font-medium">
                        {row.registration?.attendee
                          ? `${row.registration.attendee.first_name} ${row.registration.attendee.last_name}`
                          : "—"}
                      </p>
                      <p className="tabular text-xs text-muted-foreground">
                        {row.registration?.number ?? ""}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-sm">
                      {row.event?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={CHECKIN_RESULT} value={row.result} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(row.checked_in_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.within_geofence === null ? (
                        <span className="text-muted-foreground">Sem localização</span>
                      ) : row.within_geofence ? (
                        <span className="text-success">No local</span>
                      ) : (
                        <span className="text-destructive">
                          {formatDistanceMeters(row.distance_m)} do local
                          {row.override_confirmed && " (validado)"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{row.operator?.full_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={row.offline_captured ? "warning" : "muted"}>
                        {row.offline_captured ? "Offline" : row.source}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {alerts.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Alertas
            </CardTitle>
            <CardDescription>
              Duplicidades, tentativas inválidas e entradas fora do raio permitido.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.slice(0, 15).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between gap-3 border-l-2 border-l-warning py-1.5 pl-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{alert.attendee_name ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{alert.event_name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge map={CHECKIN_RESULT} value={alert.result} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(alert.checked_in_at)}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
