"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Gauge, Save } from "lucide-react";

import { whatsappPacingSchema, type WhatsappPacingInput } from "@shared/schemas/whatsapp";

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
import { saveWhatsappPacing } from "@/features/envios/actions/log.actions";
import { formatDuration } from "@/lib/outbox/estimate";

interface Props {
  intervalSeconds: number;
  dailyLimit: number;
  canEdit: boolean;
}

/**
 * Ritmo de envio do WhatsApp.
 *
 * Mostra em tempo real quanto tempo um lote levaria com os valores digitados —
 * "300 mensagens levam 1h40" é mais concreto do que "intervalo de 20s", e é
 * essa a conta que decide se o número sobrevive.
 */
export function WhatsappPacingForm({ intervalSeconds, dailyLimit, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<WhatsappPacingInput>({
    resolver: zodResolver(whatsappPacingSchema),
    defaultValues: { send_interval_seconds: intervalSeconds, daily_send_limit: dailyLimit },
  });

  const intervalo = Number(form.watch("send_interval_seconds")) || 0;
  const teto = Number(form.watch("daily_send_limit")) || 0;
  const duracaoTeto = teto > 1 ? formatDuration((teto - 1) * intervalo) : "imediato";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          startTransition(async () => {
            const result = await saveWhatsappPacing(values);
            if (!result.ok) {
              toast.error(result.error.message);
              return;
            }
            toast.success("Ritmo de envio atualizado.");
            router.refresh();
          }),
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4" /> Ritmo de envio
            </CardTitle>
            <CardDescription>
              O WhatsApp bane número que dispara em rajada. As mensagens saem espaçadas e param ao
              bater o teto do dia, retomando no dia seguinte.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="send_interval_seconds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Intervalo entre mensagens</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={5}
                        max={3600}
                        disabled={!canEdit || isPending}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Em segundos. Abaixo de 10s o risco sobe muito.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="daily_send_limit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Máximo por dia</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100000}
                        disabled={!canEdit || isPending}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Número novo aguenta pouco: comece baixo e suba ao longo de semanas.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Alert>
              <AlertDescription>
                Com estes valores, um dia cheio ({teto} mensagens) leva{" "}
                <strong>{duracaoTeto}</strong>. Um evento com 500 inscritos levaria{" "}
                {Math.ceil(500 / Math.max(teto, 1))} dia(s).
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {canEdit && (
          <div className="mt-4">
            <Button type="submit" disabled={isPending}>
              <Save /> Salvar ritmo
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
