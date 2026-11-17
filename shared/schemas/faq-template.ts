import { z } from "zod";

import { faqSchema } from "./event-content";

/**
 * Pergunta frequente padrão da empresa. Mesmas regras de tamanho da FAQ do
 * evento — o padrão vira FAQ do evento por cópia, então não pode aceitar o que
 * a FAQ recusaria.
 */
export const faqTemplateSchema = faqSchema;

export const faqTemplateListSchema = z.object({
  items: z.array(faqTemplateSchema).max(60, "Máximo de 60 perguntas padrão."),
});

export type FaqTemplateInput = z.infer<typeof faqTemplateSchema>;
export type FaqTemplateListInput = z.infer<typeof faqTemplateListSchema>;
