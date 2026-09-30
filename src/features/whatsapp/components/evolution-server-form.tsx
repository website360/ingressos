"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ExternalLink, PlugZap, Save, Trash2 } from "lucide-react";
import Link from "next/link";

import { whatsappServerSchema, type WhatsappServerInput } from "@shared/schemas/whatsapp";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { ROUTES } from "@/constants/routes";
import {
  removeWhatsappIntegration,
  saveEvolutionServer,
  testEvolutionServer,
} from "@/features/whatsapp/actions/connection.actions";
import type { WhatsappConnectionView } from "@/repositories/whatsapp.repository";

interface Props {
  connection: WhatsappConnectionView | null;
  canEdit: boolean;
}

/**
 * Dados do servidor Evolution.
 *
 * A chave nunca volta preenchida: o banco não deixa o painel lê-la. O campo
 * fica vazio com a máscara na descrição, e deixá-lo em branco mantém a chave
 * que já está salva.
 */
export function EvolutionServerForm({ connection, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<WhatsappServerInput>({
    resolver: zodResolver(whatsappServerSchema),
    defaultValues: { base_url: connection?.base_url ?? "", api_key: "" },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          startTransition(async () => {
            const result = await saveEvolutionServer(values);
            if (!result.ok) {
              toast.error(result.error.message);
              return;
            }
            toast.success(
              result.data.version
                ? `Servidor salvo — Evolution ${result.data.version}.`
                : "Servidor salvo. Não foi possível ler a versão do servidor.",
            );
            form.resetField("api_key");
            router.refresh();
          }),
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="size-4" /> Servidor Evolution
            </CardTitle>
            <CardDescription>
              Endereço e chave do servidor que fala com o WhatsApp. O celular é pareado em{" "}
              <Link href={ROUTES.admin.whatsapp} className="font-medium text-primary underline">
                Conexão do WhatsApp
              </Link>
              .
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="base_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL do servidor</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://evolution.suaempresa.com.br"
                      autoComplete="off"
                      disabled={!canEdit || isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A raiz da API, sem `/instance` nem barra no fim.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="api_key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chave de API {connection ? "(opcional)" : ""}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={
                        connection ? "Deixe em branco para manter" : "AUTHENTICATION_API_KEY"
                      }
                      autoComplete="off"
                      disabled={!canEdit || isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {connection ? (
                      <>
                        Chave atual: <code>{connection.api_key_hint}</code>. Ela não é exibida de
                        volta — o banco não permite que o painel a leia.
                      </>
                    ) : (
                      "A chave global do servidor (AUTHENTICATION_API_KEY)."
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {connection?.server_version && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">Evolution {connection.server_version}</Badge>
                <Badge variant="muted">
                  webhook {connection.webhook_dialect === "achatado" ? "achatado" : "aninhado"}
                </Badge>
              </div>
            )}

            {connection && !connection.server_version && (
              <Alert>
                <AlertDescription>
                  Não foi possível ler a versão do servidor. O sistema vai falar o dialeto de
                  webhook mais recente — se o pareamento não sair de “conectando”, provavelmente é
                  um servidor anterior à 2.2.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={isPending}>
              <Save /> Salvar servidor
            </Button>

            {connection && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await testEvolutionServer();
                      if (!result.ok) {
                        toast.error(result.error.message);
                        return;
                      }
                      toast.success(
                        result.data.version
                          ? `Servidor respondeu — Evolution ${result.data.version}.`
                          : "Servidor respondeu, mas não informou a versão.",
                      );
                    })
                  }
                >
                  <ExternalLink /> Testar conexão
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={isPending}
                  onClick={() => {
                    if (!confirm("Remover a integração? A instância é apagada na Evolution."))
                      return;
                    startTransition(async () => {
                      const result = await removeWhatsappIntegration();
                      if (!result.ok) {
                        toast.error(result.error.message);
                        return;
                      }
                      toast.success("Integração removida.");
                      router.refresh();
                    });
                  }}
                >
                  <Trash2 /> Remover integração
                </Button>
              </>
            )}
          </div>
        )}
      </form>
    </Form>
  );
}
