import { describe, expect, it } from "vitest";

import { describeBatch, estimateBatch, formatDuration } from "@/lib/outbox/estimate";

const padrao = { intervalSeconds: 20, dailyLimit: 300, sentToday: 0 };

describe("estimativa de lote", () => {
  it("não inventa tempo para lote vazio", () => {
    expect(estimateBatch(0, padrao)).toEqual({
      today: 0,
      deferred: 0,
      extraDays: 0,
      todaySeconds: 0,
    });
  });

  it("uma mensagem sai na hora — o intervalo é ENTRE mensagens", () => {
    expect(estimateBatch(1, padrao).todaySeconds).toBe(0);
  });

  it("conta os intervalos, não as mensagens", () => {
    // 3 mensagens têm 2 intervalos entre elas.
    expect(estimateBatch(3, padrao).todaySeconds).toBe(40);
    expect(estimateBatch(183, padrao).todaySeconds).toBe(182 * 20);
  });

  it("corta no teto diário e empurra o resto", () => {
    const e = estimateBatch(5, { intervalSeconds: 20, dailyLimit: 3, sentToday: 0 });
    expect(e).toMatchObject({ today: 3, deferred: 2, extraDays: 1 });
    expect(e.todaySeconds).toBe(40);
  });

  it("desconta o que já saiu hoje", () => {
    const e = estimateBatch(5, { intervalSeconds: 20, dailyLimit: 3, sentToday: 2 });
    expect(e).toMatchObject({ today: 1, deferred: 4, extraDays: 2 });
  });

  it("teto já estourado joga tudo para os próximos dias", () => {
    const e = estimateBatch(5, { intervalSeconds: 20, dailyLimit: 3, sentToday: 3 });
    expect(e).toMatchObject({ today: 0, deferred: 5, extraDays: 2, todaySeconds: 0 });
  });

  it("lote muito maior que o teto vira vários dias", () => {
    expect(estimateBatch(700, padrao)).toMatchObject({
      today: 300,
      deferred: 400,
      extraDays: 2,
    });
  });

  it("ignora contagem negativa ou quebrada em vez de produzir tempo negativo", () => {
    expect(estimateBatch(-5, padrao).today).toBe(0);
    expect(estimateBatch(2.7, padrao).today).toBe(2);
    expect(estimateBatch(5, { ...padrao, sentToday: 9999 }).today).toBe(0);
  });
});

describe("duração legível", () => {
  it("cobre as faixas que aparecem na tela", () => {
    expect(formatDuration(0)).toBe("imediato");
    expect(formatDuration(-10)).toBe("imediato");
    expect(formatDuration(40)).toBe("~40s");
    expect(formatDuration(600)).toBe("~10min");
    expect(formatDuration(3600)).toBe("~1h");
    expect(formatDuration(4800)).toBe("~1h20");
  });
});

describe("frase do botão de reenvio", () => {
  it("avisa quando não há nada selecionado", () => {
    expect(describeBatch(0, padrao)).toBe("Nenhuma mensagem selecionada");
  });

  it("diz quantas e quanto tempo quando tudo cabe hoje", () => {
    const frase = describeBatch(183, padrao);
    expect(frase).toContain("183 mensagens");
    expect(frase).toContain("~1h");
  });

  it("concorda em número no singular", () => {
    expect(describeBatch(1, padrao)).toContain("1 mensagem");
  });

  it("separa o que sai hoje do que fica para depois", () => {
    const frase = describeBatch(5, { intervalSeconds: 20, dailyLimit: 3, sentToday: 0 });
    expect(frase).toContain("3 hoje");
    expect(frase).toContain("2 em mais 1 dia");
  });

  it("avisa quando o teto do dia já acabou", () => {
    const frase = describeBatch(5, { intervalSeconds: 20, dailyLimit: 3, sentToday: 3 });
    expect(frase).toContain("teto diário atingido");
  });
});
