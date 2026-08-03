/**
 * Geração de CSV.
 *
 * Duas decisões que evitam a reclamação clássica de "abriu tudo errado no Excel":
 *  · BOM UTF-8 no início — sem ele o Excel no Windows quebra os acentos;
 *  · separador ponto e vírgula, o padrão do Excel em português.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);

  // Campo com separador, aspas ou quebra de linha precisa vir entre aspas.
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(";");
  const body = rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(";"));

  return `﻿${[header, ...body].join("\r\n")}`;
}

export function csvResponse(content: string, filename: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
