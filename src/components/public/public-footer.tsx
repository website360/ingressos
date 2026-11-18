"use client";

import { usePathname } from "next/navigation";

/**
 * Aviso de LGPD das páginas de evento e inscrição. Na home não aparece: ela
 * está em branco por enquanto e não coleta dado nenhum.
 */
export function PublicFooter() {
  if (usePathname() === "/") return null;

  return (
    <footer className="border-t py-8">
      <div className="mx-auto w-full max-w-6xl px-4 text-center text-xs text-muted-foreground">
        <p>
          Seus dados são tratados conforme a Lei Geral de Proteção de Dados (LGPD) e utilizados
          exclusivamente para a gestão da sua participação no evento.
        </p>
      </div>
    </footer>
  );
}
