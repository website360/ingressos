import { describe, expect, it } from "vitest";

import { whatsappCapacitySchema } from "@shared/schemas/whatsapp";

import { queueView, type QueueStats } from "@/features/envios/lib/queue-format";

const base: QueueStats = {
  por_status: {},
  em_fila: 0,
  agendadas: 0,
  tamanho_fila: 0,
  marcos: { aceitas: 0, enviadas: 0, entregues: 0, lidas: 0 },
  taxa_1min: 0,
  taxa_5min: 0,
  idade_mais_antiga_s: null,
  inscricoes: 0,
  destinatarios_24h: 0,
  teto_diario: 1000,
  vazao_configurada: 20,
  concorrencia: 16,
  pausado: false,
  motivo: null,
  breaker_ate: null,
  breaker_manual: false,
  qualidade: null,
  nivel: null,
  workers: 1,
  gerado_em: "2026-11-18T12:00:00.000Z",
};

describe("números do painel", () => {
  it("percentual de entrega sobre o que a Meta aceitou", () => {
    const v = queueView({
      ...base,
      marcos: { aceitas: 200, enviadas: 190, entregues: 150, lidas: 90 },
      por_status: { falhou: 10, lida: 90, entregue: 60, aceita: 50 },
    });
    expect(v.deliveryPct).toBe("75,0%");
    expect(v.failurePct).toBe("4,8%");
  });

  it("sem envios ainda: traço, não 0% nem NaN", () => {
    const v = queueView(base);
    expect(v.deliveryPct).toBe("—");
    expect(v.failurePct).toBe("—");
    expect(v.speed).toBe("0 msg/s");
  });

  it("velocidade pelo último minuto, com uma casa", () => {
    expect(queueView({ ...base, taxa_1min: 18.53 }).speed).toBe("18,5 msg/s");
  });

  it("idade da mais antiga em texto curto", () => {
    expect(queueView({ ...base, idade_mais_antiga_s: 45 }).oldest).toBe("45s");
    expect(queueView({ ...base, idade_mais_antiga_s: 3_700 }).oldest).toBe("1h02");
    expect(queueView({ ...base, idade_mais_antiga_s: null }).oldest).toBe("—");
  });

  it("estimativa pela vazão observada dos últimos 5 minutos", () => {
    const v = queueView({ ...base, tamanho_fila: 12_000, taxa_5min: 20, destinatarios_24h: 0, teto_diario: 100_000 });
    expect(v.drain).toBe("~10min");
  });

  it("fila parada sem vazão: diz que não há estimativa", () => {
    expect(queueView({ ...base, tamanho_fila: 500, taxa_5min: 0 }).drain).toBe("sem vazão para estimar");
  });

  it("teto diário: usado e total, e alerta quando atingido", () => {
    const v = queueView({ ...base, destinatarios_24h: 1000, teto_diario: 1000, motivo: "teto_diario" });
    expect(v.daily).toBe("1.000 de 1.000");
    expect(v.alerts).toContain("Teto diário de destinatários atingido: a fila volta a andar quando a janela de 24 h liberar.");
  });

  it("alertas de pausa, breaker e worker parado", () => {
    expect(queueView({ ...base, pausado: true, motivo: "token inválido" }).alerts).toContain(
      "Envios pausados: token inválido",
    );
    expect(
      queueView({ ...base, breaker_ate: "2026-11-18T12:05:00.000Z" }).alerts.some((a) =>
        a.startsWith("Envios suspensos por excesso de erros"),
      ),
    ).toBe(true);
    expect(queueView({ ...base, workers: 0, tamanho_fila: 10 }).alerts).toContain(
      "Nenhum worker ativo: as mensagens não estão saindo.",
    );
  });
});

describe("capacidade do número", () => {
  it("aceita valores dentro das faixas", () => {
    expect(
      whatsappCapacitySchema.parse({ rate_per_second: "80", daily_unique_limit: "100000", worker_concurrency: "32" }),
    ).toEqual({ rate_per_second: 80, daily_unique_limit: 100000, worker_concurrency: 32 });
  });

  it("recusa fora das faixas", () => {
    expect(whatsappCapacitySchema.safeParse({ rate_per_second: 0, daily_unique_limit: 1, worker_concurrency: 1 }).success).toBe(false);
    expect(whatsappCapacitySchema.safeParse({ rate_per_second: 1001, daily_unique_limit: 1, worker_concurrency: 1 }).success).toBe(false);
    expect(whatsappCapacitySchema.safeParse({ rate_per_second: 10, daily_unique_limit: 1, worker_concurrency: 257 }).success).toBe(false);
  });
});
