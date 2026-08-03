"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * Exportação da lista atual.
 *
 * Reenvia os filtros da URL para a rota de exportação: o arquivo baixado é
 * exatamente o que está na tela. Exportar tudo quando o usuário filtrou é a
 * forma mais silenciosa de entregar o dado errado.
 */
export function ExportButton({ href, label = "Exportar CSV" }: { href: string; label?: string }) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  return (
    <Button variant="outline" asChild>
      <a href={`${href}${query ? `?${query}` : ""}`} download>
        <Download /> {label}
      </a>
    </Button>
  );
}
