"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Save, Send } from "lucide-react";

import { eventSchema, type EventInput } from "@shared/schemas/event";
import { BR_STATES } from "@shared/validation/phone";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROUTES } from "@/constants/routes";
import type { AddressLookup } from "@/features/events/actions/address.actions";
import { createEvent, updateEvent } from "@/features/events/actions/event.actions";
import { CepField } from "@/features/events/components/cep-field";
import { slugify } from "@/lib/utils";
import type { Event } from "@/repositories";

/** `datetime-local` exige o formato YYYY-MM-DDTHH:mm, sem fuso nem segundos. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

interface EventFormProps {
  event?: Event;
}

export function EventForm({ event }: EventFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const isEdit = Boolean(event);

  const form = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      name: event?.name ?? "",
      slug: event?.slug ?? "",
      short_description: event?.short_description ?? "",
      description: event?.description ?? "",
      starts_at: toLocalInput(event?.starts_at),
      ends_at: toLocalInput(event?.ends_at),
      venue_name: event?.venue_name ?? "",
      address: event?.address ?? "",
      address_number: event?.address_number ?? "",
      complement: event?.complement ?? "",
      district: event?.district ?? "",
      city: event?.city ?? "",
      state: (event?.state as EventInput["state"]) ?? "",
      zip_code: event?.zip_code ?? "",
      latitude: null,
      longitude: null,
      allowed_radius_m: event?.allowed_radius_m ?? 300,
      capacity: event?.capacity ?? 100,
      overbooking_pct: event?.overbooking_pct ?? 0,
      registration_deadline: toLocalInput(event?.registration_deadline),
      status: event?.status ?? "rascunho",
    },
  });

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

  // Slug acompanha o nome enquanto for um evento novo e o campo não foi tocado.
  const name = form.watch("name");
  React.useEffect(() => {
    if (!isEdit && !form.formState.dirtyFields.slug && name) {
      form.setValue("slug", slugify(name));
    }
  }, [name, isEdit, form]);

  function submit(values: EventInput, status?: EventInput["status"]) {
    const payload = status ? { ...values, status } : values;

    startTransition(async () => {
      const result = isEdit ? await updateEvent(event!.id, payload) : await createEvent(payload);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(isEdit ? "Evento atualizado." : "Evento criado.");
      router.push(ROUTES.admin.event(result.data.id));
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => submit(values))}
        className="space-y-6"
        noValidate
      >
        <Tabs defaultValue="basico">
          <TabsList>
            <TabsTrigger value="basico">Básico</TabsTrigger>
            <TabsTrigger value="local">Data e local</TabsTrigger>
            <TabsTrigger value="vagas">Vagas</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------------- */}
          <TabsContent value="basico">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Informações principais</CardTitle>
                <CardDescription>Aparecem na listagem e na página pública.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
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

                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Endereço na web</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="congresso-tecnologia-2026" />
                      </FormControl>
                      <FormDescription>Usado no link público do evento.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="short_description"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Descrição curta</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={280}
                          placeholder="Uma frase que resume o evento."
                        />
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------------- */}
          <TabsContent value="local">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Data e local</CardTitle>
                <CardDescription>
                  As coordenadas definem o raio permitido para o check-in presencial.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------------- */}
          <TabsContent value="vagas">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vagas e inscrições</CardTitle>
                <CardDescription>
                  O limite é garantido pelo banco de dados — inscrição acima da capacidade é
                  recusada mesmo com centenas de pedidos simultâneos.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
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

                <FormField
                  control={form.control}
                  name="overbooking_pct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Overbooking (%)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={0} max={50} step="0.5" />
                      </FormControl>
                      <FormDescription>
                        Margem extra sobre a capacidade. 0 desativa.
                      </FormDescription>
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            variant="outline"
            loading={isPending}
            onClick={form.handleSubmit((values) => submit(values, "rascunho"))}
          >
            <Save /> Salvar rascunho
          </Button>
          <Button
            type="button"
            loading={isPending}
            onClick={form.handleSubmit((values) => submit(values, "publicado"))}
          >
            <Send /> Publicar evento
          </Button>
        </div>
      </form>
    </Form>
  );
}
