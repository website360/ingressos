"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { BadgeCheck, Copy, PlugZap, Save, Webhook } from "lucide-react";

import { metaConnectionSchema, type MetaConnectionInput } from "@shared/schemas/whatsapp";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { saveMetaConnection, testMetaConnection } from "@/features/whatsapp/actions/meta.actions";
import { metaTemplateGuide, resolveTemplateConfig } from "@/lib/meta/templates";
import type { WhatsappConnectionView } from "@/repositories/whatsapp.repository";
import { formatWhatsAppNumber } from "@shared/validation/phone";

interface Props {
  connection: WhatsappConnectionView | null;
  canEdit: boolean;
  appUrl: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <Input value={value} readOnly className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copiar ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("Copiado.");
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

/**
 * Credenciais da API oficial do WhatsApp (Meta Cloud API).
 *
 * Token e segredo do app nunca voltam para a tela: em branco, mantém o salvo.
 */
export function MetaConnectionForm({ connection, canEdit, appUrl }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const isMeta = connection?.provider === "meta";
  const templates = resolveTemplateConfig(isMeta ? connection?.meta_templates : null);

  const form = useForm<MetaConnectionInput>({
    resolver: zodResolver(metaConnectionSchema),
    defaultValues: {
      access_token: "",
      app_secret: "",
      phone_number_id: isMeta ? (connection?.meta_phone_number_id ?? "") : "",
      waba_id: isMeta ? (connection?.meta_waba_id ?? "") : "",
      templates,
    },
  });

  const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/webhooks/meta`;
  const guide = metaTemplateGuide(form.watch("templates"), appUrl.replace(/\/+$/, ""));

  function test() {
    startTransition(async () => {
      const result = await testMetaConnection();
      if (!result.ok) {
        toast.error(result.error.message);
        router.refresh();
        return;
      }
      toast.success(`Conectado: ${result.data.verifiedName}.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) =>
            startTransition(async () => {
              const result = await saveMetaConnection(values);
              if (!result.ok) {
                toast.error(result.error.message);
                return;
              }
              toast.success(`Conectado: ${result.data.verifiedName}.`);
              form.resetField("access_token");
              form.resetField("app_secret");
              router.refresh();
            }),
          )}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PlugZap className="size-4" /> API oficial do WhatsApp (Meta)
              </CardTitle>
              <CardDescription>
                Dados do app no painel de desenvolvedores da Meta (WhatsApp → Configuração da API).
                Use um token permanente de usuário do sistema — o temporário expira em 24 horas.
              </CardDescription>
              {isMeta && connection && (
                <div className="flex flex-wrap items-center gap-2 pt-2 text-sm">
                  <Badge variant={connection.state === "conectado" ? "success" : "destructive"}>
                    {connection.state === "conectado" ? "Conectado" : "Com problema"}
                  </Badge>
                  {connection.phone_number && (
                    <span>{formatWhatsAppNumber(connection.phone_number)}</span>
                  )}
                  {connection.server_version && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <BadgeCheck className="size-3.5" /> {connection.server_version}
                    </span>
                  )}
                  {connection.last_error && (
                    <span className="w-full text-destructive">{connection.last_error}</span>
                  )}
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="phone_number_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ID do número de telefone</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="numeric" placeholder="123456789012345" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="waba_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ID da conta do WhatsApp Business</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="numeric" placeholder="Opcional" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="access_token"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Token de acesso</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" autoComplete="off" />
                      </FormControl>
                      <FormDescription>
                        {isMeta && connection?.api_key_hint
                          ? `Salvo: ${connection.api_key_hint}. Em branco, mantém o atual.`
                          : "Precisa da permissão whatsapp_business_messaging."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="app_secret"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Segredo do app</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" autoComplete="off" />
                      </FormControl>
                      <FormDescription>
                        Configurações do app → Básico. Confirma que os avisos de entrega vêm mesmo
                        da Meta.{isMeta ? " Em branco, mantém o atual." : ""}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </fieldset>

              <fieldset disabled={!canEdit} className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">Nomes dos modelos na Meta</legend>
                <div className="grid gap-4 md:grid-cols-2">
                  {(
                    [
                      ["templates.confirmed", "Confirmação com o ingresso"],
                      ["templates.cancelled", "Cancelamento"],
                      ["templates.code", "Código da segunda via"],
                      ["templates.language", "Idioma"],
                    ] as const
                  ).map(([name, label]) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{label}</FormLabel>
                          <FormControl>
                            <Input {...field} className="font-mono text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </fieldset>

              {canEdit && (
                <div className="flex flex-wrap justify-end gap-2">
                  {isMeta && (
                    <Button type="button" variant="outline" loading={isPending} onClick={test}>
                      Testar conexão
                    </Button>
                  )}
                  <Button type="submit" loading={isPending}>
                    <Save /> {isMeta ? "Salvar" : "Salvar e usar a API oficial"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </form>
      </Form>

      {isMeta && connection?.meta_verify_token && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="size-4" /> Webhook
            </CardTitle>
            <CardDescription>
              No painel da Meta, em WhatsApp → Configuração, cole estes dois valores e assine o
              campo <strong>messages</strong>. É por aqui que chegam os avisos de entregue, lida e
              falhou.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <CopyField label="URL de retorno" value={webhookUrl} />
            <CopyField label="Token de verificação" value={connection.meta_verify_token} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelos para cadastrar na Meta</CardTitle>
          <CardDescription>
            Na API oficial, toda mensagem enviada pela empresa usa um modelo aprovado. Cadastre os
            três no Gerenciador do WhatsApp, com estes nomes e idioma{" "}
            {form.watch("templates.language")}. A aprovação costuma levar de minutos a algumas
            horas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {guide.map((item) => (
            <div key={item.key} className="space-y-2 rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{item.title}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{item.category}</Badge>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.name}</code>
                </div>
              </div>
              {item.header && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Cabeçalho:</span> {item.header}
                </p>
              )}
              <div className="relative">
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 pr-12 font-sans text-sm">
                  {item.body}
                </pre>
                {item.key !== "code" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1"
                    aria-label="Copiar texto do modelo"
                    onClick={() => {
                      void navigator.clipboard.writeText(item.body);
                      toast.success("Texto copiado.");
                    }}
                  >
                    <Copy />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Variáveis: {item.variables}</p>
              {item.button && <p className="text-xs text-muted-foreground">{item.button}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
