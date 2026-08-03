"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";

import { eventContentSchema, type EventContentInput } from "@shared/schemas/event-content";

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
import { saveEventContent } from "@/features/events/actions/content.actions";
import { ImageUpload } from "@/features/events/components/image-upload";
import type { Tables } from "@/lib/supabase/database.types";

/** Textarea com o mesmo visual do Input do Design System. */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={`flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${className ?? ""}`}
    {...props}
  />
));
Textarea.displayName = "Textarea";

interface Props {
  event: Tables<"events">;
  content: {
    schedule: Tables<"event_schedule_items">[];
    speakers: Tables<"event_speakers">[];
    faqs: Tables<"event_faqs">[];
    documents: Tables<"event_documents">[];
  };
}

/** Última versão publicada de cada documento. */
function latestDocument(documents: Tables<"event_documents">[], type: string): string {
  return (
    documents.filter((doc) => doc.document_type === type).sort((a, b) => b.version - a.version)[0]
      ?.content ?? ""
  );
}

export function EventContentForm({ event, content }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<EventContentInput>({
    resolver: zodResolver(eventContentSchema),
    defaultValues: {
      schedule: content.schedule.map((item) => ({
        starts_at: item.starts_at?.slice(0, 5) ?? "",
        ends_at: item.ends_at?.slice(0, 5) ?? "",
        title: item.title,
        speaker: item.speaker ?? "",
        description: item.description ?? "",
      })),
      speakers: content.speakers.map((item) => ({
        name: item.name,
        role: item.role ?? "",
        company: item.company ?? "",
        bio: item.bio ?? "",
        photo_url: item.photo_url ?? "",
      })),
      faqs: content.faqs.map((item) => ({ question: item.question, answer: item.answer })),
      regulamento: latestDocument(content.documents, "regulamento"),
      cancelamento: latestDocument(content.documents, "cancelamento"),
      lgpd: latestDocument(content.documents, "lgpd"),
    },
  });

  const schedule = useFieldArray({ control: form.control, name: "schedule" });
  const speakers = useFieldArray({ control: form.control, name: "speakers" });
  const faqs = useFieldArray({ control: form.control, name: "faqs" });

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
          <Section
            title="Programação"
            description="A linha do tempo exibida na página do evento, na ordem em que aparece aqui."
            onAdd={() =>
              schedule.append({
                starts_at: "",
                ends_at: "",
                title: "",
                speaker: "",
                description: "",
              })
            }
            addLabel="Adicionar item"
            isEmpty={schedule.fields.length === 0}
            emptyMessage="Nenhum item na programação. A seção não aparece na página pública."
          >
            {schedule.fields.map((field, index) => (
              <Row key={field.id} index={index} onRemove={() => schedule.remove(index)}>
                <div className="grid gap-3 sm:grid-cols-[6rem_6rem_1fr]">
                  <FormFieldInput
                    form={form}
                    name={`schedule.${index}.starts_at`}
                    label="Início"
                    placeholder="09:00"
                  />
                  <FormFieldInput
                    form={form}
                    name={`schedule.${index}.ends_at`}
                    label="Fim"
                    placeholder="10:00"
                  />
                  <FormFieldInput
                    form={form}
                    name={`schedule.${index}.title`}
                    label="Título"
                    placeholder="Abertura"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormFieldInput
                    form={form}
                    name={`schedule.${index}.speaker`}
                    label="Responsável"
                    placeholder="Opcional"
                  />
                  <FormFieldInput
                    form={form}
                    name={`schedule.${index}.description`}
                    label="Descrição"
                    placeholder="Opcional"
                  />
                </div>
              </Row>
            ))}
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            title="Palestrantes"
            description="Quem apresenta. Aparece em cards na página do evento."
            onAdd={() =>
              speakers.append({ name: "", role: "", company: "", bio: "", photo_url: "" })
            }
            addLabel="Adicionar palestrante"
            isEmpty={speakers.fields.length === 0}
            emptyMessage="Nenhum palestrante cadastrado."
          >
            {speakers.fields.map((field, index) => (
              <Row key={field.id} index={index} onRemove={() => speakers.remove(index)}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormFieldInput form={form} name={`speakers.${index}.name`} label="Nome" />
                  <FormFieldInput
                    form={form}
                    name={`speakers.${index}.role`}
                    label="Cargo"
                    placeholder="Opcional"
                  />
                  <FormFieldInput
                    form={form}
                    name={`speakers.${index}.company`}
                    label="Empresa"
                    placeholder="Opcional"
                  />
                </div>

                <FormField
                  control={form.control}
                  name={`speakers.${index}.bio`}
                  render={({ field: bio }) => (
                    <FormItem>
                      <FormLabel>Mini biografia</FormLabel>
                      <FormControl>
                        <Textarea {...bio} rows={3} placeholder="Opcional" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormFieldInput
                  form={form}
                  name={`speakers.${index}.photo_url`}
                  label="URL da foto"
                  placeholder="https://..."
                />
              </Row>
            ))}
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            title="Perguntas frequentes"
            description="Reduz mensagens repetidas antes do evento."
            onAdd={() => faqs.append({ question: "", answer: "" })}
            addLabel="Adicionar pergunta"
            isEmpty={faqs.fields.length === 0}
            emptyMessage="Nenhuma pergunta cadastrada."
          >
            {faqs.fields.map((field, index) => (
              <Row key={field.id} index={index} onRemove={() => faqs.remove(index)}>
                <FormFieldInput form={form} name={`faqs.${index}.question`} label="Pergunta" />
                <FormField
                  control={form.control}
                  name={`faqs.${index}.answer`}
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
              </Row>
            ))}
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regulamento e políticas</CardTitle>
              <CardDescription>
                Cada alteração publica uma versão nova. O aceite do participante aponta para a
                versão que ele leu — reescrever por cima apagaria a prova do consentimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(
                [
                  ["regulamento", "Regulamento", "Regras de participação, entrada e conduta."],
                  [
                    "cancelamento",
                    "Política de cancelamento",
                    "Até quando e como o participante pode cancelar.",
                  ],
                  [
                    "lgpd",
                    "Tratamento de dados (LGPD)",
                    "Como os dados são usados. Exibido no aceite da inscrição.",
                  ],
                ] as const
              ).map(([name, label, hint]) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={5} />
                      </FormControl>
                      <FormDescription>{hint}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </CardContent>
          </Card>

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

// -----------------------------------------------------------------------------
function Section({
  title,
  description,
  onAdd,
  addLabel,
  isEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  description: string;
  onAdd: () => void;
  addLabel: string;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus /> {addLabel}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEmpty ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  index,
  onRemove,
  children,
}: {
  index: number;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative space-y-3 rounded-lg border p-4 pl-9">
      <span className="absolute left-2 top-4 flex flex-col items-center gap-1 text-muted-foreground">
        <GripVertical className="size-4" />
        <span className="tabular text-[0.65rem]">{index + 1}</span>
      </span>

      {children}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 /> Remover
      </Button>
    </div>
  );
}

/** Evita repetir o mesmo bloco de FormField/Input dezenas de vezes. */
function FormFieldInput({
  form,
  name,
  label,
  placeholder,
}: {
  form: UseFormReturn<EventContentInput>;
  // Caminhos de array (`schedule.0.title`) não são inferíveis estaticamente.
  name: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name as never}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} value={(field.value as string) ?? ""} placeholder={placeholder} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
