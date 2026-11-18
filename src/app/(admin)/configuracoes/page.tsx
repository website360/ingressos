import type { Metadata } from "next";
import { Building2, KeyRound, Mail, MessageCircle, Send, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
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
import { CompanyForm } from "@/features/settings/components/company-form";
import { FaqTemplatesForm } from "@/features/settings/components/faq-templates-form";
import { WhatsappProviderSettings } from "@/features/whatsapp/components/whatsapp-provider-settings";
import { WhatsappCapacityForm } from "@/features/whatsapp/components/capacity-form";
import { WhatsappPacingForm } from "@/features/whatsapp/components/pacing-form";
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

const TABS = ["empresa", "usuarios", "permissoes", "emails", "whatsapp", "perguntas"] as const;

interface PageProps {
  searchParams: Promise<{ aba?: string }>;
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const { aba } = await searchParams;
  const defaultTab = TABS.includes(aba as (typeof TABS)[number]) ? aba! : "empresa";
  const session = await requireAnyPermission([PERMISSIONS.SETTINGS_READ, PERMISSIONS.USER_READ]);

  const { operations, tenant, whatsapp, events } = await getRepositories();
  const [members, settings, company, connection, faqTemplates] = await Promise.all([
    operations.listUsers().catch(() => []),
    tenant.listSettings(session.activeTenantId!).catch(() => ({})),
    tenant.findById(session.activeTenantId!).catch(() => null),
    whatsapp.find(session.activeTenantId!).catch(() => null),
    events.listFaqTemplates().catch(() => []),
  ]);

  const rows = members as unknown as MemberRow[];

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Empresa, usuários, permissões e integrações."
      />

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="permissoes">Perfis</TabsTrigger>
          <TabsTrigger value="emails">E-mails</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="perguntas">Perguntas padrão</TabsTrigger>
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
                <Mail className="size-4" /> Envios
              </CardTitle>
              <CardDescription>
                O histórico de e-mails passou a viver junto com o de WhatsApp, em Envios — é lá que
                dá para filtrar, ver o que falhou e reenviar. Manter uma segunda lista aqui seria
                duas verdades sobre a mesma coisa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href={ROUTES.admin.messages}>
                  <Send /> Abrir Envios
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsappProviderSettings
            connection={connection}
            canEdit={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
            appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}
          />

          {connection?.provider === "meta" ? (
            <WhatsappCapacityForm
              ratePerSecond={connection.rate_per_second}
              dailyUniqueLimit={connection.daily_unique_limit}
              workerConcurrency={connection.worker_concurrency}
              messagingTier={connection.messaging_tier}
              canEdit={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
            />
          ) : (
            connection && (
              <WhatsappPacingForm
                intervalSeconds={connection.send_interval_seconds}
                dailyLimit={connection.daily_send_limit}
                canEdit={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
              />
            )
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="size-4" /> Como funciona
              </CardTitle>
              <CardDescription>
                Com o WhatsApp ativo, cada inscrição confirmada dispara dois envios independentes: o
                e-mail de sempre e o ingresso pelo WhatsApp. Na Evolution, o celular é pareado em
                Conexão do WhatsApp, no menu lateral; na API oficial, basta salvar as credenciais
                com os modelos aprovados.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
        <TabsContent value="perguntas">
          <FaqTemplatesForm
            templates={faqTemplates}
            canEdit={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
