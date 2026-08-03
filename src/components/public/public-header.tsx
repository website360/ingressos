"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ticket } from "lucide-react";

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
 * Cabeçalho das páginas públicas — menos a home.
 *
 * Na home a marca divide a linha com os filtros, dentro da própria barra: são
 * duas faixas fixas empilhadas ocupando 112px de tela antes de qualquer
 * conteúdo, e a de cima carrega um logo e nada mais. Aqui, onde não há filtro,
 * o cabeçalho segue sozinho.
 */
export function PublicHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <PublicBrand />
      </div>
    </header>
  );
}
