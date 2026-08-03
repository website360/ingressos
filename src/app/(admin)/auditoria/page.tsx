import type { Metadata } from "next";
import { FileSearch, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Auditoria" };

const ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Alteração",
  delete: "Exclusão",
  cancel: "Cancelamento",
  checkin: "Check-in",
  login: "Login",
  logout: "Logout",
  permission_change: "Mudança de permissão",
  export: "Exportação",
  access_sensitive: "Acesso a dado sensível",
};

const ACTION_VARIANT: Record<string, "default" | "success" | "warning" | "destructive" | "muted"> =
  {
    create: "success",
    update: "default",
    delete: "destructive",
    cancel: "destructive",
    checkin: "success",
    permission_change: "warning",
    export: "warning",
    access_sensitive: "warning",
  };

export default async function AuditPage() {
  await requirePermission(PERMISSIONS.AUDIT_READ);

  const { operations } = await getRepositories();
  const entries = await operations.listAudit(200);

  return (
    <>
      <PageHeader
        title="Auditoria"
        description={`${formatNumber(entries.length)} eventos registrados. A trilha é append-only: nem o administrador consegue alterá-la.`}
      />

      <Alert variant="info" className="mb-4">
        <ShieldCheck />
        <AlertTitle>Trilha imutável</AlertTitle>
        <AlertDescription>
          Nenhum papel possui permissão de UPDATE ou DELETE sobre estes registros — a restrição é
          garantida por política de banco e por trigger, não por convenção.
        </AlertDescription>
      </Alert>

      {entries.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="Nenhum registro ainda"
          description="Criações, alterações, cancelamentos, check-ins e mudanças de permissão aparecem aqui com autor, IP e dispositivo."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Autor</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Data e hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[entry.action] ?? "muted"}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-medium">{entry.entity_type}</span>
                      {entry.entity_id && (
                        <span className="tabular ml-1.5 text-xs text-muted-foreground">
                          {entry.entity_id.slice(0, 8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-sm">
                      {entry.actor_email ?? <span className="text-muted-foreground">Sistema</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.actor_role ?? "—"}
                    </TableCell>
                    <TableCell className="tabular text-xs text-muted-foreground">
                      {entry.ip ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
