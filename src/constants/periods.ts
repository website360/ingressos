/**
 * Janelas de período do relatório.
 *
 * Fica em constants/ porque é usada em três lugares — relatórios, check-ins e
 * as rotas de exportação — e porque `report-data.ts` é `server-only`, enquanto
 * a barra de filtros roda no navegador. As duas pontas precisam da mesma lista: se a
 * tela oferecer um valor que o servidor não reconhece, o filtro é aceito na
 * URL e ignorado no resultado — o pior tipo de falha, porque parece funcionar.
 */
export const PERIODOS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "365", label: "Últimos 12 meses" },
] as const;
