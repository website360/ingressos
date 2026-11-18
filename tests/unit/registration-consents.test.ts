import { describe, expect, it } from "vitest";

import { registrationSchema } from "@shared/schemas/registration";
import { WHATSAPP_CONSENT_TEXT, WHATSAPP_CONSENT_VERSION } from "@shared/whatsapp/consent";

import { registrationConsents } from "@/features/registrations/lib/consents";

const base = {
  full_name: "Maria Teste",
  cpf: "39053344705",
  phone: "(11) 98765-4321",
  email: "maria@example.com",
  city: "São Paulo",
  state: "SP",
  accept_lgpd: true,
  accept_rules: true,
};

describe("consentimento do WhatsApp", () => {
  it("texto e versão do aceite", () => {
    expect(WHATSAPP_CONSENT_VERSION).toBe(1);
    expect(WHATSAPP_CONSENT_TEXT).toBe(
      "Quero receber a confirmação e o ingresso pelo WhatsApp neste número.",
    );
  });

  it("o campo é opcional: sem ele, a inscrição continua válida", () => {
    expect(registrationSchema.safeParse(base).success).toBe(true);
    expect(registrationSchema.safeParse({ ...base, accept_whatsapp: false }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...base, accept_whatsapp: true }).success).toBe(true);
  });

  it("marcado: grava o aceite com a versão e o telefone", () => {
    const data = registrationSchema.parse({ ...base, accept_whatsapp: true });
    expect(registrationConsents(data)).toEqual([
      { type: "lgpd", version: 1, accepted: true },
      { type: "regulamento", version: 1, accepted: true },
      { type: "whatsapp", version: 1, accepted: true, subject: "11987654321" },
    ]);
  });

  it("desmarcado: grava a recusa (a escolha também é registro)", () => {
    const data = registrationSchema.parse({ ...base, accept_whatsapp: false });
    expect(registrationConsents(data)).toContainEqual({
      type: "whatsapp",
      version: 1,
      accepted: false,
      subject: "11987654321",
    });
  });

  it("não oferecido (WhatsApp desligado): nenhum registro de WhatsApp", () => {
    const data = registrationSchema.parse(base);
    expect(registrationConsents(data).map((c) => c.type)).toEqual(["lgpd", "regulamento"]);
  });
});
