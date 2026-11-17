import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  META_TEMPLATE_DEFAULTS,
  buildMetaTemplate,
  resolveTemplateConfig,
} from "@/lib/meta/templates";
import { mapMetaStatus, shouldReplaceStatus, verifyMetaSignature } from "@/lib/meta/webhook";

const payload = {
  phone: "5511999998888",
  name: "Ana",
  event_name: "Congresso 2027",
  event_starts_at: "2027-03-10T22:00:00.000Z",
  venue: "Expominas",
  city: "Belo Horizonte",
  number: "2027-000123",
  token: "tok_abc",
  code: "482913",
};

describe("modelos da Meta", () => {
  it("usa os nomes padrão quando a empresa não configurou nada", () => {
    expect(resolveTemplateConfig({})).toEqual(META_TEMPLATE_DEFAULTS);
    expect(resolveTemplateConfig(null)).toEqual(META_TEMPLATE_DEFAULTS);
  });

  it("aceita nome personalizado e ignora valor inválido", () => {
    const config = resolveTemplateConfig({ confirmed: "meu_ingresso", cancelled: "Com Espaço" });
    expect(config.confirmed).toBe("meu_ingresso");
    expect(config.cancelled).toBe(META_TEMPLATE_DEFAULTS.cancelled);
  });

  it("confirmação: imagem no topo, cinco variáveis e o token no botão", () => {
    const message = buildMetaTemplate(
      "whatsapp.registration_confirmed",
      payload,
      META_TEMPLATE_DEFAULTS,
      { headerMediaId: "media-1" },
    );
    expect(message.name).toBe("ingresso_confirmado");
    expect(message.language).toEqual({ code: "pt_BR" });
    expect(message.components[0]).toEqual({
      type: "header",
      parameters: [{ type: "image", image: { id: "media-1" } }],
    });
    const body = message.components[1] as { parameters: { text: string }[] };
    expect(body.parameters.map((p) => p.text)).toEqual([
      "Ana",
      "Congresso 2027",
      expect.stringContaining("19:00"),
      "Expominas · Belo Horizonte",
      "2027-000123",
    ]);
    expect(message.components[2]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "tok_abc" }],
    });
  });

  it("confirmação sem imagem não pode sair", () => {
    expect(() =>
      buildMetaTemplate("whatsapp.registration_confirmed", payload, META_TEMPLATE_DEFAULTS, {}),
    ).toThrow(/imagem/);
  });

  it("variável vazia vira travessão — a Meta recusa parâmetro em branco", () => {
    const message = buildMetaTemplate(
      "whatsapp.registration_cancelled",
      { phone: "5511999998888", name: "", event_name: "Congresso 2027" },
      META_TEMPLATE_DEFAULTS,
      {},
    );
    const body = message.components[0] as { parameters: { text: string }[] };
    expect(body.parameters.map((p) => p.text)).toEqual(["—", "Congresso 2027", "—"]);
  });

  it("código da segunda via vai no corpo e no botão de copiar", () => {
    const message = buildMetaTemplate("whatsapp.ticket_code", payload, META_TEMPLATE_DEFAULTS, {});
    expect(message.name).toBe("codigo_segunda_via");
    expect(message.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "482913" }],
      },
    ]);
  });
});

describe("webhook da Meta", () => {
  const secret = "app-secret";
  const raw = JSON.stringify({ entry: [] });
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

  it("aceita a assinatura certa e recusa a errada ou ausente", () => {
    expect(verifyMetaSignature(raw, signature, secret)).toBe(true);
    expect(verifyMetaSignature(raw + " ", signature, secret)).toBe(false);
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=abc", secret)).toBe(false);
  });

  it("traduz a situação da Meta para a do log", () => {
    expect(mapMetaStatus("delivered")).toBe("entregue");
    expect(mapMetaStatus("read")).toBe("aberto");
    expect(mapMetaStatus("failed")).toBe("falhou");
    expect(mapMetaStatus("sent")).toBe("enviado");
    expect(mapMetaStatus("deleted")).toBeNull();
  });

  it("não deixa uma situação atrasada desfazer uma mais nova", () => {
    expect(shouldReplaceStatus("enviado", "entregue")).toBe(true);
    expect(shouldReplaceStatus("aberto", "entregue")).toBe(false);
    expect(shouldReplaceStatus("entregue", "falhou")).toBe(true);
  });
});
