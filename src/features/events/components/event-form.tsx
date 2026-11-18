"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Save, Send } from "lucide-react";

import { eventSchema, type EventInput } from "@shared/schemas/event";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROUTES } from "@/constants/routes";
import { createEvent, updateEvent } from "@/features/events/actions/event.actions";
import {
  EventCapacityField,
  EventDateFields,
  EventDescriptionFields,
  EventLocationFields,
  EventNameField,
  EventRegistrationFields,
  EventSlugField,
} from "@/features/events/components/event-fields";
import { eventFormDefaults } from "@/features/events/lib/event-defaults";
import type { Event } from "@/repositories";

interface EventFormProps {
  event?: Event;
}

export function EventForm({ event }: EventFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const isEdit = Boolean(event);

  const form = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: eventFormDefaults(event),
  });


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
                <EventNameField form={form} />
                <EventSlugField form={form} followName={!isEdit} />
                <EventDescriptionFields form={form} />
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
                <EventDateFields form={form} />

                <EventLocationFields form={form} />
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
                <EventCapacityField form={form} />
                <EventRegistrationFields form={form} />
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
