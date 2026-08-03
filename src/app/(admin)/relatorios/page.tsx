import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, MapPin, TrendingUp, UserCheck, UserX, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatNumber, formatPercent } from "@/lib/format";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Relatórios" };

export default async function ReportsPage() {
  await requirePermission(PERMISSIONS.REPORT_READ);

  const { operations, events } = await getRepositories();
  const [kpis, all] = await Promise.all([operations.dashboard(), events.list({ limit: 100 })]);

  const absent = Math.max(kpis.registrations - kpis.checkins, 0);

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Números consolidados de todos os eventos. Use a lista de participantes para recortes específicos."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Inscritos" value={kpis.registrations} icon={Users} />
        <StatCard label="Presentes" value={kpis.checkins} icon={UserCheck} tone="success" />
        <StatCard label="Ausentes" value={absent} icon={UserX} tone="warning" />
        <StatCard label="Cancelados" value={kpis.cancellations} icon={UserX} tone="destructive" />
        <StatCard
          label="Taxa de comparecimento"
          value={kpis.attendance_pct != null ? formatPercent(kpis.attendance_pct) : "—"}
          icon={TrendingUp}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4" /> Desempenho por evento
            </CardTitle>
            <CardDescription>Ocupação e comparecimento de cada evento.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Evento</TableHead>
                  <TableHead className="text-right">Inscritos</TableHead>
                  <TableHead className="text-right">Presentes</TableHead>
                  <TableHead className="text-right">Ocupação</TableHead>
                  <TableHead className="text-right">Comparecimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Nenhum evento cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  all.items.map((event) => (
                    <TableRow key={event.event_id}>
                      <TableCell className="max-w-56">
                        <Link
                          href={ROUTES.admin.event(event.event_id!)}
                          className="truncate text-sm font-medium hover:text-primary hover:underline"
                        >
                          {event.name}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {formatNumber(event.seats_taken ?? 0)}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {formatNumber(event.checked_in_count ?? 0)}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {event.occupancy_pct != null ? formatPercent(event.occupancy_pct) : "—"}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {event.attendance_pct != null ? formatPercent(event.attendance_pct) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="size-4" /> Participantes por estado
            </CardTitle>
            <CardDescription>Base para decidir onde realizar o próximo evento.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Participantes</TableHead>
                  <TableHead className="text-right">Participação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(kpis.by_state ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Sem dados de localização.
                    </TableCell>
                  </TableRow>
                ) : (
                  kpis.by_state.map((row) => (
                    <TableRow key={row.state}>
                      <TableCell className="text-sm font-medium">{row.state}</TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {formatNumber(row.total)}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm text-muted-foreground">
                        {formatPercent((row.total / Math.max(kpis.attendees_unique, 1)) * 100)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
