"use client";

import * as React from "react";

import { Loader2, MapPinned, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { lookupCep, type AddressLookup } from "@/features/events/actions/address.actions";

function formatCep(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onResolved: (address: AddressLookup) => void;
}

/**
 * Campo de CEP que preenche o endereço.
 *
 * Dispara sozinho ao completar 8 dígitos — quem digita um CEP já quer o
 * endereço; obrigar a clicar num botão depois é trabalho sem propósito. O botão
 * existe só para repetir a busca quando algo falha.
 */
export function CepField({ value, onChange, onResolved }: Props) {
  const [isLoading, setIsLoading] = React.useState(false);
  const lastSearched = React.useRef<string>("");

  const search = React.useCallback(
    async (cep: string) => {
      const digits = cep.replace(/\D/g, "");
      if (digits.length !== 8 || digits === lastSearched.current) return;

      lastSearched.current = digits;
      setIsLoading(true);
      const result = await lookupCep(digits);
      setIsLoading(false);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      onResolved(result.data);

      toast.success(
        result.data.latitude
          ? "Endereço e coordenadas preenchidos."
          : "Endereço preenchido. Informe as coordenadas manualmente para usar o geofence.",
      );
    },
    [onResolved],
  );

  return (
    <FormItem>
      <FormLabel>CEP</FormLabel>
      <div className="flex gap-2">
        <FormControl>
          <Input
            value={value}
            inputMode="numeric"
            placeholder="00000-000"
            startIcon={isLoading ? <Loader2 className="animate-spin" /> : <MapPinned />}
            onChange={(event) => {
              const formatted = formatCep(event.target.value);
              onChange(formatted);
              void search(formatted);
            }}
          />
        </FormControl>
        <Button
          type="button"
          variant="outline"
          size="icon"
          loading={isLoading}
          onClick={() => {
            lastSearched.current = "";
            void search(value);
          }}
          aria-label="Buscar endereço pelo CEP"
        >
          <Search />
        </Button>
      </div>
      {/* Descrição curta: o campo divide a linha com logradouro e número, e um
          texto longo aqui desalinharia os três. O detalhe vai no toast. */}
      <FormDescription>Preenche o endereço.</FormDescription>
      <FormMessage />
    </FormItem>
  );
}
