import { NextResponse, type NextRequest } from "next/server";

import ExcelJS from "exceljs";

import { montarRelatorio } from "@/features/reports/report-data";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

/**
 * Relatório em Excel — planilha de verdade, não CSV renomeado.
 *
 * Três abas, porque são três perguntas diferentes: o resumo do período, o
 * desempenho de cada evento e a distribuição por estado. Juntar tudo numa aba
 * só obrigaria quem recebe a separar de novo antes de conseguir usar.
 *
 * Runtime Node: o ExcelJS monta o arquivo em memória com APIs que a borda não
 * tem, e a permissão é conferida antes de qualquer consulta.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CABECALHO = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } },
} as const;

function aplicarCabecalho(aba: ExcelJS.Worksheet) {
  const linha = aba.getRow(1);
  linha.font = CABECALHO.font;
  linha.fill = CABECALHO.fill as ExcelJS.Fill;
  linha.alignment = { vertical: "middle" };
  linha.height = 20;
  aba.views = [{ state: "frozen", ySplit: 1 }];
}

export async function GET(request: NextRequest) {
  await requirePermission(PERMISSIONS.REPORT_READ);

  const dados = await montarRelatorio(request.nextUrl.searchParams);

  const livro = new ExcelJS.Workbook();
  livro.creator = "Ingressos";
  livro.created = new Date();

  // ---------------------------------------------------------------- resumo
  const resumo = livro.addWorksheet("Resumo");
  resumo.columns = [
    { header: "Indicador", key: "indicador", width: 30 },
    { header: "Valor", key: "valor", width: 18 },
  ];
  resumo.addRows([
    { indicador: "Período", valor: dados.periodo },
    { indicador: "Inscritos", valor: dados.resumo.inscritos },
    { indicador: "Presentes", valor: dados.resumo.presentes },
    { indicador: "Ausentes", valor: dados.resumo.ausentes },
    { indicador: "Cancelados", valor: dados.resumo.cancelados },
    {
      indicador: "Taxa de comparecimento",
      valor: dados.resumo.comparecimento != null ? dados.resumo.comparecimento / 100 : "—",
    },
  ]);
  resumo.getCell("B7").numFmt = "0.0%";
  aplicarCabecalho(resumo);

  // ------------------------------------------------------------- por evento
  const eventos = livro.addWorksheet("Por evento");
  eventos.columns = [
    { header: "Evento", key: "nome", width: 44 },
    { header: "Inscritos", key: "inscritos", width: 12 },
    { header: "Presentes", key: "presentes", width: 12 },
    { header: "Ocupação", key: "ocupacao", width: 12 },
    { header: "Comparecimento", key: "comparecimento", width: 16 },
  ];
  for (const evento of dados.eventos) {
    eventos.addRow({
      nome: evento.nome,
      inscritos: evento.inscritos,
      presentes: evento.presentes,
      // Divididos por 100 e formatados como porcentagem: assim a célula é
      // número de verdade e continua servindo para somar, ordenar e gráfico.
      ocupacao: evento.ocupacao != null ? evento.ocupacao / 100 : null,
      comparecimento: evento.comparecimento != null ? evento.comparecimento / 100 : null,
    });
  }
  eventos.getColumn("ocupacao").numFmt = "0.0%";
  eventos.getColumn("comparecimento").numFmt = "0.0%";
  aplicarCabecalho(eventos);

  // ------------------------------------------------------------ por estado
  const estados = livro.addWorksheet("Por estado");
  // Vem de uma RPC que só aceita período — dito na própria aba, para ninguém
  // cruzar com "Por evento" achando que os dois respondem ao mesmo filtro.
  estados.columns = [
    { header: "Estado", key: "estado", width: 12 },
    { header: "Participantes", key: "participantes", width: 16 },
    { header: "Participação", key: "participacao", width: 14 },
  ];
  for (const linha of dados.estados) {
    estados.addRow({
      estado: linha.estado,
      participantes: linha.participantes,
      participacao: linha.participacao / 100,
    });
  }
  estados.getColumn("participacao").numFmt = "0.0%";
  estados.addRow({});
  estados.addRow({
    estado: "Recorte apenas por período — situação e nome não se aplicam a esta aba.",
  });
  aplicarCabecalho(estados);

  const buffer = await livro.xlsx.writeBuffer();
  const arquivo = `relatorio-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
