"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Gauge, Save } from "lucide-react";

import { whatsappCapacitySchema, type WhatsappCapacityInput } from "@shared/schemas/whatsapp";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { saveWhatsappCapacity } from "@/features/envios/actions/queue.actions";
import { toastActionFailure } from "@/lib/action-failure";
import { formatDuration } from "@/lib/outbox/estimate";

interface Props {
  ratePerSecond: number;
  dailyUniqueLimit: number;
  workerConcurrency: number;
  messagingTier: string | null;
  canEdit: boolean;
}

/**
 * Capacidade do número na API oficial.
 *
 * Os dois números que importam vêm da Meta: a VAZÃO do número (80/s por
 * padrão) e o NÍVEL de limite da conta (destinatários únicos em 24 h). Pôr
 * aqui mais do que a conta tem não acelera nada — a Meta recusa e a
 * qualidade do número cai. A tela mostra a conta de 100 mil para deixar
 * isso concreto.
 */
export function WhatsappCapacityForm({
  ratePerSecond,
  dailyUniqueLimit,
  workerConcurrency,
  messagingTier,
  canEdit,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<WhatsappCapacityInput>({
    resolver: zodResolver(whatsappCapacitySchema),
    defaultValues: {
      rate_per_second: ratePerSecond,
      daily_unique_limit: dailyUniqueLimit,
      worker_concurrency: workerConcurrency,
    },
  });

  const rate = Number(form.watch("rate_per_second")) || 0;
  const daily = Number(form.watch("daily_unique_limit")) || 0;
  const cemMil =
    rate > 0
      ? daily >= 100_000
        ? formatDuration(100_000 / rate)
        : `${Math.ceil(100_000 / Math.max(daily, 1))} dias (limitado pelo teto de 24 h)`
      : "—";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          startTransition(async () => {
            try {
              const result = await saveWhatsappCapacity(values);
              if (!result.ok) {
                toast.error(result.error.message);
                return;
              }
              toast.success("Capacidade atualizada.");
              router.refresh();
            } catch (error) {
              toastActionFailure(error);
            }
          }),
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4" /> Capacidade do número (API oficial)
            </CardTitle>
            <CardDescription>
              Um número só para todos os eventos. Use os valores que a Meta mostra para a sua conta
              {messagingTier ? ` (nível atual informado pela Meta: ${messagingTier})` : ""}.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="rate_per_second"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensagens por segundo</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={1000} disabled={!canEdit || isPending} {...field} />
                    </FormControl>
                    <FormDescription>Para o número inteiro. Padrão da Meta: 80.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="daily_unique_limit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destinatários em 24 h</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} disabled={!canEdit || isPending} {...field} />
                    </FormControl>
                    <FormDescription>O nível de limite da conta na Meta.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="worker_concurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Envios simultâneos</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={256} disabled={!canEdit || isPending} {...field} />
                    </FormControl>
                    <FormDescription>Requisições em voo por worker.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Alert>
              <AlertDescription>
                Com estes valores, 100 mil confirmações levam <strong>{cemMil}</strong>. A
                inscrição nunca espera: a mensagem fica na fila e sai nesse ritmo.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button type="submit" loading={isPending}>
              <Save /> Salvar capacidade
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
