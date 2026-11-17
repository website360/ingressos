"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { eventContentSchema, type EventContentInput } from "@shared/schemas/event-content";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { saveEventContent } from "@/features/events/actions/content.actions";
import {
  DocumentsSection,
  FaqSection,
  ScheduleSection,
  SpeakersSection,
} from "@/features/events/components/event-content-sections";
import { ImageUpload } from "@/features/events/components/image-upload";
import { contentFormDefaults, type EventContentRows } from "@/features/events/lib/event-defaults";
import type { Tables } from "@/lib/supabase/database.types";

interface Props {
  event: Tables<"events">;
  content: EventContentRows;
}

export function EventContentForm({ event, content }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<EventContentInput>({
    resolver: zodResolver(eventContentSchema),
    defaultValues: contentFormDefaults(content),
  });

  function onSubmit(values: EventContentInput) {
    startTransition(async () => {
      const result = await saveEventContent(event.id, values);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Conteúdo publicado na página do evento.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Imagens</CardTitle>
          <CardDescription>
            O envio é imediato — não depende do botão de salvar no fim da página.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ImageUpload
            eventId={event.id}
            kind="banner"
            label="Banner"
            hint="Topo da página do evento e compartilhamento em redes. Ideal: 1600×600."
            currentUrl={event.banner_url}
          />
          <ImageUpload
            eventId={event.id}
            kind="cover"
            label="Capa"
            hint="Card do evento na página inicial. Ideal: 800×450."
            currentUrl={event.cover_url}
          />
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {/* ---------------------------------------------------------------- */}
          <ScheduleSection form={form} />
          <SpeakersSection form={form} />
          <FaqSection form={form} />
          <DocumentsSection form={form} />

          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={isPending}>
              <Save /> Salvar conteúdo
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
