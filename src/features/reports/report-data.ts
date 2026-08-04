import "server-only";

import { PERIODOS } from "@/features/reports/periods";
import { getRepositories } from "@/repositories";

/**
 * Recorte do relatório, tal como vem da querystring.
 *
 * Tela, PDF e Excel leem daqui — os três precisam responder exatamente à mesma
 * pergunta. Um exportador que monta o próprio filtro é a forma mais silenciosa
 * de entregar um arquivo que não bate com o que estava na tela.
 */
export interface ReportFilters {
  from?: string;
  to?: string;
  status?: string;
  q?: string;
}

/** Converte `?dias=30` em um intervalo, ou aceita `de`/`ate` explícitos. */
export function resolverPeriodo(params: URLSearchParams): { from?: string; to?: string } {
  const de = params.get("de");
  const ate = params.get("ate");
  if (de || ate) return { from: de ?? undefined, to: ate ?? undefined };

  const dias = params.get("dias");
  if (!dias || !PERIODOS.some((p) => p.value === dias)) return {};

  const fim = new Date();
  const inicio = new Date(fim.getTime() - Number(dias) * 24 * 60 * 60 * 1000);
  return { from: inicio.toISOString(), to: fim.toISOString() };
}

export function descreverPeriodo(params: URLSearchParams): string {
  const de = params.get("de");
  const ate = params.get("ate");
  if (de || ate) {
    const formatar = (v: string | null) =>
      v ? new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "…";
    return `${formatar(de)} a ${formatar(ate)}`;
  }

  const dias = params.get("dias");
  return PERIODOS.find((p) => p.value === dias)?.label ?? "Todo o período";
}

export interface LinhaEvento {
  id: string;
  nome: string;
  inscritos: number;
  presentes: number;
  cancelados: number;
  ocupacao: number | null;
  comparecimento: number | null;
}

export interface LinhaEstado {
  estado: string;
  participantes: number;
  participacao: number;
}

export interface DadosRelatorio {
  periodo: string;
  resumo: {
    inscritos: number;
    presentes: number;
    ausentes: number;
    cancelados: number;
    comparecimento: number | null;
  };
  eventos: LinhaEvento[];
  estados: LinhaEstado[];
}

/**
 * Monta o relatório inteiro a partir dos filtros.
 *
 * O resumo é somado sobre exatamente os eventos da tabela, e não trazido do
 * agregado geral do banco. Fazer diferente produzia o pior tipo de relatório:
 * filtrar por um evento e receber um cabeçalho dizendo 319 inscritos sobre uma
 * tabela que mostra 40 — dois números certos respondendo perguntas diferentes,
 * na mesma folha, sem nada avisando.
 *
 * A distribuição por estado é a exceção, e por limitação real: ela vem de uma
 * RPC que agrega no banco e só aceita período. Por isso é apresentada como o
 * que é — um recorte do período, não da seleção de eventos.
 */
export async function montarRelatorio(params: URLSearchParams): Promise<DadosRelatorio> {
  const { operations, events } = await getRepositories();
  const { from, to } = resolverPeriodo(params);

  const status = params.get("status") ?? undefined;
  const q = params.get("q") ?? undefined;

  const [kpis, lista] = await Promise.all([
    operations.dashboard(from, to),
    events.list({ limit: 200, status: status as never, q, from, to }),
  ]);

  const eventos: LinhaEvento[] = lista.items.map((evento) => ({
    id: evento.event_id ?? "",
    nome: evento.name ?? "—",
    inscritos: evento.seats_taken ?? 0,
    presentes: evento.checked_in_count ?? 0,
    cancelados: evento.cancelled_count ?? 0,
    ocupacao: evento.occupancy_pct ?? null,
    comparecimento: evento.attendance_pct ?? null,
  }));

  const soma = (campo: "inscritos" | "presentes" | "cancelados") =>
    eventos.reduce((total, evento) => total + evento[campo], 0);

  const inscritos = soma("inscritos");
  const presentes = soma("presentes");
  const unicos = Math.max(kpis.attendees_unique, 1);

  return {
    periodo: descreverPeriodo(params),
    resumo: {
      inscritos,
      presentes,
      ausentes: Math.max(inscritos - presentes, 0),
      cancelados: soma("cancelados"),
      comparecimento: inscritos > 0 ? (presentes / inscritos) * 100 : null,
    },
    eventos,
    estados: (kpis.by_state ?? []).map((linha) => ({
      estado: linha.state,
      participantes: linha.total,
      participacao: (linha.total / unicos) * 100,
    })),
  };
}
