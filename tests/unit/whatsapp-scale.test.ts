import { describe, expect, it } from "vitest";

import { nextRetryAt } from "@shared/whatsapp/backoff";
import { Breaker } from "@shared/whatsapp/breaker";
import { estimateDrainSeconds } from "@shared/whatsapp/drain-estimate";
import { classifyMetaFailure } from "@shared/whatsapp/errors";
import { maskPhone } from "@shared/whatsapp/mask";
import { buildTemplateMessage, templateValues } from "@shared/whatsapp/template-message";
import { metaGraphBase } from "@shared/whatsapp/meta-api";

describe("classifyMetaFailure", () => {
  it("falha antes de a requisição sair é retry seguro", () => {
    expect(classifyMetaFailure({ phase: "before_send" })).toBe("retry_safe");
  });

  it("timeout depois de enviada é incerta", () => {
    expect(classifyMetaFailure({ phase: "after_send", timeout: true })).toBe("uncertain");
  });

  it("conexão perdida depois de enviada, sem status, é incerta", () => {
    expect(classifyMetaFailure({ phase: "after_send" })).toBe("uncertain");
  });

  it.each([
    [429, undefined],
    [400, 130429],
    [400, 131056],
    [400, 80007],
    [400, 4],
  ])("HTTP %s / código %s é freio (throttle)", (status, code) => {
    expect(classifyMetaFailure({ phase: "after_send", status, code })).toBe("throttle");
  });

  it.each([131026, 131049, 131050, 131021])("código %s é definitivo de destinatário", (code) => {
    expect(classifyMetaFailure({ phase: "after_send", status: 400, code })).toBe(
      "permanent_recipient",
    );
  });

  it.each([131008, 132000, 132005, 132007, 132012, 131051, 100])(
    "código %s é definitivo da mensagem",
    (code) => {
      expect(classifyMetaFailure({ phase: "after_send", status: 400, code })).toBe(
        "permanent_message",
      );
    },
  );

  it.each([190, 10, 200, 132001, 132015, 132016, 368, 131031, 131042, 133010])(
    "código %s é sistêmico (abre o breaker)",
    (code) => {
      expect(classifyMetaFailure({ phase: "after_send", status: 400, code })).toBe("systemic");
    },
  );

  it("5xx com resposta é retry", () => {
    expect(classifyMetaFailure({ phase: "after_send", status: 503 })).toBe("retry_safe");
    expect(classifyMetaFailure({ phase: "after_send", status: 500, code: 131000 })).toBe(
      "retry_safe",
    );
  });

  it("4xx desconhecido é definitivo da mensagem", () => {
    expect(classifyMetaFailure({ phase: "after_send", status: 400, code: 99999 })).toBe(
      "permanent_message",
    );
  });
});

describe("nextRetryAt", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  const seconds = (d: Date) => (d.getTime() - now.getTime()) / 1000;

  it("dobra a partir de 30 s, com jitter neutro no meio", () => {
    expect(seconds(nextRetryAt(1, now, () => 0.5))).toBe(60);
    expect(seconds(nextRetryAt(2, now, () => 0.5))).toBe(120);
    expect(seconds(nextRetryAt(3, now, () => 0.5))).toBe(240);
  });

  it("jitter vai de 0,5× a 1,5×", () => {
    expect(seconds(nextRetryAt(1, now, () => 0))).toBe(30);
    expect(seconds(nextRetryAt(1, now, () => 1))).toBe(90);
  });

  it("o atraso base para em 15 min", () => {
    expect(seconds(nextRetryAt(10, now, () => 0.5))).toBe(900);
  });
});

describe("Breaker", () => {
  it("não abre com menos de 50 envios, mesmo com erro alto", () => {
    const b = new Breaker();
    for (let i = 0; i < 49; i++) b.record(i < 25 ? "error" : "ok", 1000);
    expect(b.shouldOpen(1000)).toBe(false);
  });

  it("abre com 50 envios e mais de 20% de erro", () => {
    const b = new Breaker();
    for (let i = 0; i < 50; i++) b.record(i < 11 ? "error" : "ok", 1000);
    expect(b.shouldOpen(1000)).toBe(true);
  });

  it("20% exatos não abrem", () => {
    const b = new Breaker();
    for (let i = 0; i < 50; i++) b.record(i < 10 ? "error" : "ok", 1000);
    expect(b.shouldOpen(1000)).toBe(false);
  });

  it("erro de destinatário não conta como erro", () => {
    const b = new Breaker();
    for (let i = 0; i < 60; i++) b.record(i < 30 ? "recipient_error" : "ok", 1000);
    expect(b.shouldOpen(1000)).toBe(false);
  });

  it("a janela é de 60 s", () => {
    const b = new Breaker();
    for (let i = 0; i < 50; i++) b.record("error", 0);
    expect(b.shouldOpen(30_000)).toBe(true);
    expect(b.shouldOpen(61_000)).toBe(false);
  });
});

describe("estimateDrainSeconds", () => {
  it("fila vazia: zero", () => {
    expect(estimateDrainSeconds(0, 10, 1000, 1000)).toBe(0);
  });

  it("sem vazão observada: sem estimativa", () => {
    expect(estimateDrainSeconds(100, 0, 1000, 1000)).toBeNull();
  });

  it("cabe no teto de hoje: fila ÷ vazão", () => {
    expect(estimateDrainSeconds(1000, 20, 5000, 10000)).toBe(50);
  });

  it("estoura o teto: espera a janela de 24 h para o resto", () => {
    // 100 cabem hoje; 150 ficam para a próxima janela (teto 1000).
    expect(estimateDrainSeconds(250, 10, 100, 1000)).toBe(86_400 + 15);
  });

  it("teto esgotado e fila maior que um dia: soma janelas", () => {
    expect(estimateDrainSeconds(2500, 10, 0, 1000)).toBe(3 * 86_400 + 50);
  });
});

describe("maskPhone", () => {
  it("celular", () => {
    expect(maskPhone("+5511987654321")).toBe("+55 11 9****-4321");
  });
  it("fixo", () => {
    expect(maskPhone("+551187654321")).toBe("+55 11 ****-4321");
  });
  it("nulo ou estranho não vaza nada", () => {
    expect(maskPhone(null)).toBe("(sem número)");
    expect(maskPhone("+1234")).toBe("****");
  });
});

describe("modelo da Meta", () => {
  const values = templateValues({
    name: "Ana",
    eventName: "Congresso 2027",
    startsAt: "2027-03-10T22:00:00.000Z",
    timezone: "America/Sao_Paulo",
    venue: "Expominas",
    city: "Belo Horizonte",
    number: "2027-000123",
    token: "ABC.def",
    code: null,
  });

  it("formata data e horário no fuso do evento", () => {
    expect(values.date).toBe("10/03/2027");
    expect(values.time).toBe("19:00");
    expect(values.place).toBe("Expominas · Belo Horizonte");
  });

  it("v2 da confirmação: QR por link no cabeçalho, 5 parâmetros e botão com o token", () => {
    const message = buildTemplateMessage(
      {
        name: "confirmacao_inscricao",
        language: "pt_BR",
        header_type: "image",
        param_order: ["name", "event_name", "date", "time", "place"],
        button_param: "token",
      },
      values,
      { headerImageUrl: "https://ingressos.example/api/ingresso/ABC.def/qr.png" },
    );
    expect(message).toEqual({
      name: "confirmacao_inscricao",
      language: { code: "pt_BR" },
      components: [
        {
          type: "header",
          parameters: [
            { type: "image", image: { link: "https://ingressos.example/api/ingresso/ABC.def/qr.png" } },
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "Congresso 2027" },
            { type: "text", text: "10/03/2027" },
            { type: "text", text: "19:00" },
            { type: "text", text: "Expominas · Belo Horizonte" },
          ],
        },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "ABC.def" }] },
      ],
    });
  });

  it("valor vazio vira travessão (a Meta recusa parâmetro vazio)", () => {
    const message = buildTemplateMessage(
      { name: "x", language: "pt_BR", header_type: "none", param_order: ["number"], button_param: null },
      { ...values, number: "" },
      {},
    );
    expect(message.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "—" }] },
    ]);
  });

  it("cabeçalho de imagem sem URL é erro (não manda confirmação sem QR)", () => {
    expect(() =>
      buildTemplateMessage(
        { name: "x", language: "pt_BR", header_type: "image", param_order: [], button_param: null },
        values,
        {},
      ),
    ).toThrow(/QR/);
  });

  it("chave de parâmetro desconhecida é erro", () => {
    expect(() =>
      buildTemplateMessage(
        { name: "x", language: "pt_BR", header_type: "none", param_order: ["cpf"], button_param: null },
        values,
        {},
      ),
    ).toThrow(/cpf/);
  });
});

describe("metaGraphBase", () => {
  it("usa META_GRAPH_VERSION quando válida", () => {
    expect(metaGraphBase({ META_GRAPH_VERSION: "v24.0" })).toBe("https://graph.facebook.com/v24.0");
  });
  it("cai no padrão v23.0 com valor ausente ou inválido", () => {
    expect(metaGraphBase({})).toBe("https://graph.facebook.com/v23.0");
    expect(metaGraphBase({ META_GRAPH_VERSION: "latest" })).toBe("https://graph.facebook.com/v23.0");
  });
});
