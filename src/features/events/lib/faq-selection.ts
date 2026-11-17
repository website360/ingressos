import type { FaqInput } from "@shared/schemas/event-content";
import type { FaqTemplateInput } from "@shared/schemas/faq-template";

/**
 * Uma linha da etapa de perguntas do assistente: um padrão da empresa (que
 * pode ser desmarcado e ter a resposta ajustada só para o evento) ou uma
 * pergunta personalizada, só deste evento.
 */
export type FaqChoice = {
  /** `null` para pergunta personalizada. */
  templateId: string | null;
  question: string;
  answer: string;
  checked: boolean;
  /** Só tem efeito em pergunta personalizada: grava também como padrão. */
  saveAsTemplate: boolean;
};

const key = (question: string) => question.trim().toLowerCase();

/**
 * Estado inicial da etapa a partir do que já está gravado no evento.
 *
 * O padrão é reconhecido pela pergunta — a FAQ do evento é uma cópia e não
 * guarda referência ao template. Marcado = está no evento; a resposta vem do
 * evento, porque ela pode ter sido ajustada.
 */
export function initialFaqChoices(
  templates: { id: string; question: string; answer: string }[],
  eventFaqs: { question: string; answer: string }[],
): FaqChoice[] {
  const inEvent = new Map(eventFaqs.map((faq) => [key(faq.question), faq]));
  const templateKeys = new Set(templates.map((t) => key(t.question)));

  const fromTemplates = templates.map((template) => {
    const current = inEvent.get(key(template.question));
    return {
      templateId: template.id,
      question: template.question,
      answer: current?.answer ?? template.answer,
      checked: Boolean(current),
      saveAsTemplate: false,
    };
  });

  const custom = eventFaqs
    .filter((faq) => !templateKeys.has(key(faq.question)))
    .map((faq) => ({
      templateId: null,
      question: faq.question,
      answer: faq.answer,
      checked: true,
      saveAsTemplate: false,
    }));

  return [...fromTemplates, ...custom];
}

/** O que vai para `event_faqs`: padrões marcados na ordem, depois as personalizadas. */
export function buildEventFaqs(choices: FaqChoice[]): FaqInput[] {
  const selected = choices.filter((choice) => choice.checked);
  return [
    ...selected.filter((choice) => choice.templateId !== null),
    ...selected.filter((choice) => choice.templateId === null),
  ].map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() }));
}

/** Personalizadas marcadas com "salvar também como padrão". */
export function newTemplatesFrom(choices: FaqChoice[]): FaqTemplateInput[] {
  return choices
    .filter((choice) => choice.templateId === null && choice.checked && choice.saveAsTemplate)
    .map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() }));
}

/**
 * Índices das perguntas marcadas que repetem outra marcada antes delas (sem
 * diferenciar maiúsculas). Uma personalizada igual a um padrão sairia duas
 * vezes na página do evento.
 */
export function duplicatedChoices(choices: FaqChoice[]): number[] {
  const seen = new Set<string>();
  const duplicated: number[] = [];

  // Padrões primeiro, na mesma ordem de `buildEventFaqs`: quem repete é a
  // personalizada, e é nela que o aviso deve aparecer.
  const ordered = choices
    .map((choice, index) => ({ choice, index }))
    .filter(({ choice }) => choice.checked)
    .sort((a, b) => Number(a.choice.templateId === null) - Number(b.choice.templateId === null));

  for (const { choice, index } of ordered) {
    const k = key(choice.question);
    if (!k) continue;
    if (seen.has(k)) duplicated.push(index);
    seen.add(k);
  }
  return duplicated.sort((a, b) => a - b);
}
