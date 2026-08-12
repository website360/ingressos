"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AlertTriangle, LocateFixed, Loader2, Navigation, ShieldCheck } from "lucide-react";

import { registrationSchema, type RegistrationInput } from "@shared/schemas/registration";
import { formatCpf } from "@shared/validation/cpf";
import { BR_STATES, formatBrPhone, isValidBrState } from "@shared/validation/phone";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROUTES } from "@/constants/routes";
import { submitRegistration } from "@/features/registrations/actions/registration.actions";
import { useDetectedPlace } from "@/hooks/use-detected-place";

interface Props {
  eventId: string;
  eventSlug: string;
  eventName: string;
  isFull: boolean;
}

export function RegistrationForm({ eventId, eventSlug, eventName, isFull }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<RegistrationInput>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      full_name: "",
      cpf: "",
      phone: "",
      email: "",
      city: "",
      accept_lgpd: false,
      accept_rules: false,
    } as never,
  });

  const { state: detected, request: locate } = useDetectedPlace();

  /*
    Cidade e estado vêm preenchidos quando a localização é conhecida — mas só
    por cima de campo vazio. Sobrescrever o que a pessoa digitou seria pior do
    que não preencher nada: ela mora em Canoas, escreveu Canoas, e o GPS troca
    por Porto Alegre no meio do formulário sem ela ver.

    Quem já autorizou a localização numa visita anterior chega com os campos
    prontos, sem clicar em nada; quem não autorizou vê o atalho abaixo do campo.
  */
  React.useEffect(() => {
    if (detected.status !== "ready") return;

    const atual = form.getValues();
    if (!atual.city?.trim()) {
      form.setValue("city", detected.place.city, { shouldValidate: true });
    }
    if (!atual.state && detected.place.state && isValidBrState(detected.place.state)) {
      form.setValue("state", detected.place.state, { shouldValidate: true });
    }
  }, [detected, form]);

  function onSubmit(values: RegistrationInput) {
    startTransition(async () => {
      const result = await submitRegistration(eventId, values);

      if (!result.ok) {
        // Erros de regra de negócio vêm do banco já traduzidos (docs/02, §12).
        toast.error(result.error.message);
        if (result.error.code === "ALREADY_REGISTERED") {
          form.setError("cpf", { message: result.error.message });
        }
        return;
      }

      router.push(`${ROUTES.public.registrationSuccess(eventSlug)}?token=${result.data.token}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {isFull && (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Evento lotado</AlertTitle>
            <AlertDescription>
              As vagas se esgotaram e não existe lista de espera. Se alguém cancelar, a vaga volta a
              ficar livre nesta página — quem chegar primeiro garante o lugar.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Nome completo</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cpf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPF</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      // Máscara na digitação; o schema normaliza para dígitos.
                      onChange={(event) => field.onChange(formatCpf(event.target.value))}
                    />
                  </FormControl>
                  <FormDescription>Usado para validar sua entrada no evento.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="tel"
                      placeholder="(11) 99999-8888"
                      onChange={(event) => field.onChange(formatBrPhone(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" autoComplete="email" />
                  </FormControl>
                  <FormDescription>O ingresso será enviado para este endereço.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cidade</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="address-level2" />
                  </FormControl>
                  <LocationHint state={detected} onLocate={locate} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="UF" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BR_STATES.map((uf) => (
                        <SelectItem key={uf} value={uf}>
                          {uf}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Consentimentos: gravados com versão, data, IP e user agent. */}
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-primary" />
              Consentimentos
            </p>

            <FormField
              control={form.control}
              name="accept_lgpd"
              render={({ field }) => (
                <FormItem className="flex items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="mt-0.5"
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel className="font-normal leading-snug">
                      Autorizo o tratamento dos meus dados pessoais para a gestão da minha
                      participação neste evento, conforme a LGPD.
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accept_rules"
              render={({ field }) => (
                <FormItem className="flex items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="mt-0.5"
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel className="font-normal leading-snug">
                      Li e aceito o regulamento e a política de cancelamento do evento
                      <span className="font-medium"> {eventName}</span>.
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Button type="submit" size="lg" className="w-full" loading={isPending} disabled={isFull}>
          {isPending ? (
            <>
              <Loader2 className="animate-spin" /> Confirmando...
            </>
          ) : isFull ? (
            "Evento lotado"
          ) : (
            "Confirmar inscrição"
          )}
        </Button>
      </form>
    </Form>
  );
}

/**
 * Atalho de localização abaixo do campo de cidade.
 *
 * Fica onde o preenchimento acontece, e não no topo do formulário: é ali que a
 * pessoa percebe que teria de digitar, e é ali que a oferta de poupar a digitação
 * faz sentido. Nunca pede a permissão sozinho — o pop-up do navegador no meio de
 * um formulário de inscrição é lido como interrupção, e a negativa fica gravada
 * para a origem inteira.
 */
function LocationHint({
  state,
  onLocate,
}: {
  state: ReturnType<typeof useDetectedPlace>["state"];
  onLocate: () => void;
}) {
  if (state.status === "ready") {
    return (
      <FormDescription className="flex items-center gap-1.5">
        <Navigation className="size-3.5 shrink-0 text-primary" />
        Preenchido pela sua localização.
      </FormDescription>
    );
  }

  const locating = state.status === "locating";

  return (
    <FormDescription className="flex flex-wrap items-center gap-x-2">
      <Button
        type="button"
        variant="link"
        onClick={onLocate}
        disabled={locating}
        className="h-auto gap-1.5 p-0 text-xs font-normal"
      >
        {locating ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <LocateFixed className="size-3.5" />
        )}
        {locating ? "Localizando..." : "Usar minha localização"}
      </Button>
      {state.status === "failed" && <span>{state.message}</span>}
    </FormDescription>
  );
}
