import "server-only";

import { NextResponse } from "next/server";

import ExcelJS from "exceljs";

/**
 * Geração de planilha .xlsx.
 *
 * Formato único de exportação do painel: arquivo aberto pelo Excel, Sheets e
 * LibreOffice sem aviso de formato. O CSV que existia antes saiu — fazia a
 * mesma coisa com menos, e manter dois caminhos para o mesmo dado dobra a
 * chance de um sair diferente do outro sem ninguém notar.
 *
 * A regra que vale para toda coluna numérica: gravar número, nunca texto
 * formatado. Uma célula com "85,3%" é uma string e não soma, não ordena por
 * grandeza e não vira gráfico — que é justamente o que se espera de quem pediu
 * o arquivo em Excel.
 */
export interface XlsxColumn<T> {
  header: string;
  width?: number;
  /** Formato do Excel — ex.: "0.0%" para porcentagem, "dd/mm/yyyy hh:mm" para data. */
  numFmt?: string;
  value: (row: T) => string | number | Date | null;
}

export interface XlsxSheet<T> {
  name: string;
  columns: XlsxColumn<T>[];
  rows: T[];
  /** Linha de aviso abaixo dos dados — usada quando uma aba tem recorte próprio. */
  nota?: string;
}

const CABECALHO_FUNDO = "FF2563EB";

/** Aba já resolvida: o tipo da linha some aqui, depois de `folha` conferi-lo. */
export type AbaPronta = XlsxSheet<Record<string, never>>;

/**
 * Declara uma aba com o tipo da linha conferido.
 *
 * Uma planilha pode ter abas de tipos diferentes — o relatório tem três —, e um
 * array heterogêneo perderia a checagem de cada `value`. Passando por aqui,
 * cada aba é validada contra o seu próprio tipo antes de entrar na lista.
 */
export function folha<T>(definicao: XlsxSheet<T>): AbaPronta {
  return definicao as unknown as AbaPronta;
}

export function criarPlanilha(abas: AbaPronta[]): ExcelJS.Workbook {
  const livro = new ExcelJS.Workbook();
  livro.creator = "Ingressos";
  livro.created = new Date();

  for (const definicao of abas) {
    const aba = livro.addWorksheet(definicao.name);

    aba.columns = definicao.columns.map((coluna, indice) => ({
      header: coluna.header,
      key: String(indice),
      width: coluna.width ?? 18,
    }));

    for (const linha of definicao.rows) {
      aba.addRow(
        Object.fromEntries(definicao.columns.map((coluna, i) => [String(i), coluna.value(linha)])),
      );
    }

    definicao.columns.forEach((coluna, indice) => {
      if (coluna.numFmt) aba.getColumn(indice + 1).numFmt = coluna.numFmt;
    });

    if (definicao.nota) {
      aba.addRow({});
      aba.addRow({ "0": definicao.nota });
    }

    const cabecalho = aba.getRow(1);
    cabecalho.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cabecalho.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CABECALHO_FUNDO } };
    cabecalho.alignment = { vertical: "middle" };
    cabecalho.height = 20;

    // Cabeçalho congelado e autofiltro: numa lista de milhares de linhas, é a
    // diferença entre uma planilha usável e um despejo de dados.
    aba.views = [{ state: "frozen", ySplit: 1 }];
    if (definicao.rows.length > 0) {
      aba.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: definicao.columns.length },
      };
    }
  }

  return livro;
}

export async function xlsxResponse(livro: ExcelJS.Workbook, nome: string): Promise<NextResponse> {
  const buffer = await livro.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Sufixo de data no nome do arquivo, no fuso de quem baixa. */
export function carimbo(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
