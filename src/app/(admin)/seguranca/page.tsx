import type { Metadata } from "next";
import { KeyRound, ShieldCheck, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Segurança" };

export default async function SecurityPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title="Segurança"
        description="Sua senha de acesso e o estado da autenticação em dois fatores."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" /> Alterar senha
            </CardTitle>
            <CardDescription>
              A troca vale imediatamente e não desconecta esta sessão. Se suspeitar que alguém teve
              acesso à sua conta, troque a senha e saia em todos os dispositivos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {session.user.mfa_enabled ? (
                  <ShieldCheck className="size-4 text-success" />
                ) : (
                  <ShieldAlert className="size-4 text-warning" />
                )}
                Autenticação em dois fatores
              </CardTitle>
              <CardDescription>
                Uma segunda confirmação no login, por aplicativo autenticador.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Situação</span>
                {session.user.mfa_enabled ? (
                  <Badge variant="success">
                    <ShieldCheck /> Ativa
                  </Badge>
                ) : (
                  <Badge variant="warning">Inativa</Badge>
                )}
              </div>

              {/*
                O cadastro do segundo fator não fica aqui de propósito. O
                Supabase já aceita registrar um TOTP, mas o login ainda não pede
                o código depois da senha — quem registrasse ficaria com a
                impressão de estar protegido sem estar, que é pior do que
                assumir que a proteção não existe.

                Habilitar de verdade é registro + desafio no login + códigos de
                recuperação. Meio caminho, aqui, é o caminho errado.
              */}
              <Alert>
                <ShieldAlert />
                <AlertTitle>Ainda não disponível para ativar</AlertTitle>
                <AlertDescription>
                  O cadastro do aplicativo autenticador depende do login passar a pedir o código, o
                  que ainda não acontece. Enquanto isso, ativar aqui daria uma sensação de proteção
                  que não corresponderia ao que o sistema faz.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sua conta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">E-mail</span>
                <span className="font-medium">{session.user.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Empresa</span>
                <span className="font-medium">{session.activeTenant?.name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Perfil</span>
                <Badge variant="secondary">{session.role ? ROLE_LABELS[session.role] : "—"}</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
