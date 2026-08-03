"use client";

import * as React from "react";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelect {
  /** Nome do parâmetro na querystring. */
  key: string;
  placeholder: string;
  options: FilterOption[];
}

interface ListFiltersProps {
  searchPlaceholder?: string;
  selects?: FilterSelect[];
}

const ALL = "__all__";

/**
 * Filtros de lista sincronizados com a URL.
 *
 * Estado na querystring, não em useState: o link fica compartilhável, o botão
 * voltar funciona e a busca é feita no servidor, sobre a base inteira — não
 * sobre a página já carregada.
 */
export function ListFilters({ searchPlaceholder = "Buscar...", selects = [] }: ListFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [term, setTerm] = React.useState(searchParams.get("q") ?? "");
  const debounced = useDebounce(term, 300);
  const currentQuery = searchParams.get("q") ?? "";

  const apply = React.useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === ALL) params.delete(key);
      else params.set(key, value);
      params.delete("cursor");
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (debounced !== currentQuery) apply("q", debounced || null);
  }, [debounced, currentQuery, apply]);

  const hasFilters = Array.from(searchParams.keys()).some((key) => key !== "cursor");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={searchPlaceholder}
        startIcon={<Search />}
        className="w-full sm:max-w-xs"
      />

      {selects.map((select) => (
        <Select
          key={select.key}
          value={searchParams.get(select.key) ?? ALL}
          onValueChange={(value) => apply(select.key, value)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={select.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{select.placeholder}</SelectItem>
            {select.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
          <X /> Limpar
        </Button>
      )}
    </div>
  );
}
