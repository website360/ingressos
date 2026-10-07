import { describe, expect, it } from "vitest";

import { ticketCodeRequestSchema, ticketCodeVerifySchema } from "@shared/schemas/second-copy";

import { renderWhatsapp } from "@/lib/whatsapp/templates";

describe("pedido de segunda via", () => {
  it("aceita o CPF como a pessoa digita e entrega só os dígitos", () => {
    expect(ticketCodeRequestSchema.parse({ cpf: "529.982.247-25" })).toEqual({
      cpf: "52998224725",
    });
  });

  it("recusa CPF inválido antes de bater no banco", () => {
    expect(ticketCodeRequestSchema.safeParse({ cpf: "529.982.247-26" }).success).toBe(false);
  });
});

describe("conferência do código", () => {
  it("aceita os seis dígitos com a separação que a pessoa colou", () => {
    expect(ticketCodeVerifySchema.parse({ cpf: "52998224725", code: "123 456" })).toEqual({
      cpf: "52998224725",
      code: "123456",
    });
  });

  it("recusa código curto", () => {
    expect(ticketCodeVerifySchema.safeParse({ cpf: "52998224725", code: "12345" }).success).toBe(
      false,
    );
  });

  it("recusa letra no lugar de dígito", () => {
    // Tirar o que não é dígito deixa "12456": cinco dígitos, não seis.
    expect(ticketCodeVerifySchema.safeParse({ cpf: "52998224725", code: "12a456" }).success).toBe(
      false,
    );
  });

  it("recusa código longo", () => {
    expect(ticketCodeVerifySchema.safeParse({ cpf: "52998224725", code: "1234567" }).success).toBe(
      false,
    );
  });
});

describe("mensagem do código no WhatsApp", () => {
  const payload = { phone: "5511987654321", name: "Ana", code: "123456" };

  it("manda o código e nada que já valha como ingresso", () => {
    const content = renderWhatsapp("whatsapp.ticket_code", payload, "https://ingressos.test");

    expect(content.body).toContain("123456");
    // O código é só a chave para abrir a lista; o ingresso em si não viaja aqui.
    expect(content.attachTicketQr).toBe(false);
    expect(content.body).not.toContain("/ingresso/");
  });

  it("avisa o prazo, que é o que faz a pessoa não deixar para depois", () => {
    const content = renderWhatsapp("whatsapp.ticket_code", payload, "https://ingressos.test");

    expect(content.body).toContain("15 minutos");
  });
});
