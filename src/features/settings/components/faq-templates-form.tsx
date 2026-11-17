"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, MessageCircleQuestion, Plus, Save, Trash2 } from "lucide-react";

import { faqTemplateListSchema, type FaqTemplateListInput } from "@shared/schemas/faq-template";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/features/events/components/event-content-sections";
import { saveFaqTemplates } from "@/features/settings/actions/faq-template.actions";
import type { FaqTemplate } from "@/repositories";

interface Props {
  templates: FaqTemplate[];
  canEdit: boolean;
}

/**
 * Perguntas frequentes padrão. Entram já marcadas em todo evento novo; o
 * evento guarda uma cópia, então mudar a lista aqui não mexe em evento algum.
 */
export function FaqTemplatesForm({ templates, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FaqTemplateListInput>({
    resolver: zodResolver(faqTemplateListSchema),
    defaultValues: {
      items: templates.map(({ question, answer }) => ({ question, answer })),
    },
  });
  const items = useFieldArray({ control: form.control, name: "items" });

  function onSubmit(values: FaqTemplateListInput) {
    startTransition(async () => {
      const result = await saveFaqTemplates(values);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Perguntas padrão salvas.");
      form.reset(values);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircleQuestion className="size-4" /> Perguntas padrão
          </CardTitle>
          <CardDescription>
            Entram já marcadas em todo evento novo — dá para desmarcar ou ajustar a resposta na
            criação. Mudar esta lista não altera eventos já criados.
          </CardDescription>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => items.append({ question: "", answer: "" })}
          >
            <Plus /> Adicionar
          </Button>
        )}
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {items.fields.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhuma pergunta padrão. Os eventos novos começam sem perguntas frequentes.
              </p>
            ) : (
              items.fields.map((field, index) => (
                <fieldset
                  key={field.id}
                  disabled={!canEdit}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <FormField
                    control={form.control}
                    name={`items.${index}.question`}
                    render={({ field: question }) => (
                      <FormItem>
                        <FormLabel>Pergunta</FormLabel>
                        <FormControl>
                          <Input {...question} placeholder="Tem estacionamento no local?" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`items.${index}.answer`}
                    render={({ field: answer }) => (
                      <FormItem>
                        <FormLabel>Resposta</FormLabel>
                        <FormControl>
                          <Textarea {...answer} rows={3} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {canEdit && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        onClick={() => items.move(index, index - 1)}
                        aria-label="Subir"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === items.fields.length - 1}
                        onClick={() => items.move(index, index + 1)}
                        aria-label="Descer"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => items.remove(index)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 /> Remover
                      </Button>
                    </div>
                  )}
                </fieldset>
              ))
            )}

            {canEdit && (
              <div className="flex justify-end">
                <Button type="submit" loading={isPending} disabled={!form.formState.isDirty}>
                  <Save /> Salvar perguntas
                </Button>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
