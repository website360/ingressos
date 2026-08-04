"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

type Formato = "csv" | "excel";

const APARENCIA: Record<Formato, { rotulo: string; Icone: typeof Download }> = {
  csv: { rotulo: "CSV", Icone: Download },
  excel: { rotulo: "Excel", Icone: FileSpreadsheet },
};

/**
 * Exportação da lista atual.
 *
 * Reenvia os filtros da URL para a rota de exportação: o arquivo baixado é
 * exatamente o que está na tela. Exportar tudo quando o usuário filtrou é a
 * forma mais silenciosa de entregar o dado errado.
 *
 * É um link, não um `fetch`: o download fica a cargo do navegador, e o arquivo
 * nunca passa pela memória do JavaScript da página — o que importa quando a
 * lista tem milhares de linhas.
 */
export function ExportButton({
  href,
  formato = "csv",
  label,
}: {
  href: string;
  formato?: Formato;
  label?: string;
}) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const { rotulo, Icone } = APARENCIA[formato];

  return (
    <Button variant="outline" asChild>
      <a href={`${href}${query ? `?${query}` : ""}`} download>
        <Icone /> {label ?? rotulo}
      </a>
    </Button>
  );
}
