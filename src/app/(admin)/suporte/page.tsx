import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SUPPORT_PRIORITY, SUPPORT_STATUS } from "@/config/status-maps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getRepositories } from "@/repositories";
import type { SupportPriority, SupportStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Suporte" };

interface TicketRow {
  id: string;
  number: string;
  subject: string;
  status: SupportStatus;
  priority: SupportPriority;
  sla_due_at: string | null;
  created_at: string;
  requester: { full_name: string } | null;
  event: { name: string } | null;
}

export default async function SupportPage() {
  await requirePermission(PERMISSIONS.SUPPORT_READ);

  const { operations } = await getRepositories();
  const tickets = (await operations.listSupport()) as unknown as TicketRow[];

  return (
    <>
      <PageHeader
        title="Suporte"
        description="Chamados internos com prioridade, responsável e prazo de atendimento."
      />

      {tickets.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="Nenhum chamado aberto"
          description="Chamados criados pela equipe aparecem aqui, ordenados por prioridade e prazo de SLA."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-24">Número</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Aberto em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => {
                  const overdue =
                    ticket.sla_due_at &&
                    new Date(ticket.sla_due_at) < new Date() &&
                    !["resolvido", "fechado"].includes(ticket.status);

                  return (
                    <TableRow key={ticket.id}>
                      <TableCell className="tabular text-xs">{ticket.number}</TableCell>
                      <TableCell className="max-w-64">
                        <p className="truncate text-sm font-medium">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {ticket.requester?.full_name ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm">
                        {ticket.event?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge map={SUPPORT_PRIORITY} value={ticket.priority} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge map={SUPPORT_STATUS} value={ticket.status} />
                      </TableCell>
                      <TableCell
                        className={`whitespace-nowrap text-sm ${overdue ? "font-medium text-destructive" : ""}`}
                      >
                        {ticket.sla_due_at ? formatRelative(ticket.sla_due_at) : "—"}
                        {overdue && " (vencido)"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(ticket.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
