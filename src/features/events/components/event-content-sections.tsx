"use client";

import * as React from "react";

import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import type { EventContentInput } from "@shared/schemas/event-content";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/**
 * Seções do conteúdo da landing, compartilhadas entre a tela de edição (todas
 * de uma vez) e o assistente de criação (uma por etapa).
 */
interface SectionProps {
  form: UseFormReturn<EventContentInput>;
}

export /** Textarea com o mesmo visual do Input do Design System. */
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

export function ScheduleSection({ form }: SectionProps) {
  const schedule = useFieldArray({ control: form.control, name: "schedule" });
  return (
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
  );
}

export function SpeakersSection({ form }: SectionProps) {
  const speakers = useFieldArray({ control: form.control, name: "speakers" });
  return (
    <Section
      title="Palestrantes"
      description="Quem apresenta. Aparece em cards na página do evento."
      onAdd={() => speakers.append({ name: "", role: "", company: "", bio: "", photo_url: "" })}
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
  );
}

export function FaqSection({ form }: SectionProps) {
  const faqs = useFieldArray({ control: form.control, name: "faqs" });
  return (
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
  );
}

export function DocumentsSection({ form }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Regulamento e políticas</CardTitle>
        <CardDescription>
          Cada alteração publica uma versão nova. O aceite do participante aponta para a versão que
          ele leu — reescrever por cima apagaria a prova do consentimento.
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
  );
}

// -----------------------------------------------------------------------------
export function Section({
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

export function Row({
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
export function FormFieldInput({
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
