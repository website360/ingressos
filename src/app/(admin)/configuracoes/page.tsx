import type { Metadata } from "next";
import { Building2, KeyRound, Mail, ShieldCheck, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMAIL_STATUS } from "@/config/status-maps";
import { StatusBadge } from "@/components/shared/status-badge";
import { CompanyForm } from "@/features/settings/components/company-form";
import { PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getRepositories } from "@/repositories";
import { initials } from "@/lib/utils";
import type { UserRole } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Configurações" };

interface MemberRow {
  id: string;
  role: UserRole;
  status: string;
  is_owner: boolean;
  created_at: string;
  profile: {
    id: string;
    full_name: string;
    email: string;
    last_login_at: string | null;
    mfa_enabled: boolean;
  } | null;
}

export default async function SettingsPage() {
  const session = await requireAnyPermission([PERMISSIONS.SETTINGS_READ, PERMISSIONS.USER_READ]);

  const { operations, tenant } = await getRepositories();
  const [members, settings, emails, company] = await Promise.all([
    operations.listUsers().catch(() => []),
    tenant.listSettings(session.activeTenantId!).catch(() => ({})),
    operations.listEmails(20).catch(() => []),
    tenant.findById(session.activeTenantId!).catch(() => null),
  ]);

  const rows = members as unknown as MemberRow[];

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Empresa, usuários, permissões e integrações."
      />

      <Tabs defaultValue="empresa">
        <TabsList>
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="permissoes">Perfis</TabsTrigger>
          <TabsTrigger value="emails">E-mails</TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="space-y-4">
          {company && (
            <CompanyForm
              company={company}
              canEdit={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
            />
          )}

          {Object.keys(settings).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="size-4" /> Preferências
                </CardTitle>
                <CardDescription>Ajustes operacionais aplicados a toda a empresa.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {Object.entries(settings).map(([key, value]) => (
                  <Badge key={key} variant="muted" className="text-[0.7rem]">
                    {key}: {String(value)}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="usuarios">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" /> Usuários
              </CardTitle>
              <CardDescription>
                {rows.length} {rows.length === 1 ? "pessoa com acesso" : "pessoas com acesso"} ao
                sistema.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Usuário</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>MFA</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead>Desde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8">
                            <AvatarFallback>
                              {initials(member.profile?.full_name ?? member.profile?.email ?? "?")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {member.profile?.full_name || "—"}
                              {member.is_owner && (
                                <Badge variant="default" className="ml-2">
                                  Proprietário
                                </Badge>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {member.profile?.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
                      </TableCell>
                      <TableCell>
                        {member.profile?.mfa_enabled ? (
                          <Badge variant="success">
                            <ShieldCheck /> Ativa
                          </Badge>
                        ) : (
                          <Badge variant="muted">Inativa</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.profile?.last_login_at
                          ? formatRelative(member.profile.last_login_at)
                          : "Nunca"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(member.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissoes" className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <Card key={role}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="size-4" /> {ROLE_LABELS[role]}
                </CardTitle>
                <CardDescription>{ROLE_DESCRIPTIONS[role]}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {rows.filter((member) => member.role === role).length} usuário(s) com este perfil.
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="emails">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="size-4" /> Últimos e-mails
              </CardTitle>
              <CardDescription>
                Confirmações, cancelamentos e lembretes enviados pelo sistema.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {emails.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Nenhum e-mail enviado ainda. O disparo automático entra no Módulo M2.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Destinatário</TableHead>
                      <TableHead>Assunto</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emails.map((email) => (
                      <TableRow key={email.id}>
                        <TableCell className="text-sm">{email.to_email}</TableCell>
                        <TableCell className="max-w-56 truncate text-sm">{email.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {email.template}
                        </TableCell>
                        <TableCell>
                          <StatusBadge map={EMAIL_STATUS} value={email.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateTime(email.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
