import { z } from "zod";

import { faqSchema } from "./event-content";

/**
 * Pergunta frequente padrão da empresa. Mesmas regras de tamanho da FAQ do
 * evento — o padrão vira FAQ do evento por cópia, então não pode aceitar o que
 * a FAQ recusaria.
 */
export const faqTemplateSchema = faqSchema;

export const faqTemplateListSchema = z.object({
  items: z
    .array(faqTemplateSchema)
    .max(60, "Máximo de 60 perguntas padrão.")
    .superRefine((items, ctx) => {
      // A pergunta é o que identifica o padrão dentro do evento (a FAQ é cópia,
      // sem referência). Duas iguais confundem a escolha e duplicam a página.
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const key = item.question.trim().toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Esta pergunta já está na lista.",
            path: [index, "question"],
          });
        }
        seen.add(key);
      });
    }),
});

export type FaqTemplateInput = z.infer<typeof faqTemplateSchema>;
export type FaqTemplateListInput = z.infer<typeof faqTemplateListSchema>;
