import { describe, expect, it } from "vitest";

import { faqTemplateListSchema } from "@shared/schemas/faq-template";

import {
  buildEventFaqs,
  duplicatedChoices,
  initialFaqChoices,
  newTemplatesFrom,
  type FaqChoice,
} from "@/features/events/lib/faq-selection";

const templates = [
  { id: "t1", question: "Tem estacionamento?", answer: "Sim, gratuito." },
  { id: "t2", question: "Posso levar acompanhante?", answer: "Não." },
];

describe("perguntas padrão", () => {
  it("aceita uma pergunta com resposta", () => {
    expect(faqTemplateListSchema.safeParse({ items: [templates[0]] }).success).toBe(true);
  });

  it("recusa pergunta curta demais e resposta vazia", () => {
    expect(
      faqTemplateListSchema.safeParse({ items: [{ question: "Oi?", answer: "Sim." }] }).success,
    ).toBe(false);
    expect(
      faqTemplateListSchema.safeParse({ items: [{ question: "Tem estacionamento?", answer: "" }] })
        .success,
    ).toBe(false);
  });

  it("recusa a mesma pergunta duas vezes, sem diferenciar maiúsculas", () => {
    const result = faqTemplateListSchema.safeParse({
      items: [templates[0]!, { question: "tem estacionamento? ", answer: "Não." }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["items", 1, "question"]);
  });

  it("recusa mais de 60 perguntas", () => {
    const items = Array.from({ length: 61 }, (_, i) => ({
      question: `Pergunta número ${i}?`,
      answer: "Resposta.",
    }));
    expect(faqTemplateListSchema.safeParse({ items }).success).toBe(false);
  });
});

describe("escolha das perguntas do evento", () => {
  it("marca o padrão que já está no evento e desmarca o que não está", () => {
    const choices = initialFaqChoices(templates, [templates[0]!]);
    expect(choices.map((c) => [c.templateId, c.checked])).toEqual([
      ["t1", true],
      ["t2", false],
    ]);
  });

  it("mantém a resposta ajustada no evento, não a do padrão", () => {
    const choices = initialFaqChoices(templates, [
      { question: "Tem estacionamento?", answer: "Só para os primeiros 50." },
    ]);
    expect(choices[0]!.answer).toBe("Só para os primeiros 50.");
  });

  it("pergunta do evento sem padrão vira personalizada", () => {
    const choices = initialFaqChoices(templates, [{ question: "Tem almoço?", answer: "Sim." }]);
    expect(choices.at(-1)).toMatchObject({
      templateId: null,
      checked: true,
      question: "Tem almoço?",
    });
  });

  it("monta a lista com os padrões primeiro, na ordem, e só os marcados", () => {
    const choices: FaqChoice[] = [
      {
        templateId: null,
        question: "Tem almoço?",
        answer: "Sim.",
        checked: true,
        saveAsTemplate: false,
      },
      {
        templateId: "t1",
        question: "Tem estacionamento?",
        answer: "Sim.",
        checked: true,
        saveAsTemplate: false,
      },
      {
        templateId: "t2",
        question: "Posso levar acompanhante?",
        answer: "Não.",
        checked: false,
        saveAsTemplate: false,
      },
    ];
    expect(buildEventFaqs(choices)).toEqual([
      { question: "Tem estacionamento?", answer: "Sim." },
      { question: "Tem almoço?", answer: "Sim." },
    ]);
  });

  it("só personalizada marcada vira padrão novo", () => {
    const choices: FaqChoice[] = [
      {
        templateId: "t1",
        question: "Tem estacionamento?",
        answer: "Sim.",
        checked: true,
        saveAsTemplate: true,
      },
      {
        templateId: null,
        question: "Tem almoço?",
        answer: "Sim.",
        checked: true,
        saveAsTemplate: true,
      },
      {
        templateId: null,
        question: "Tem wi-fi no local?",
        answer: "Sim.",
        checked: false,
        saveAsTemplate: true,
      },
    ];
    expect(newTemplatesFrom(choices)).toEqual([{ question: "Tem almoço?", answer: "Sim." }]);
  });
});

describe("pergunta repetida no evento", () => {
  const base = { answer: "Sim.", saveAsTemplate: false };

  it("aponta a personalizada que repete um padrão marcado", () => {
    const choices: FaqChoice[] = [
      { ...base, templateId: "t1", question: "Tem estacionamento?", checked: true },
      { ...base, templateId: null, question: "tem estacionamento? ", checked: true },
    ];
    expect(duplicatedChoices(choices)).toEqual([1]);
  });

  it("ignora o padrão desmarcado", () => {
    const choices: FaqChoice[] = [
      { ...base, templateId: "t1", question: "Tem estacionamento?", checked: false },
      { ...base, templateId: null, question: "Tem estacionamento?", checked: true },
    ];
    expect(duplicatedChoices(choices)).toEqual([]);
  });
});
