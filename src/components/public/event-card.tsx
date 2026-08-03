import Image from "next/image";
import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { formatDate, formatNumber } from "@/lib/format";
import type { PublicEvent } from "@/repositories/public.repository";

export function EventCard({ event, past = false }: { event: PublicEvent; past?: boolean }) {
  const image = event.cover_url ?? event.banner_url;
  const available = Math.max(event.capacity - event.seats_taken, 0);

  return (
    <Link href={ROUTES.public.event(event.slug)} className="group">
      <Card
        className={`h-full overflow-hidden transition-shadow group-hover:shadow-md ${past ? "opacity-80" : ""}`}
      >
        {/*
          A caixa segue os 16:9 que o cadastro pede para a capa (800×450), então
          um arquivo dentro da especificação preenche sem sobrar nem faltar. A
          altura fixa anterior — 144px numa coluna de ~380px — dava uma faixa de
          2,5:1 e comia quase um terço da altura de qualquer capa correta.

          `object-contain` fecha a brecha do que vem fora do padrão: em vez de
          recortar, o que não bate com a proporção aparece inteiro sobre o fundo
          neutro. Numa grade, cartão de altura uniforme importa mais do que
          preencher cada moldura até a borda.
        */}
        <div className="relative aspect-video w-full bg-muted">
          {image ? (
            <Image
              src={image}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 33vw"
              className={`object-contain ${past ? "grayscale" : ""}`}
            />
          ) : (
            <div className="bg-grid size-full opacity-60" aria-hidden />
          )}
        </div>

        <CardContent className="space-y-3 p-5">
          {past ? (
            <Badge variant="muted">Encerrado</Badge>
          ) : available === 0 ? (
            <Badge variant="destructive">Lotado</Badge>
          ) : available / event.capacity <= 0.1 ? (
            <Badge variant="warning">Últimas vagas</Badge>
          ) : (
            <Badge variant="success">Inscrições abertas</Badge>
          )}

          <h3 className="line-clamp-2 font-semibold leading-tight transition-colors group-hover:text-primary">
            {event.name}
          </h3>

          {event.short_description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{event.short_description}</p>
          )}

          <div className="space-y-1.5 pt-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {formatDate(event.starts_at, "dd 'de' MMMM',' HH:mm")}
            </p>
            {event.city && (
              <p className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {event.city}
                {event.state ? `/${event.state}` : ""}
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {past
                ? `${formatNumber(event.seats_taken)} participantes`
                : available > 0
                  ? `${formatNumber(available)} vagas restantes`
                  : "Sem vagas"}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
