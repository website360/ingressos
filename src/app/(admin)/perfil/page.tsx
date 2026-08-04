import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, User } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function ProfilePage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader title="Meu perfil" description="Seus dados de acesso e permissões." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4" /> Dados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-14">
                {session.user.avatar_url && <AvatarImage src={session.user.avatar_url} alt="" />}
                <AvatarFallback className="text-base">
                  {initials(session.user.full_name || session.user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{session.user.full_name || "—"}</p>
                <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Empresa</span>
                <span className="font-medium">{session.activeTenant?.name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Perfil</span>
                <Badge variant="secondary">{session.role ? ROLE_LABELS[session.role] : "—"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Autenticação em 2 fatores</span>
                {session.user.mfa_enabled ? (
                  <Badge variant="success">
                    <ShieldCheck /> Ativa
                  </Badge>
                ) : (
                  <Badge variant="warning">Inativa</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Suas permissões</CardTitle>
            <CardDescription>
              {session.role ? ROLE_DESCRIPTIONS[session.role] : ""} A lista abaixo é o que o banco
              de dados efetivamente autoriza — a interface apenas reflete isso.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {session.permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma permissão atribuída.</p>
            ) : (
              session.permissions
                .slice()
                .sort()
                .map((permission) => (
                  <Badge key={permission} variant="muted" className="text-[0.7rem]">
                    {permission}
                  </Badge>
                ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Segurança
            </CardTitle>
            <CardDescription>
              Troca de senha e situação da autenticação em dois fatores ficam em uma tela própria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href={ROUTES.admin.security}>Abrir segurança</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
