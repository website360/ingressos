import { describe, expect, it } from "vitest";

import { toWhatsAppNumber } from "@shared/validation/phone";
import {
  buildWebhookBody,
  extractQrCode,
  instanceNameFor,
  maskSecret,
  normalizeState,
  parseEvolutionVersion,
  webhookDialectFor,
  WEBHOOK_EVENTS,
} from "@/lib/evolution/protocol";
import { renderWhatsapp } from "@/lib/whatsapp/templates";

describe("número do WhatsApp", () => {
  it("prefixa o DDI no telefone guardado pelo formulário", () => {
    expect(toWhatsAppNumber("11987654321")).toBe("5511987654321");
    expect(toWhatsAppNumber("(11) 98765-4321")).toBe("5511987654321");
    expect(toWhatsAppNumber("1133334444")).toBe("551133334444");
  });

  it("não duplica o DDI de quem já veio internacional", () => {
    expect(toWhatsAppNumber("5511987654321")).toBe("5511987654321");
    expect(toWhatsAppNumber("+55 (11) 98765-4321")).toBe("5511987654321");
  });

  it("preserva o DDD 55, que colide com o DDI", () => {
    // Fixo de Santa Maria/RS: 10 dígitos começando em 55 é DDD, não DDI.
    expect(toWhatsAppNumber("5533334444")).toBe("555533334444");
  });

  it("recusa telefone inválido em vez de mandar lixo para a Evolution", () => {
    expect(toWhatsAppNumber("123")).toBeNull();
    expect(toWhatsAppNumber("")).toBeNull();
    expect(toWhatsAppNumber("0011987654321")).toBeNull();
  });
});

describe("versão da Evolution", () => {
  it("lê os formatos que o servidor devolve", () => {
    expect(parseEvolutionVersion("2.2.3")).toMatchObject({ major: 2, minor: 2, patch: 3 });
    expect(parseEvolutionVersion("v2.1.1")).toMatchObject({ major: 2, minor: 1, patch: 1 });
    expect(parseEvolutionVersion("2.0")).toMatchObject({ major: 2, minor: 0, patch: 0 });
  });

  it("devolve null no que não é versão", () => {
    expect(parseEvolutionVersion("")).toBeNull();
    expect(parseEvolutionVersion(null)).toBeNull();
    expect(parseEvolutionVersion("desconhecida")).toBeNull();
  });
});

describe("dialeto do webhook", () => {
  it("usa o corpo achatado até a 2.1", () => {
    expect(webhookDialectFor(parseEvolutionVersion("2.0.9"))).toBe("achatado");
    expect(webhookDialectFor(parseEvolutionVersion("2.1.3"))).toBe("achatado");
    expect(webhookDialectFor(parseEvolutionVersion("1.8.0"))).toBe("achatado");
  });

  it("usa o corpo aninhado da 2.2 em diante", () => {
    expect(webhookDialectFor(parseEvolutionVersion("2.2.0"))).toBe("aninhado");
    expect(webhookDialectFor(parseEvolutionVersion("2.3.1"))).toBe("aninhado");
    expect(webhookDialectFor(parseEvolutionVersion("3.0.0"))).toBe("aninhado");
  });

  it("assume o dialeto novo quando não conseguiu detectar a versão", () => {
    expect(webhookDialectFor(null)).toBe("aninhado");
  });

  it("monta cada corpo na forma que a respectiva versão espera", () => {
    const url = "https://app.exemplo.com.br/api/webhooks/evolution";

    expect(buildWebhookBody("achatado", url)).toEqual({
      url,
      webhook_by_events: false,
      webhook_base64: false,
      events: ["QRCODE_UPDATED", "CONNECTION_UPDATE"],
    });

    expect(buildWebhookBody("aninhado", url)).toEqual({
      webhook: {
        enabled: true,
        url,
        byEvents: false,
        base64: false,
        events: ["QRCODE_UPDATED", "CONNECTION_UPDATE"],
      },
    });
  });

  it("manda o segredo em header no dialeto que suporta headers", () => {
    const url = "https://app.exemplo.com.br/api/webhooks/evolution";
    const body = buildWebhookBody("aninhado", url, WEBHOOK_EVENTS, "s3gr3d0") as {
      webhook: { headers?: Record<string, string>; url: string };
    };

    expect(body.webhook.headers).toEqual({ authorization: "Bearer s3gr3d0" });
    // A URL fica limpa: segredo em query acaba em log de proxy.
    expect(body.webhook.url).toBe(url);
  });

  it("não inventa header no dialeto achatado, que não tem o campo", () => {
    const url = "https://app.exemplo.com.br/api/webhooks/evolution?s=s3gr3d0";
    expect(buildWebhookBody("achatado", url, WEBHOOK_EVENTS, "s3gr3d0")).toEqual({
      url,
      webhook_by_events: false,
      webhook_base64: false,
      events: ["QRCODE_UPDATED", "CONNECTION_UPDATE"],
    });
  });
});

describe("estado da sessão", () => {
  it("traduz o vocabulário da Evolution", () => {
    expect(normalizeState("open")).toBe("conectado");
    expect(normalizeState("connecting")).toBe("conectando");
    expect(normalizeState("close")).toBe("desconectado");
  });

  it("trata o desconhecido como desconectado, não como conectado", () => {
    expect(normalizeState(undefined)).toBe("desconectado");
    expect(normalizeState("")).toBe("desconectado");
    expect(normalizeState("qualquer-coisa")).toBe("desconectado");
  });
});

describe("extração do QR Code", () => {
  const png = "iVBORw0KGgo=";

  it("aceita os formatos que a Evolution devolve conforme a versão", () => {
    expect(extractQrCode({ qrcode: { base64: png } })).toBe(`data:image/png;base64,${png}`);
    expect(extractQrCode({ base64: png })).toBe(`data:image/png;base64,${png}`);
    expect(extractQrCode({ qrcode: { code: png } })).toBe(`data:image/png;base64,${png}`);
    expect(extractQrCode({ code: png })).toBe(`data:image/png;base64,${png}`);
  });

  it("não prefixa o que já é data URL", () => {
    const dataUrl = `data:image/png;base64,${png}`;
    expect(extractQrCode({ qrcode: { base64: dataUrl } })).toBe(dataUrl);
  });

  it("devolve null quando não veio QR nenhum", () => {
    expect(extractQrCode({})).toBeNull();
    expect(extractQrCode(null)).toBeNull();
    expect(extractQrCode({ qrcode: {} })).toBeNull();
    expect(extractQrCode({ base64: "" })).toBeNull();
  });
});

describe("nome da instância", () => {
  it("deriva do slug, com alfabeto conservador", () => {
    expect(instanceNameFor("agencia-may")).toBe("ingressos-agencia-may");
    expect(instanceNameFor("Ministério Bruno Leonardo")).toBe(
      "ingressos-ministerio-bruno-leonardo",
    );
  });

  it("nunca devolve nome vazio", () => {
    expect(instanceNameFor("")).toBe("ingressos-empresa");
    expect(instanceNameFor("***")).toBe("ingressos-empresa");
  });
});

describe("máscara do segredo", () => {
  it("mostra só os quatro últimos", () => {
    expect(maskSecret("B6D711FCDE4D4FD5936544120E713976")).toBe("••••3976");
  });
});

describe("mensagens", () => {
  const appUrl = "https://app.exemplo.com.br";
  const payload = {
    phone: "11987654321",
    name: "Ana",
    event_name: "Bispo Bruno Leonardo na Fonte Nova",
    event_starts_at: "2026-11-07T21:00:00.000Z",
    venue: "Arena Fonte Nova",
    city: "Salvador",
    number: "INS-000123",
    ticket_code: "A1B2C3D4E5F6",
    token: "A1B2C3D4E5F6.assinatura",
  };

  it("confirma a inscrição com QR anexado e link no fim", () => {
    const content = renderWhatsapp("whatsapp.registration_confirmed", payload, appUrl);

    expect(content.attachTicketQr).toBe(true);
    expect(content.body).toContain("Ana");
    expect(content.body).toContain("*Bispo Bruno Leonardo na Fonte Nova*");
    expect(content.body).toContain("Arena Fonte Nova · Salvador");
    expect(content.body).toContain("INS-000123");
    // O link precisa fechar a mensagem para o WhatsApp montar a prévia.
    expect(content.body.trimEnd().endsWith(`${appUrl}/ingresso/${payload.token}`)).toBe(true);
  });

  it("cancela sem anexar ingresso", () => {
    const content = renderWhatsapp("whatsapp.registration_cancelled", payload, appUrl);

    expect(content.attachTicketQr).toBe(false);
    expect(content.body).toContain("cancelada");
    expect(content.body).not.toContain("/ingresso/");
  });

  it("recusa template desconhecido em vez de mandar mensagem vazia", () => {
    expect(() => renderWhatsapp("whatsapp.qualquer", payload, appUrl)).toThrow();
  });
});
