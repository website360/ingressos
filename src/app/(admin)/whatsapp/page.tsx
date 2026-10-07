import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Settings } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMAIL_STATUS } from "@/config/status-maps";
import { ROUTES } from "@/constants/routes";
import { ConnectionPanel } from "@/features/whatsapp/components/connection-panel";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { formatWhatsAppNumber } from "@shared/validation/phone";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Conexão do WhatsApp" };

/**
 * Pareamento do celular.
 *
 * Fica fora de Configurações de propósito: lá se guarda a credencial do
 * servidor, uma vez; aqui se opera a sessão do número, que cai e volta. São
 * ritmos diferentes, e misturá-los faria a tela de configuração virar painel
 * de operação.
 */
export default async function WhatsappPage() {
  const session = await requirePermission(PERMISSIONS.SETTINGS_READ);
  const { whatsapp } = await getRepositories();

  const [connection, messages] = await Promise.all([
    whatsapp.find(session.activeTenantId!).catch(() => null),
    whatsapp.listMessages(20).catch(() => []),
  ]);

  const canManage = session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE);

  return (
    <>
      <PageHeader
        title="Conexão do WhatsApp"
        description="Pareamento do número que entrega os ingressos."
      />

      {!connection ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="size-4" /> Integração não configurada
            </CardTitle>
            <CardDescription>
              Antes de parear o celular, informe o endereço e a chave do servidor Evolution.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={ROUTES.admin.settings.root}>
                <Settings /> Ir para Configurações
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ConnectionPanel
          connection={connection}
          canManage={canManage}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}
        />
      )}

      {connection && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="size-4" /> Últimas mensagens
            </CardTitle>
            <CardDescription>
              Ingressos e avisos entregues pelo WhatsApp. O e-mail continua saindo em paralelo.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {messages.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Nenhuma mensagem enviada ainda.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Destinatário</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((message) => (
                    <TableRow key={message.id}>
                      <TableCell className="text-sm">
                        {formatWhatsAppNumber(message.to_phone)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {message.template}
                      </TableCell>
                      <TableCell>
                        <StatusBadge map={EMAIL_STATUS} value={message.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(message.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
