"use client";

import * as React from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, RefreshCw, Settings, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { testMetaConnection } from "@/features/whatsapp/actions/meta.actions";
import { formatDateTime } from "@/lib/format";
import type { WhatsappConnectionView } from "@/repositories/whatsapp.repository";
import { formatWhatsAppNumber } from "@shared/validation/phone";

/**
 * Situação do número na API oficial. Não há celular para parear: o que se
 * opera aqui é conferir se a credencial continua valendo.
 */
export function MetaStatusCard({
  connection,
  canManage,
}: {
  connection: WhatsappConnectionView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const ok = connection.state === "conectado";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" /> API oficial do WhatsApp (Meta)
        </CardTitle>
        <CardDescription>
          Os ingressos saem pelos modelos aprovados na Meta. Não há celular para parear.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant={ok ? "success" : "destructive"}>
            {ok ? "Conectado" : "Com problema"}
          </Badge>
          {connection.phone_number && (
            <span className="font-medium">{formatWhatsAppNumber(connection.phone_number)}</span>
          )}
          {connection.server_version && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <BadgeCheck className="size-3.5" /> {connection.server_version}
            </span>
          )}
          {connection.last_connected_at && (
            <span className="text-muted-foreground">
              Conferido em {formatDateTime(connection.last_connected_at)}
            </span>
          )}
        </div>
        {connection.last_error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {connection.last_error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await testMetaConnection();
                if (result.ok) toast.success(`Conectado: ${result.data.verifiedName}.`);
                else toast.error(result.error.message);
                router.refresh();
              })
            }
          >
            <RefreshCw /> Conferir conexão
          </Button>
          {canManage && (
            <Button variant="ghost" asChild>
              <Link href={`${ROUTES.admin.settings.root}?aba=whatsapp`}>
                <Settings /> Credenciais e modelos
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
