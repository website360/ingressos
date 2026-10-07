"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ticket, TicketCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";

/** Marca da área pública. Um componente só, para a home e o resto não divergirem. */
export function PublicBrand() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Ticket className="size-4" />
      </span>
      Ingressos
    </Link>
  );
}

/**
 * Atalho para a segunda via.
 *
 * Mora aqui, junto da marca, porque é o mesmo atalho na barra da home e no
 * cabeçalho das outras páginas — e quem perdeu o ingresso procura no topo, não
 * no rodapé. No celular fica só o ícone: a barra da home já divide a linha com
 * o botão de filtros, e a terceira etiqueta a quebrava em duas.
 *
 * Na própria página de segunda via o atalho desaparece — link para onde já se
 * está é ruído.
 */
export function SecondCopyLink({ className }: { className?: string }) {
  const pathname = usePathname();
  if (pathname === ROUTES.public.secondCopy) return null;

  return (
    <Button asChild variant="ghost" size="sm" className={cn("shrink-0", className)}>
      <Link href={ROUTES.public.secondCopy} aria-label="Segunda via do ingresso">
        <TicketCheck />
        <span className="hidden sm:inline">Segunda via</span>
      </Link>
    </Button>
  );
}

/**
 * Cabeçalho das páginas públicas — menos a home.
 *
 * Na home a marca divide a linha com os filtros, dentro da própria barra: são
 * duas faixas fixas empilhadas ocupando 112px de tela antes de qualquer
 * conteúdo, e a de cima carrega um logo e nada mais. Aqui, onde não há filtro,
 * sobram a marca e o atalho da segunda via.
 */
export function PublicHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <PublicBrand />
        <SecondCopyLink />
      </div>
    </header>
  );
}
