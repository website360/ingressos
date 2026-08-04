"use client";

import * as React from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileSpreadsheet, FileText, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERIODOS } from "@/constants/periods";
import { useDebounce } from "@/hooks/use-debounce";

const TODOS = "__todos__";

const STATUS = [
  { value: "rascunho", label: "Rascunho" },
  { value: "publicado", label: "Publicado" },
  { value: "encerrado", label: "Encerrado" },
  { value: "cancelado", label: "Cancelado" },
];

/**
 * Filtros do relatório, sincronizados com a URL.
 *
 * Estado na querystring, não em `useState`: o recorte fica compartilhável, o
 * botão voltar funciona, e — o que mais importa aqui — os botões de exportação
 * reenviam a mesma querystring. Sem isso, o arquivo baixado sairia com a base
 * inteira enquanto a tela mostrava um recorte, que é a forma mais silenciosa de
 * entregar o número errado para uma reunião.
 */
export function ReportFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [termo, setTermo] = React.useState(searchParams.get("q") ?? "");
  const debounced = useDebounce(termo, 300);
  const termoAtual = searchParams.get("q") ?? "";

  const aplicar = React.useCallback(
    (chave: string, valor: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!valor || valor === TODOS) params.delete(chave);
      else params.set(chave, valor);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (debounced !== termoAtual) aplicar("q", debounced || null);
  }, [debounced, termoAtual, aplicar]);

  const query = searchParams.toString();
  const temFiltro = query.length > 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select value={searchParams.get("dias") ?? TODOS} onValueChange={(v) => aplicar("dias", v)}>
        <SelectTrigger className="w-full sm:w-48" aria-label="Período">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todo o período</SelectItem>
          {PERIODOS.map((periodo) => (
            <SelectItem key={periodo.value} value={periodo.value}>
              {periodo.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("status") ?? TODOS}
        onValueChange={(v) => aplicar("status", v)}
      >
        <SelectTrigger className="w-full sm:w-44" aria-label="Situação do evento">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todas as situações</SelectItem>
          {STATUS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-full min-w-40 sm:w-auto sm:flex-1">
        <Input
          value={termo}
          onChange={(evento) => setTermo(evento.target.value)}
          placeholder="Buscar evento pelo nome..."
          startIcon={<Search />}
          aria-label="Buscar evento"
          className="w-full"
        />
      </div>

      {temFiltro && (
        <Button variant="ghost" onClick={() => router.replace(pathname)}>
          <X /> Limpar
        </Button>
      )}

      {/* Links, não fetch: o navegador cuida do download e o arquivo nunca
          passa pela memória do JavaScript da página. */}
      <Button variant="outline" asChild>
        <a href={`/api/exports/relatorios/pdf${query ? `?${query}` : ""}`} download>
          <FileText /> PDF
        </a>
      </Button>
      <Button variant="outline" asChild>
        <a href={`/api/exports/relatorios/excel${query ? `?${query}` : ""}`} download>
          <FileSpreadsheet /> Excel
        </a>
      </Button>
    </div>
  );
}
