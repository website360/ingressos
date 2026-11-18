"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { eventContentSchema, type EventContentInput } from "@shared/schemas/event-content";

import { StickyActionBar } from "@/components/shared/sticky-action-bar";
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
          <CardTitle className="text-base">Foto do evento</CardTitle>
          <CardDescription>
            O envio é imediato — não depende do botão de salvar no fim da página.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ImageUpload
            eventId={event.id}
            kind="banner"
            label="Foto do evento"
            hint="Aparece no topo da página do evento, na prévia do link quando ele é compartilhado e no ingresso. Ideal: 1600×600 (horizontal)."
            currentUrl={event.banner_url}
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

          <StickyActionBar>
            <Button type="submit" loading={isPending}>
              <Save /> Salvar conteúdo
            </Button>
          </StickyActionBar>
        </form>
      </Form>
    </div>
  );
}
