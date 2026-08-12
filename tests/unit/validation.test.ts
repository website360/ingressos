import { describe, expect, it } from "vitest";

import { formatCpf, isValidCpf, maskCpf, onlyDigits } from "@shared/validation/cpf";
import { formatBrPhone, isValidBrPhone, isValidBrState } from "@shared/validation/phone";
import { splitFullName } from "@shared/validation/name";
import { cpfSchema, emailSchema, passwordSchema, slugSchema } from "@shared/schemas/common";
import { registrationSchema } from "@shared/schemas/registration";

describe("CPF", () => {
  it("aceita CPFs com dígitos verificadores corretos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("rejeita dígito verificador inválido", () => {
    expect(isValidCpf("529.982.247-26")).toBe(false);
  });

  it("rejeita sequências repetidas", () => {
    // Passam na conta do dígito verificador — precisam de rejeição explícita.
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("000.000.000-00")).toBe(false);
  });

  it("rejeita tamanho incorreto", () => {
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });

  it("formata e mascara", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(maskCpf("52998224725")).toBe("***.982.247-**");
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
  });
});

describe("Telefone", () => {
  it("aceita fixo e celular válidos", () => {
    expect(isValidBrPhone("(11) 3333-4444")).toBe(true);
    expect(isValidBrPhone("11999998888")).toBe(true);
  });

  it("rejeita DDD inválido e celular sem 9", () => {
    expect(isValidBrPhone("(01) 99999-8888")).toBe(false);
    expect(isValidBrPhone("11899998888")).toBe(false);
  });

  it("formata", () => {
    expect(formatBrPhone("11999998888")).toBe("(11) 99999-8888");
    expect(formatBrPhone("1133334444")).toBe("(11) 3333-4444");
  });

  it("valida UF", () => {
    expect(isValidBrState("SP")).toBe(true);
    expect(isValidBrState("XX")).toBe(false);
  });
});

describe("Nome completo", () => {
  it("separa a primeira palavra do restante", () => {
    expect(splitFullName("Ana Maria da Silva")).toEqual({
      first_name: "Ana",
      last_name: "Maria da Silva",
    });
    expect(splitFullName("  João   Souza  ")).toEqual({ first_name: "João", last_name: "Souza" });
  });

  it("exige nome e sobrenome na inscrição", () => {
    const base = {
      cpf: "529.982.247-25",
      phone: "11999998888",
      email: "ana@exemplo.com",
      city: "São Paulo",
      state: "SP",
      accept_lgpd: true,
      accept_rules: true,
    };

    expect(registrationSchema.parse({ ...base, full_name: " Ana   Silva " }).full_name).toBe(
      "Ana Silva",
    );
    expect(() => registrationSchema.parse({ ...base, full_name: "Ana" })).toThrow();
  });
});

describe("Schemas compartilhados", () => {
  it("cpfSchema normaliza para dígitos", () => {
    expect(cpfSchema.parse("529.982.247-25")).toBe("52998224725");
    expect(() => cpfSchema.parse("111.111.111-11")).toThrow();
  });

  it("emailSchema normaliza caixa e espaços", () => {
    expect(emailSchema.parse("  Contato@Empresa.COM.BR ")).toBe("contato@empresa.com.br");
  });

  it("passwordSchema exige complexidade mínima", () => {
    expect(() => passwordSchema.parse("senha123")).toThrow();
    expect(passwordSchema.parse("Senha1234")).toBe("Senha1234");
  });

  it("slugSchema rejeita formatos inválidos", () => {
    expect(slugSchema.parse("Congresso-Tech-2026")).toBe("congresso-tech-2026");
    expect(() => slugSchema.parse("congresso tech")).toThrow();
    expect(() => slugSchema.parse("-congresso")).toThrow();
  });
});
