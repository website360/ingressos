"use client";

import * as React from "react";

import { useWatch, type UseFormReturn } from "react-hook-form";

import type { EventInput } from "@shared/schemas/event";
import { BR_STATES } from "@shared/validation/phone";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AddressLookup } from "@/features/events/actions/address.actions";
import { CepField } from "@/features/events/components/cep-field";
import { ROUTES } from "@/constants/routes";
import { deaccent, slugify } from "@/lib/utils";

/**
 * Blocos de campo do evento, compartilhados entre a tela de edição (abas) e o
 * assistente de criação (etapas). Cada bloco é feito para morar numa grade
 * `grid gap-4 md:grid-cols-2` — quem decide o cartão em volta é a tela.
 */
interface FieldsProps {
  form: UseFormReturn<EventInput>;
}

export function EventNameField({ form }: FieldsProps) {
  return (
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>Nome do evento</FormLabel>
          <FormControl>
            <Input {...field} placeholder="Congresso de Tecnologia 2026" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Normaliza o que a pessoa digita no endereço, sem atrapalhar a digitação:
 * diferente de `slugify`, mantém o hífen do fim ("meu-" enquanto vem "show").
 */
function slugifyTyping(value: string): string {
  return deaccent(value)
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-/, "");
}

/**
 * Endereço na web do evento.
 *
 * Com `followName`, acompanha o nome enquanto a pessoa não mexe nele. Quem
 * marca "mexeu" é a digitação no próprio campo — não `dirtyFields`, que o
 * `setValue` automático também acabava acionando e travava o endereço na
 * primeira letra. Apagar o endereço todo volta a acompanhar o nome.
 */
export function EventSlugField({ form, followName = false }: FieldsProps & { followName?: boolean }) {
  const [customized, setCustomized] = React.useState(false);
  const name = useWatch({ control: form.control, name: "name" });
  const slug = useWatch({ control: form.control, name: "slug" });
  const [origin, setOrigin] = React.useState("");

  React.useEffect(() => setOrigin(window.location.origin), []);

  React.useEffect(() => {
    if (!followName || customized) return;
    const next = slugify(name ?? "");
    if (next === form.getValues("slug")) return;
    form.setValue("slug", next, { shouldValidate: form.formState.isSubmitted });
  }, [name, followName, customized, form]);

  return (
    <FormField
      control={form.control}
      name="slug"
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>Endereço na web</FormLabel>
          <FormControl>
            <Input
              {...field}
              placeholder="congresso-tecnologia-2026"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                const value = slugifyTyping(e.target.value);
                setCustomized(value !== "");
                field.onChange(value);
              }}
              onBlur={() => {
                // Saiu com o campo vazio: volta a seguir o nome.
                const value = slugify(field.value ?? "");
                field.onChange(value || (followName ? slugify(name ?? "") : ""));
                field.onBlur();
              }}
            />
          </FormControl>
          <FormDescription className="break-all">
            {origin ? (
              <>
                Link do evento: {origin}
                {ROUTES.public.event("")}
                <span className="font-medium text-foreground">{slug || "…"}</span>
              </>
            ) : (
              "Usado no link público do evento."
            )}
            {followName && !customized && " · acompanha o nome; edite para personalizar."}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function EventDescriptionFields({ form }: FieldsProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="short_description"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>Descrição curta</FormLabel>
            <FormControl>
              <Input {...field} maxLength={280} placeholder="Uma frase que resume o evento." />
            </FormControl>
            <FormDescription>
              Até 280 caracteres. Aparece nos cards e no compartilhamento.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>Descrição completa</FormLabel>
            <FormControl>
              <textarea
                {...field}
                rows={6}
                className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                placeholder="Detalhe a programação, o público-alvo e o que o participante vai levar."
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function EventDateFields({ form }: FieldsProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="starts_at"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Início</FormLabel>
            <FormControl>
              <Input {...field} type="datetime-local" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="ends_at"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Término</FormLabel>
            <FormControl>
              <Input {...field} type="datetime-local" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function EventCapacityField({ form }: FieldsProps) {
  return (
    <FormField
      control={form.control}
      name="capacity"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Capacidade</FormLabel>
          <FormControl>
            <Input {...field} type="number" min={1} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function EventRegistrationFields({ form }: FieldsProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="overbooking_pct"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Overbooking (%)</FormLabel>
            <FormControl>
              <Input {...field} type="number" min={0} max={50} step="0.5" />
            </FormControl>
            <FormDescription>Margem extra sobre a capacidade. 0 desativa.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="registration_deadline"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Prazo final de inscrição</FormLabel>
            <FormControl>
              <Input {...field} type="datetime-local" />
            </FormControl>
            <FormDescription>Opcional. Vazio = até o início do evento.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function EventLocationFields({ form }: FieldsProps) {
  /** CEP resolvido: preenche o endereço e as coordenadas de uma vez. */
  const applyAddress = React.useCallback(
    (address: AddressLookup) => {
      form.setValue("address", address.address, { shouldDirty: true });
      form.setValue("district", address.district, { shouldDirty: true });
      form.setValue("city", address.city, { shouldDirty: true });
      form.setValue("state", address.state as EventInput["state"], { shouldDirty: true });

      if (address.latitude != null && address.longitude != null) {
        form.setValue("latitude", address.latitude, { shouldDirty: true });
        form.setValue("longitude", address.longitude, { shouldDirty: true });
      }
    },
    [form],
  );

  return (
    <>
      <FormField
        control={form.control}
        name="venue_name"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>Nome do local</FormLabel>
            <FormControl>
              <Input {...field} placeholder="Centro de Convenções" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/*
        Ordem e proporção seguem o formulário de endereço brasileiro:
        CEP → logradouro → número. O número fica estreito no fim da
        linha porque quase sempre tem 3 ou 4 dígitos — dar a ele meia
        tela é desperdício e atrapalha a leitura do endereço.
      */}
      <div className="grid gap-4 md:col-span-2 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,7rem)]">
        <FormField
          control={form.control}
          name="zip_code"
          render={({ field }) => (
            <CepField
              value={field.value ?? ""}
              onChange={field.onChange}
              onResolved={applyAddress}
            />
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Logradouro</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Avenida Olavo Fontoura" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Número</FormLabel>
              <FormControl>
                <Input {...field} inputMode="numeric" placeholder="1209" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="complement"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Complemento</FormLabel>
            <FormControl>
              <Input {...field} placeholder="Pavilhão 3, sala 12" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="district"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Bairro</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="city"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Cidade</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="state"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Estado</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {BR_STATES.map((uf) => (
                  <SelectItem key={uf} value={uf}>
                    {uf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="latitude"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Latitude</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                type="number"
                step="any"
                placeholder="-23.5155"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="longitude"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Longitude</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                type="number"
                step="any"
                placeholder="-46.6333"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="allowed_radius_m"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Raio permitido (metros)</FormLabel>
            <FormControl>
              <Input {...field} type="number" min={20} max={50000} />
            </FormControl>
            <FormDescription>
              Check-in fora deste raio gera alerta e exige confirmação.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
