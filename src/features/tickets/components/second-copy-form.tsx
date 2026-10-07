"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, Info, Loader2, MapPin, Search, Ticket } from "lucide-react";

import {
  TICKET_CODE_LENGTH,
  TICKET_CODE_TTL_MINUTES,
  ticketCodeRequestSchema,
  ticketCodeVerifySchema,
  type SecondCopyTicket,
  type TicketCodeRequestInput,
  type TicketCodeVerifyInput,
} from "@shared/schemas/second-copy";
import { formatCpf, onlyDigits } from "@shared/validation/cpf";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  requestTicketCode,
  verifyTicketCode,
} from "@/features/tickets/actions/second-copy.actions";
import { formatInTimezone } from "@/lib/format";

/**
 * Segunda via em três estados numa página só.
 *
 * Uma página por passo exigiria carregar o CPF entre rotas — na URL (que vaza
 * no histórico e no referer) ou em cookie. Mantendo os três estados aqui, o CPF
 * digitado não sai da memória da aba.
 */
type Etapa =
  | { nome: "cpf" }
  | { nome: "codigo"; cpf: string; emailMask: string | null; phoneMask: string | null }
  | { nome: "ingressos"; tickets: SecondCopyTicket[] };

/** Segundos de espera antes de liberar o "enviar de novo". */
const REENVIO_SEGUNDOS = 60;

export function SecondCopyForm() {
  const [etapa, setEtapa] = React.useState<Etapa>({ nome: "cpf" });

  if (etapa.nome === "codigo") {
    return (
      <CodigoStep
        cpf={etapa.cpf}
        emailMask={etapa.emailMask}
        phoneMask={etapa.phoneMask}
        onVoltar={() => setEtapa({ nome: "cpf" })}
        onConferido={(tickets) => setEtapa({ nome: "ingressos", tickets })}
      />
    );
  }

  if (etapa.nome === "ingressos") {
    return <IngressosStep tickets={etapa.tickets} />;
  }

  return <CpfStep onEnviado={(proxima) => setEtapa(proxima)} />;
}

// -----------------------------------------------------------------------------
// Passo 1 — CPF
// -----------------------------------------------------------------------------

function CpfStep({ onEnviado }: { onEnviado: (etapa: Etapa) => void }) {
  const [isPending, startTransition] = React.useTransition();
  const [semInscricao, setSemInscricao] = React.useState(false);

  const form = useForm<TicketCodeRequestInput>({
    resolver: zodResolver(ticketCodeRequestSchema),
    defaultValues: { cpf: "" } as never,
  });

  function onSubmit(values: TicketCodeRequestInput) {
    setSemInscricao(false);

    startTransition(async () => {
      const result = await requestTicketCode(values);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      if (!result.data.found) {
        setSemInscricao(true);
        return;
      }

      onEnviado({
        nome: "codigo",
        cpf: onlyDigits(values.cpf),
        emailMask: result.data.email_mask,
        phoneMask: result.data.phone_mask,
      });
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardContent className="space-y-4 p-6">
            <FormField
              control={form.control}
              name="cpf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPF usado na inscrição</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="000.000.000-00"
                      onChange={(event) => field.onChange(formatCpf(event.target.value))}
                    />
                  </FormControl>
                  <FormDescription>
                    Vamos enviar um código para o e-mail e o WhatsApp que você cadastrou. O ingresso
                    em si não vai por mensagem — ele aparece aqui, depois do código.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
              {isPending ? <Loader2 className="animate-spin" /> : <Search />}
              Enviar código
            </Button>
          </CardContent>
        </Card>

        {semInscricao && (
          <Alert variant="warning">
            <Info />
            <AlertTitle>Nenhuma inscrição ativa com esse CPF</AlertTitle>
            <AlertDescription>
              Não encontramos inscrição confirmada em evento que ainda vai acontecer. Confira se
              digitou o CPF certo — ou veja a agenda e faça sua inscrição.
              <Link href={ROUTES.public.events} className="ml-1 font-medium underline">
                Ver eventos
              </Link>
            </AlertDescription>
          </Alert>
        )}
      </form>
    </Form>
  );
}

// -----------------------------------------------------------------------------
// Passo 2 — código
// -----------------------------------------------------------------------------

function CodigoStep({
  cpf,
  emailMask,
  phoneMask,
  onVoltar,
  onConferido,
}: {
  cpf: string;
  emailMask: string | null;
  phoneMask: string | null;
  onVoltar: () => void;
  onConferido: (tickets: SecondCopyTicket[]) => void;
}) {
  const [isPending, startTransition] = React.useTransition();
  const [espera, setEspera] = React.useState(REENVIO_SEGUNDOS);

  const form = useForm<TicketCodeVerifyInput>({
    resolver: zodResolver(ticketCodeVerifySchema),
    defaultValues: { cpf, code: "" } as never,
  });

  // Contagem para liberar o reenvio. Sem ela, quem não recebeu fica clicando
  // num botão que o banco vai recusar no terceiro pedido.
  React.useEffect(() => {
    if (espera <= 0) return;
    const timer = setTimeout(() => setEspera((restante) => restante - 1), 1000);
    return () => clearTimeout(timer);
  }, [espera]);

  function onSubmit(values: TicketCodeVerifyInput) {
    startTransition(async () => {
      const result = await verifyTicketCode(values);

      if (!result.ok) {
        form.setError("code", { message: result.error.message });
        return;
      }

      if (result.data.tickets.length === 0) {
        toast.error("Não encontramos ingresso ativo para esse CPF.");
        onVoltar();
        return;
      }

      onConferido(result.data.tickets);
    });
  }

  function reenviar() {
    startTransition(async () => {
      const result = await requestTicketCode({ cpf });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setEspera(REENVIO_SEGUNDOS);
      form.setValue("code", "");
      toast.success("Enviamos um código novo. O anterior deixou de valer.");
    });
  }

  const destinos = [emailMask, phoneMask].filter(Boolean) as string[];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="space-y-1 text-sm">
              <p className="font-medium">Código enviado</p>
              <p className="text-muted-foreground">
                {destinos.length > 0
                  ? `Confira ${destinos.join(" e ")}.`
                  : "Confira suas mensagens."}{" "}
                Pode levar até um minuto para chegar.
              </p>
            </div>

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código de {TICKET_CODE_LENGTH} dígitos</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={TICKET_CODE_LENGTH}
                      placeholder="000000"
                      className="max-w-[12rem] text-center text-2xl tracking-[0.4em]"
                      onChange={(event) =>
                        field.onChange(onlyDigits(event.target.value).slice(0, TICKET_CODE_LENGTH))
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    Vale por {TICKET_CODE_TTL_MINUTES} minutos e só pode ser usado uma vez.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <Ticket />}
                Ver meus ingressos
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={reenviar}
                disabled={isPending || espera > 0}
              >
                {espera > 0 ? `Enviar de novo em ${espera}s` : "Enviar de novo"}
              </Button>

              <Button type="button" variant="link" onClick={onVoltar} className="px-1">
                Trocar o CPF
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}

// -----------------------------------------------------------------------------
// Passo 3 — ingressos
// -----------------------------------------------------------------------------

function IngressosStep({ tickets }: { tickets: SecondCopyTicket[] }) {
  const router = useRouter();

  // Uma inscrição só não merece uma lista de um item: vai direto ao ingresso.
  const unico = tickets.length === 1 ? tickets[0] : undefined;

  React.useEffect(() => {
    if (unico) router.replace(ROUTES.public.ticket(unico.token));
  }, [unico, router]);

  if (unico) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Abrindo seu ingresso...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Você tem {tickets.length} inscrições ativas. Escolha qual ingresso quer abrir.
      </p>

      {tickets.map((ticket) => (
        <Link key={ticket.token} href={ROUTES.public.ticket(ticket.token)} className="block">
          <Card className="transition-colors hover:border-primary">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-medium">{ticket.event_name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5 shrink-0" />
                  {formatInTimezone(ticket.event_starts_at, undefined, {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                </p>
                {(ticket.venue || ticket.city) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" />
                    {[ticket.venue, ticket.city].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Inscrição {ticket.number}</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
