"use client";

import * as React from "react";

import { History, LocateFixed, MapPin, Navigation, Search, Ticket, X } from "lucide-react";

import { EventCard } from "@/components/public/event-card";
import { EmptyHero, FeaturedEvent } from "@/components/public/featured-event";
import { LocationConsent } from "@/components/public/location-consent";
import { PublicBrand } from "@/components/public/public-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDetectedPlace } from "@/hooks/use-detected-place";
import { formatNumber } from "@/lib/format";
import { deaccent } from "@/lib/utils";
import type { PublicEvent } from "@/repositories/public.repository";

const ALL = "__all__";

/** Valor sentinela: dispara o GPS em vez de virar filtro. */
const LOCATE = "__locate__";

/**
 * O GPS informa, mas ainda não recorta.
 *
 * Nesta fase a home mostra a agenda inteira para todo mundo: a turnê tem
 * poucas paradas e uma cidade por vez, então esconder as outras tiraria da
 * frente justamente o que a pessoa talvez esteja procurando. A detecção
 * continua ligada e visível no campo de cidade — o que está desligado é ela
 * mexer no filtro sozinha.
 *
 * Para habilitar: trocar para `true`. O resto do caminho já está pronto.
 */
const AUTO_FILTRAR_POR_LOCALIZACAO: boolean = false;

/** Compara lugares pelo que a pessoa lê, não pelo que o provedor escreveu. */
function samePlace(a: string, b: string): boolean {
  return deaccent(a).toLowerCase() === deaccent(b).toLowerCase();
}

/**
 * Janela em dias, não "este mês". Quem procura evento pensa em "as próximas
 * semanas", e um recorte por mês civil esconde o evento do dia 2 quando a
 * pessoa entra no dia 28.
 */
const PERIODS = [
  { value: ALL, label: "Qualquer data" },
  { value: "7", label: "Próximos 7 dias" },
  { value: "30", label: "Próximos 30 dias" },
  { value: "90", label: "Próximos 3 meses" },
];

function placeOf(event: PublicEvent): string | null {
  if (!event.city) return null;
  return event.state ? `${event.city}/${event.state}` : event.city;
}

function matchesTerm(event: PublicEvent, term: string): boolean {
  if (!term) return true;
  const haystack = deaccent(
    [event.name, event.short_description, event.venue_name, placeOf(event)]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase();
  return deaccent(term)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

interface EventBrowserProps {
  upcoming: PublicEvent[];
  past: PublicEvent[];
}

/**
 * Filtro em memória, sobre as listas já entregues pelo servidor.
 *
 * A home carrega no máximo 24 eventos abertos e 12 encerrados — buscar de novo
 * no banco a cada tecla custaria uma ida ao servidor para ordenar algumas
 * dezenas de linhas, e ainda perderia o cache de 5 minutos da página. Se a
 * agenda crescer a ponto de precisar de paginação, o filtro migra para a
 * querystring e volta a ser feito no Postgres.
 */
export function EventBrowser({ upcoming, past }: EventBrowserProps) {
  const [term, setTerm] = React.useState("");
  const [place, setPlace] = React.useState(ALL);
  const [period, setPeriod] = React.useState(ALL);
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);

  const { state: detected, request: locate } = useDetectedPlace();

  // Escolha manual manda. Se a pessoa já disse qual cidade quer ver, o GPS
  // chegar depois e trocar por baixo seria o site desfazendo o que ela fez.
  const chosenByHand = React.useRef(false);

  // As cidades vêm do que existe em cartaz, não de uma lista fixa: um filtro
  // que oferece cidade sem evento é um beco sem saída.
  const places = React.useMemo(() => {
    const found = new Set<string>();
    for (const event of [...upcoming, ...past]) {
      const label = placeOf(event);
      if (label) found.add(label);
    }
    return Array.from(found).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [upcoming, past]);

  // Cotejo frouxo de propósito: o provedor devolve "Sao Paulo" onde o evento
  // guarda "São Paulo". Serve tanto para dizer se há evento na cidade detectada
  // quanto para, quando ligarmos o recorte automático, saber o que selecionar.
  const detectedInCatalog =
    detected.status === "ready"
      ? (places.find((label) => samePlace(label, detected.place.label)) ?? null)
      : null;

  React.useEffect(() => {
    if (!AUTO_FILTRAR_POR_LOCALIZACAO) return;
    if (detectedInCatalog && !chosenByHand.current) setPlace(detectedInCatalog);
  }, [detectedInCatalog]);

  function choosePlace(value: string) {
    chosenByHand.current = true;
    setPlace(value);
  }

  const filteredUpcoming = React.useMemo(() => {
    const deadline = period === ALL ? null : Date.now() + Number(period) * 24 * 60 * 60 * 1000;

    return upcoming.filter((event) => {
      if (place !== ALL && placeOf(event) !== place) return false;
      if (deadline !== null && new Date(event.starts_at).getTime() > deadline) return false;
      if (onlyAvailable && event.capacity - event.seats_taken <= 0) return false;
      return matchesTerm(event, term);
    });
  }, [upcoming, place, period, onlyAvailable, term]);

  // O histórico responde a lugar e busca, mas não a período nem a vagas: as duas
  // coisas só fazem sentido para evento que ainda vai acontecer.
  const filteredPast = React.useMemo(
    () =>
      past.filter(
        (event) => (place === ALL || placeOf(event) === place) && matchesTerm(event, term),
      ),
    [past, place, term],
  );

  const hasFilters = term !== "" || place !== ALL || period !== ALL || onlyAvailable;
  const [featured] = filteredUpcoming;

  function clear() {
    chosenByHand.current = true;
    setTerm("");
    setPlace(ALL);
    setPeriod(ALL);
    setOnlyAvailable(false);
  }

  return (
    <>
      {/*
        Só na home: é a porta de entrada. Numa página de evento a pessoa já veio
        de um link direto e sabe o que quer, e no formulário de inscrição o
        convite competiria com o preenchimento — ali o atalho fica dentro do
        próprio campo de cidade.
      */}
      <LocationConsent onPermitir={locate} />

      {/*
        Marca e filtros na mesma faixa fixa. Empilhar duas barras coladas no
        topo custaria 112px de tela antes do primeiro evento, e a de cima não
        carregaria nada além do logo. O contador saiu daqui: a mesma informação
        já encabeça a grade, logo abaixo.
      */}
      {/*
        Branco sólido, não o vidro translúcido: sobre o #f9f9f9 da página o
        `glass` deixava a barra num cinza quase igual ao fundo, e a linha entre
        as duas superfícies sumia. `bg-card` é o mesmo branco dos cartões —
        #ffffff no tema claro, e no escuro acompanha o tema em vez de virar uma
        faixa branca no meio da página.
      */}
      <div className="sticky top-0 z-30 border-b bg-card">
        {/*
          Mesma coluna do resto da página, com os campos crescendo para
          preenchê-la ponta a ponta — nada de vão à direita, e a barra continua
          alinhada com o herói e a grade. As proporções não são iguais de
          propósito: a busca leva o dobro dos seletores porque é onde se digita,
          e os dois botões ficam do tamanho do rótulo, que não ganha em esticar.
        */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-4">
          <PublicBrand />

          <LocationField
            value={place}
            places={places}
            onChange={choosePlace}
            detected={detected}
            onLocate={locate}
            inCatalog={detectedInCatalog !== null}
            fromGps={detectedInCatalog !== null && detectedInCatalog === place}
          />

          {/*
            O invólucro é que cresce: com `startIcon`, o Input embrulha o campo
            numa div, e é ela — não o <input> — que é o item do flex.
          */}
          <div className="w-full min-w-40 sm:w-auto sm:flex-[2]">
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Buscar evento ou local..."
              startIcon={<Search />}
              aria-label="Buscar evento"
              className="w-full"
            />
          </div>

          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger
              aria-label="Filtrar por período"
              className="w-full sm:w-auto sm:min-w-40 sm:flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant={onlyAvailable ? "default" : "outline"}
            aria-pressed={onlyAvailable}
            onClick={() => setOnlyAvailable((value) => !value)}
            className="shrink-0"
          >
            <Ticket /> Com vagas
          </Button>

          {hasFilters && (
            <Button type="button" variant="ghost" onClick={clear} className="shrink-0">
              <X /> Limpar
            </Button>
          )}
        </div>
      </div>

      {featured ? <FeaturedEvent event={featured} /> : <EmptyHero filtered={hasFilters} />}

      <div className="mx-auto w-full max-w-6xl space-y-14 px-4 py-14">
        {filteredUpcoming.length > 0 && (
          <section className="space-y-6">
            <header className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Próximos eventos</h2>
                <p className="text-sm text-muted-foreground">
                  {formatNumber(filteredUpcoming.length)}{" "}
                  {filteredUpcoming.length === 1
                    ? "evento com inscrições abertas"
                    : "eventos com inscrições abertas"}
                </p>
              </div>
            </header>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredUpcoming.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        )}

        {filteredPast.length > 0 && (
          <section className="space-y-6">
            <header>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <History className="size-5 text-muted-foreground" />
                Já aconteceram
              </h2>
              <p className="text-sm text-muted-foreground">
                Edições anteriores. As inscrições estão encerradas.
              </p>
            </header>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredPast.map((event) => (
                <EventCard key={event.id} event={event} past />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

interface LocationFieldProps {
  value: string;
  places: string[];
  onChange: (value: string) => void;
  detected: ReturnType<typeof useDetectedPlace>["state"];
  onLocate: () => void;
  /** Se a cidade detectada tem evento em cartaz. */
  inCatalog: boolean;
  /** Se o recorte atual veio do GPS, e não de uma escolha na lista. */
  fromGps: boolean;
}

/**
 * Cidade e geolocalização no mesmo campo.
 *
 * Eram dois controles vizinhos respondendo à mesma pergunta — "de onde são os
 * eventos que eu vejo?" — e isso obriga a pessoa a descobrir qual dos dois
 * manda. Aqui o GPS é a primeira opção da lista, e o que ele devolve aparece
 * como cabeçalho dela: continua sendo um fato sobre quem está lendo, mas mora
 * junto da escolha que ele afeta.
 */
function LocationField({
  value,
  places,
  onChange,
  detected,
  onLocate,
  inCatalog,
  fromGps,
}: LocationFieldProps) {
  const locating = detected.status === "locating";

  return (
    <Select value={value} onValueChange={(next) => (next === LOCATE ? onLocate() : onChange(next))}>
      <SelectTrigger
        aria-label="Cidade dos eventos"
        className="w-full justify-start gap-2 sm:w-auto sm:min-w-52 sm:flex-1 [&>svg:last-child]:ml-auto"
      >
        {/* O ícone diz de onde veio o recorte: seta quando foi o GPS, pino quando foi escolha. */}
        {fromGps ? (
          <Navigation className="size-4 shrink-0 text-primary" />
        ) : (
          <MapPin className="size-4 shrink-0 text-primary" />
        )}
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        {/* SelectLabel do Radix exige um SelectGroup em volta — sem ele, quebra. */}
        <SelectGroup>
          {detected.status === "ready" ? (
            <SelectLabel className="flex items-center gap-2 font-normal">
              <Navigation className="size-3.5 shrink-0 text-primary" />
              Você está em {detected.place.label}
              {!inCatalog && <span className="text-muted-foreground">· sem eventos aqui</span>}
            </SelectLabel>
          ) : (
            <SelectItem value={LOCATE} disabled={locating}>
              <span className="flex items-center gap-2">
                <LocateFixed className="size-4 shrink-0 text-primary" />
                {locating ? "Localizando..." : "Usar minha localização"}
              </span>
            </SelectItem>
          )}

          {detected.status === "failed" && (
            <SelectLabel className="pt-0 text-xs font-normal text-muted-foreground">
              {detected.message}
            </SelectLabel>
          )}
        </SelectGroup>

        <SelectSeparator />

        <SelectItem value={ALL}>Todas as cidades</SelectItem>
        {places.map((label) => (
          <SelectItem key={label} value={label}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
