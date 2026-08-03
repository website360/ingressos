"use client";

import * as React from "react";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { ImageOff, MapPin, Users } from "lucide-react";

import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EVENT_STATUS } from "@/config/status-maps";
import { ROUTES } from "@/constants/routes";
import { PublicEventLink } from "@/features/events/components/public-event-link";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { EventStats } from "@/repositories";
import { cn } from "@/lib/utils";

/** Barra de ocupação — leitura instantânea de quão cheio está o evento. */
function OccupancyBar({ taken, capacity }: { taken: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(Math.round((taken / capacity) * 100), 100) : 0;
  const tone = pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-primary";

  return (
    <div className="min-w-32 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="tabular">
          {formatNumber(taken)} / {formatNumber(capacity)}
        </span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function EventsTable({ events }: { events: EventStats[] }) {
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<EventStats, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Evento",
        cell: ({ row }) => {
          const image = row.original.cover_url ?? row.original.banner_url;

          return (
            <div className="flex min-w-56 items-center gap-3">
              {/* Miniatura da capa: o organizador confere o resultado do upload
                  na própria listagem, sem abrir o evento. */}
              <div className="relative size-11 shrink-0 overflow-hidden rounded-lg border bg-muted">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground/50">
                    <ImageOff className="size-4" />
                  </span>
                )}
              </div>

              <div className="min-w-0 space-y-0.5">
                <p className="truncate font-medium leading-tight">{row.original.name}</p>
                {row.original.city && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" />
                    {row.original.city}
                    {row.original.state ? `/${row.original.state}` : ""}
                  </p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "starts_at",
        header: "Data",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {formatDateTime(row.original.starts_at)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge map={EVENT_STATUS} value={row.original.status} />,
      },
      {
        id: "occupancy",
        header: "Ocupação",
        cell: ({ row }) => (
          <OccupancyBar
            taken={row.original.seats_taken ?? 0}
            capacity={row.original.capacity ?? 0}
          />
        ),
      },
      {
        accessorKey: "checked_in_count",
        header: "Check-ins",
        cell: ({ row }) => (
          <span className="tabular inline-flex items-center gap-1.5 text-sm">
            <Users className="size-3.5 text-muted-foreground" />
            {formatNumber(row.original.checked_in_count ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: "cancelled_count",
        header: "Cancelados",
        cell: ({ row }) => (
          <span className="tabular text-sm">{formatNumber(row.original.cancelled_count ?? 0)}</span>
        ),
      },
      {
        id: "public",
        header: "Página",
        enableSorting: false,
        cell: ({ row }) => (
          <PublicEventLink slug={row.original.slug!} status={row.original.status} variant="icon" />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={events}
      emptyMessage="Nenhum evento encontrado. Crie o primeiro para começar."
      onRowClick={(event) => router.push(ROUTES.admin.event(event.event_id!))}
    />
  );
}
