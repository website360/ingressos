"use client";

import * as React from "react";

import Link from "next/link";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/constants/routes";
import { Textarea } from "@/features/events/components/event-content-sections";
import type { FaqChoice } from "@/features/events/lib/faq-selection";
import { cn } from "@/lib/utils";

interface Props {
  choices: FaqChoice[];
  onChange: (choices: FaqChoice[]) => void;
  /** Mensagem de validação por índice de `choices`. */
  errors: Record<number, string>;
  /** Só quem administra as configurações grava pergunta como padrão. */
  canSaveTemplate: boolean;
}

/**
 * Etapa de perguntas frequentes: os padrões da empresa (marcados de saída) e as
 * perguntas só deste evento.
 */
export function FaqStep({ choices, onChange, errors, canSaveTemplate }: Props) {
  const [openAnswer, setOpenAnswer] = React.useState<number | null>(null);

  const update = (index: number, patch: Partial<FaqChoice>) =>
    onChange(choices.map((choice, i) => (i === index ? { ...choice, ...patch } : choice)));

  const indexed = choices.map((choice, index) => ({ choice, index }));
  const templates = indexed.filter(({ choice }) => choice.templateId !== null);
  const custom = indexed.filter(({ choice }) => choice.templateId === null);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Perguntas padrão</h3>
          <p className="text-sm text-muted-foreground">
            Desmarque as que não valem para este evento. A resposta pode ser ajustada só aqui.
          </p>
        </div>

        {templates.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            A empresa ainda não tem perguntas padrão.{" "}
            <Link
              href={ROUTES.admin.settings.faqTemplates}
              className="font-medium text-foreground underline"
              target="_blank"
            >
              Cadastrar em Configurações
            </Link>
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {templates.map(({ choice, index }) => (
              <li key={choice.templateId} className="space-y-2 p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`faq-${index}`}
                    checked={choice.checked}
                    onCheckedChange={(checked) => update(index, { checked: checked === true })}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor={`faq-${index}`}
                    className={cn(
                      "flex-1 cursor-pointer font-medium leading-snug",
                      !choice.checked && "text-muted-foreground line-through",
                    )}
                  >
                    {choice.question}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-my-1 shrink-0"
                    disabled={!choice.checked}
                    onClick={() => setOpenAnswer(openAnswer === index ? null : index)}
                    aria-expanded={openAnswer === index}
                  >
                    Resposta
                    <ChevronDown
                      className={cn("transition-transform", openAnswer === index && "rotate-180")}
                    />
                  </Button>
                </div>

                {choice.checked && openAnswer === index && (
                  <Textarea
                    value={choice.answer}
                    onChange={(e) => update(index, { answer: e.target.value })}
                    rows={3}
                    aria-label={`Resposta de "${choice.question}"`}
                  />
                )}
                {choice.checked && openAnswer !== index && (
                  <p className="line-clamp-2 pl-7 text-sm text-muted-foreground">{choice.answer}</p>
                )}
                {errors[index] && (
                  <p className="pl-7 text-sm font-medium text-destructive">{errors[index]}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Perguntas deste evento</h3>
            <p className="text-sm text-muted-foreground">
              Valem só para este evento, a menos que você salve como padrão.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() =>
              onChange([
                ...choices,
                {
                  templateId: null,
                  question: "",
                  answer: "",
                  checked: true,
                  saveAsTemplate: false,
                },
              ])
            }
          >
            <Plus /> Adicionar pergunta
          </Button>
        </div>

        {custom.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma pergunta personalizada.
          </p>
        ) : (
          custom.map(({ choice, index }) => (
            <div key={index} className="space-y-3 rounded-lg border p-4">
              <div className="space-y-2">
                <Label htmlFor={`faq-q-${index}`}>Pergunta</Label>
                <Input
                  id={`faq-q-${index}`}
                  value={choice.question}
                  onChange={(e) => update(index, { question: e.target.value })}
                  placeholder="Haverá intérprete de Libras?"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`faq-a-${index}`}>Resposta</Label>
                <Textarea
                  id={`faq-a-${index}`}
                  value={choice.answer}
                  onChange={(e) => update(index, { answer: e.target.value })}
                  rows={3}
                />
              </div>
              {errors[index] && (
                <p className="text-sm font-medium text-destructive">{errors[index]}</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {canSaveTemplate ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`faq-t-${index}`}
                      checked={choice.saveAsTemplate}
                      onCheckedChange={(checked) =>
                        update(index, { saveAsTemplate: checked === true })
                      }
                    />
                    <Label htmlFor={`faq-t-${index}`} className="cursor-pointer font-normal">
                      Salvar também como padrão
                    </Label>
                  </div>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(choices.filter((_, i) => i !== index))}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 /> Remover
                </Button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
