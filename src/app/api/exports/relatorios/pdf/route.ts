import { NextResponse, type NextRequest } from "next/server";

import { renderToBuffer } from "@react-pdf/renderer";

import { montarRelatorio } from "@/features/reports/report-data";
import { ReportDocument } from "@/features/reports/pdf/report-document";
import { formatInTimezone } from "@/lib/format";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";

/**
 * Relatório consolidado em PDF.
 *
 * Runtime Node (ADR-008): o @react-pdf/renderer precisa de APIs que a borda não
 * tem. A permissão é conferida antes de qualquer consulta — o arquivo carrega
 * números de todos os eventos, não é conteúdo público.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requirePermission(PERMISSIONS.REPORT_READ);

  const [dados, { tenant }] = await Promise.all([
    montarRelatorio(request.nextUrl.searchParams),
    getRepositories(),
  ]);

  // O nome no cabeçalho é enfeite útil, não requisito: se a consulta falhar, o
  // relatório sai assim mesmo em vez de devolver erro para quem só quer o PDF.
  const empresa = session.activeTenantId
    ? await tenant
        .findById(session.activeTenantId)
        .then((t) => t.name)
        .catch(() => "Ingressos")
    : "Ingressos";

  const buffer = await renderToBuffer(
    ReportDocument({
      dados,
      empresa,
      // Fuso explícito: o servidor roda em UTC e a data de emissão impressa
      // precisa ser a de quem lê o relatório, não a do datacenter.
      emitidoEm: formatInTimezone(new Date(), "America/Sao_Paulo", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    }),
  );

  const arquivo = `relatorio-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
