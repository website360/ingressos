"use client";

import * as React from "react";

import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Minus, ShieldAlert, WifiOff } from "lucide-react";

import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGISTRATION_STATUS } from "@/config/status-maps";
import { formatCpf, formatDateTime, formatDistanceMeters, maskCpf } from "@/lib/format";
import type { RegistrationRow } from "@/repositories";

interface Props {
  registrations: RegistrationRow[];
  /** Sem a permissão `attendee.read_sensitive`, o CPF aparece mascarado. */
  showSensitive: boolean;
}

const CANCEL_REASONS: Record<string, string> = {
  conflito_agenda: "Conflito de agenda",
  nao_vou_conseguir: "Não vai conseguir comparecer",
  inscricao_duplicada: "Inscrição duplicada",
  mudanca_evento: "Mudança no evento",
  outro: "Outro motivo",
};

const CANCEL_AUTHOR: Record<string, string> = {
  participante: "pelo participante",
  operador: "por um operador",
  sistema: "pelo sistema",
};

export function AttendeesTable({ registrations, showSensitive }: Props) {
  const columns = React.useMemo<ColumnDef<RegistrationRow, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Participante",
        cell: ({ row }) => (
          <div className="min-w-48">
            <p className="font-medium leading-tight">{row.original.full_name}</p>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        ),
      },
      {
        accessorKey: "cpf",
        header: "CPF",
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap text-sm">
            {row.original.cpf
              ? showSensitive
                ? formatCpf(row.original.cpf)
                : maskCpf(row.original.cpf)
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "event_name",
        header: "Evento",
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-56 text-sm">{row.original.event_name}</span>
        ),
      },
      {
        accessorKey: "number",
        header: "Inscrição",
        cell: ({ row }) => <span className="tabular text-xs">{row.original.number}</span>,
      },
      {
        // Cancelada mostra motivo, autor e data na própria linha — era o que a
        // tela separada de cancelamentos existia para dizer.
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const item = row.original;
          const cancelled = item.status === "cancelada";

          if (!cancelled) {
            return <StatusBadge map={REGISTRATION_STATUS} value={item.status} />;
          }

          const reason =
            item.cancel_reason_text ||
            (item.cancel_reason_code ? CANCEL_REASONS[item.cancel_reason_code] : null) ||
            "Motivo não informado";

          /*
            Motivo, data e autor ficam no tooltip, não impressos na linha. São
            o detalhe de um caso minoritário: repetidos abaixo do selo, faziam
            a linha da inscrição cancelada ter o triplo da altura das outras e
            desalinhavam a leitura da tabela inteira.

            O gatilho é focável de propósito. Com a informação só no hover,
            deixá-lo fora da ordem de tabulação a tornaria inalcançável por
            teclado — e é o Radix que abre o tooltip também no foco.
          */
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusBadge map={REGISTRATION_STATUS} value={item.status} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                <p className="font-medium">{reason}</p>
                <p className="mt-1 text-muted-foreground">
                  {formatDateTime(item.cancelled_at)}
                  {item.cancel_by_type && ` · ${CANCEL_AUTHOR[item.cancel_by_type]}`}
                  {item.cancel_by_name && ` (${item.cancel_by_name})`}
                </p>
                {item.cancel_ip && (
                  <p className="tabular mt-0.5 text-muted-foreground">IP {item.cancel_ip}</p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: "checked_in",
        header: "Presença",
        cell: ({ row }) => {
          const item = row.original;

          if (!item.checked_in) {
            return (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Minus className="size-4" /> —
              </span>
            );
          }

          return (
            <div className="min-w-40 space-y-1">
              <span className="inline-flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {formatDateTime(item.checked_in_at)}
              </span>

              {/* Entrada validada à força é exceção auditada: aparece na
                  listagem, não só no painel de alertas. O texto distingue os
                  dois casos — longe do evento é diferente de sem GPS. */}
              {item.checkin_forced && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block">
                      <Badge variant="warning" className="cursor-help">
                        <ShieldAlert />
                        {item.checkin_within_geofence === false
                          ? "Validado fora do local"
                          : "Validado manualmente"}
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    <p className="font-medium">
                      {item.checkin_within_geofence === false
                        ? item.checkin_distance_m != null
                          ? `A ${formatDistanceMeters(item.checkin_distance_m)} do local do evento`
                          : "Fora do raio permitido"
                        : "Sem confirmação de localização"}
                    </p>
                    {item.checkin_force_reason && (
                      <p className="mt-1 text-muted-foreground">
                        Motivo: {item.checkin_force_reason}
                      </p>
                    )}
                    {item.checkin_operator && (
                      <p className="mt-0.5 text-muted-foreground">Por {item.checkin_operator}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}

              {item.checkin_offline && (
                <Badge variant="muted">
                  <WifiOff /> Registrado offline
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "city",
        header: "Cidade",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {row.original.city ? `${row.original.city}/${row.original.state ?? ""}` : "—"}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Inscrito em",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDateTime(row.original.created_at)}
          </span>
        ),
      },
    ],
    [showSensitive],
  );

  return (
    <DataTable
      columns={columns}
      data={registrations}
      emptyMessage="Nenhum participante encontrado com os filtros atuais."
    />
  );
}
