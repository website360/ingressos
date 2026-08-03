"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarX, Loader2, Lock, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchAvailability } from "@/features/registrations/actions/registration.actions";
import { formatNumber } from "@/lib/format";
import { qk } from "@/constants/query-keys";
import { cn } from "@/lib/utils";

/**
 * Colunas de view chegam anuláveis dos tipos gerados — a normalização acontece
 * uma vez, aqui, em vez de espalhar `?? 0` pela renderização.
 */
export interface Availability {
  capacity: number | null;
  seats_taken: number | null;
  seats_available: number | null;
  status: string | null;
}

interface SeatCounterProps {
  eventId: string;
  registrationHref: string;
  initial: Availability;
}

/**
 * Contador de vagas e CTA.
 *
 * Revalida a cada 30s e fica fora do cache da landing: um número desatualizado
 * faz a pessoa preencher o formulário inteiro para descobrir no fim que a vaga
 * acabou (ADR-006).
 *
 * Não há lista de espera. Lotou, o botão desliga; se alguém cancelar, a vaga
 * simplesmente reaparece para quem estiver na página — por isso a atualização
 * automática importa ainda mais.
 */
export function SeatCounter({ eventId, registrationHref, initial }: SeatCounterProps) {
  const { data, isFetching } = useQuery<Availability | null>({
    queryKey: qk.events.availability(eventId),
    queryFn: () => fetchAvailability(eventId),
    initialData: initial,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const stats = data ?? initial;
  const available = Math.max(stats.seats_available ?? 0, 0);
  const capacity = stats.capacity ?? 0;
  const taken = stats.seats_taken ?? 0;
  const pct = capacity > 0 ? Math.min(Math.round((taken / capacity) * 100), 100) : 0;

  const closed = stats.status !== "publicado";
  const full = available === 0;
  const almostGone = !full && capacity > 0 && available / capacity <= 0.1;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" />
            {full ? "Todas as vagas preenchidas" : `${formatNumber(available)} vagas restantes`}
          </span>
          <span className="tabular text-xs text-muted-foreground">
            {formatNumber(taken)} / {formatNumber(capacity)}
            {isFetching && <Loader2 className="ml-1.5 inline size-3 animate-spin" />}
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              full ? "bg-destructive" : almostGone ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        {almostGone && (
          <Badge variant="warning">Últimas vagas — {formatNumber(available)} restantes</Badge>
        )}
      </div>

      {closed ? (
        <Button size="lg" className="w-full" disabled>
          <CalendarX /> Inscrições encerradas
        </Button>
      ) : full ? (
        <>
          <Button size="lg" className="w-full" disabled>
            <Lock /> Evento lotado
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Se alguém cancelar, a vaga volta a ficar disponível aqui. Vale acompanhar esta página.
          </p>
        </>
      ) : (
        <Button size="lg" className="w-full" asChild>
          <Link href={registrationHref}>Fazer inscrição gratuita</Link>
        </Button>
      )}
    </div>
  );
}
