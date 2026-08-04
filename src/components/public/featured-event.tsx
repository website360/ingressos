import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, CalendarX, MapPin, Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicEvent } from "@/repositories/public.repository";

export function FeaturedEvent({ event }: { event: PublicEvent }) {
  // Cada imagem no lugar para o qual foi feita: o banner (16:6) é largo e vira
  // o fundo; a capa (16:9) é proporção de caixa e vai para o card.
  const backdrop = event.banner_url ?? event.cover_url;
  const image = event.cover_url ?? event.banner_url;
  const available = Math.max(event.capacity - event.seats_taken, 0);

  // Sobre foto, o texto é claro; sem foto, o destaque é uma caixa clara e o
  // texto segue o tema. É a diferença entre ter ou não um véu escuro atrás.
  const overPhoto = Boolean(backdrop);

  return (
    // O destaque é uma peça contida, na mesma coluna do resto da página. Uma
    // faixa sangrando até a borda da tela empurra o conteúdo para longe do
    // eixo de leitura e faz a foto competir com o texto; dentro de um cartão
    // ela vira ilustração do evento, que é o papel dela aqui.
    <section className="mx-auto w-full max-w-6xl px-4 pt-8 sm:pt-12">
      <div className="relative overflow-hidden rounded-2xl border shadow-sm">
        {backdrop ? (
          <>
            <Image
              src={backdrop}
              alt=""
              fill
              priority
              sizes="(max-width: 1152px) 100vw, 72rem"
              className="object-cover"
            />

            {/*
              Véu preto de opacidade única sobre a foto inteira — sem degradê e
              sem o brilho radial da marca. Gradiente sobre fotografia cria uma
              mancha que se lê como sujeira, não como design; a cobertura
              uniforme mostra a imagem por igual e mantém o contraste
              previsível. Escuro em vez de claro porque o véu claro lavava a
              foto até sobrar um cinza sem assunto, e porque texto branco sobre
              preto a 65% passa em contraste com folga em qualquer imagem.
            */}
            <div className="absolute inset-0 bg-black/65" aria-hidden />
          </>
        ) : (
          <>
            <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
            <div className="bg-radial-primary absolute inset-0" aria-hidden />
          </>
        )}

        <div className="relative px-6 py-12 sm:px-10 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_24rem]">
            <div className="space-y-5">
              {/*
                Sobre a foto o selo vira sólido. O padrão é um tom a 10% sobre
                fundo claro; a 10% sobre preto ele some, e o rótulo de lotação é
                a informação que decide se vale clicar.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="default"
                  className={cn(
                    overPhoto && "border-transparent bg-primary text-primary-foreground",
                  )}
                >
                  Próximo evento
                </Badge>
                {available === 0 ? (
                  <Badge
                    variant="destructive"
                    className={cn(
                      overPhoto && "border-transparent bg-destructive text-destructive-foreground",
                    )}
                  >
                    Lotado
                  </Badge>
                ) : available / event.capacity <= 0.1 ? (
                  <Badge
                    variant="warning"
                    className={cn(
                      overPhoto && "border-transparent bg-warning text-warning-foreground",
                    )}
                  >
                    Últimas vagas
                  </Badge>
                ) : (
                  <Badge
                    variant="success"
                    className={cn(
                      overPhoto && "border-transparent bg-success text-success-foreground",
                    )}
                  >
                    Inscrições abertas
                  </Badge>
                )}
              </div>

              <h1
                className={cn(
                  "text-4xl font-semibold tracking-tight sm:text-5xl",
                  overPhoto
                    ? "bg-gradient-to-br from-white to-white/70 bg-clip-text text-transparent"
                    : "text-gradient",
                )}
              >
                {event.name}
              </h1>

              {event.short_description && (
                <p className={cn("text-lg", overPhoto ? "text-white/80" : "text-muted-foreground")}>
                  {event.short_description}
                </p>
              )}

              {/*
                Um dado por linha. Em fila, data e local cabiam juntos e a
                lotação sobrava sozinha na quebra — um alinhamento acidental,
                que muda conforme o nome do local. Empilhado, os três ícones
                formam uma coluna e a leitura é sempre a mesma.
              */}
              <div className={cn("flex flex-col gap-2 text-sm", overPhoto && "text-white/90")}>
                <span className="flex items-center gap-2">
                  <CalendarDays
                    className={cn("size-4", overPhoto ? "text-white" : "text-primary")}
                  />
                  {formatDate(event.starts_at, "EEEE, dd 'de' MMMM 'de' yyyy 'às' HH:mm")}
                </span>
                {event.city && (
                  <span className="flex items-center gap-2">
                    <MapPin className={cn("size-4", overPhoto ? "text-white" : "text-primary")} />
                    {event.venue_name ? `${event.venue_name} · ` : ""}
                    {event.city}
                    {event.state ? `/${event.state}` : ""}
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <Users className={cn("size-4", overPhoto ? "text-white" : "text-primary")} />
                  {available > 0 ? `${formatNumber(available)} vagas restantes` : "Sem vagas"}
                </span>
              </div>

              <div className="pt-2">
                <Button size="lg" asChild>
                  <Link href={ROUTES.public.event(event.slug)}>
                    Ver evento e se inscrever <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>

            {/*
              A capa some no celular. Ali ela não fica ao lado do texto — cai
              embaixo, empurrando o botão de inscrição para fora da tela, e
              repete a mesma arte que já está no fundo do cartão. Some a
              duplicata, não a informação.
            */}
            <Link href={ROUTES.public.event(event.slug)} className="group hidden lg:block">
              <Card className="overflow-hidden shadow-lg transition-shadow group-hover:shadow-glow">
                {image ? (
                  /*
                    O card se molda à imagem, em vez de a imagem se moldar ao
                    card. A capa pedida no cadastro é 800×450, mas o que chega
                    varia — e uma caixa fixa em 16:9 recortava um quarto da
                    largura de qualquer arquivo mais largo que isso, comendo
                    justamente as pontas onde costuma estar o texto da arte.
                    `w-full h-auto` respeita a proporção do arquivo, seja ela
                    qual for, e nada é cortado.
                  */
                  <Image
                    src={image}
                    alt=""
                    width={800}
                    height={450}
                    priority
                    sizes="(max-width: 1024px) 100vw, 24rem"
                    className="h-auto w-full transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="bg-grid flex aspect-video w-full items-center justify-center bg-muted opacity-70">
                    <CalendarDays className="size-10 text-muted-foreground/40" />
                  </div>
                )}
              </Card>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Lugar do destaque quando não há nada para destacar. Distingue os dois motivos:
 * agenda vazia é informação sobre o site, filtro sem resultado é sobre a escolha
 * de quem está buscando — e só o segundo tem solução na mão da pessoa.
 */
export function EmptyHero({ filtered = false }: { filtered?: boolean }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-8 sm:pt-12">
      <div className="relative overflow-hidden rounded-2xl border shadow-sm">
        <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="bg-radial-primary absolute inset-0" aria-hidden />
        <div className="relative px-6 py-16 sm:px-10">
          <EmptyState
            icon={CalendarX}
            title={
              filtered ? "Nenhum evento para esses filtros" : "Nenhum evento com inscrições abertas"
            }
            description={
              filtered
                ? "Tente outra cidade ou amplie o período para ver mais opções."
                : "Assim que um novo evento for publicado, ele aparece aqui em destaque."
            }
            className="border-0"
          />
        </div>
      </div>
    </section>
  );
}
