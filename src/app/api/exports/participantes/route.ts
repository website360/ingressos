import { NextResponse, type NextRequest } from "next/server";

import { csvResponse, toCsv, type CsvColumn } from "@/lib/export/csv";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatCpf, formatDateTime, maskCpf } from "@/lib/format";
import { getRepositories } from "@/repositories";
import type { RegistrationRow } from "@/repositories";
import type { RegistrationStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * Exportação de participantes em CSV.
 *
 * Respeita os mesmos filtros da tela e o mesmo mascaramento de CPF: exportar
 * não pode virar um caminho para contornar a permissão `attendee.read_sensitive`.
 * A exportação em si é registrada na auditoria.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.REGISTRATION_EXPORT);
    const params = request.nextUrl.searchParams;
    const showSensitive = session.permissions.includes(PERMISSIONS.ATTENDEE_READ_SENSITIVE);

    const { registrations } = await getRepositories();
    const { items } = await registrations.list({
      q: params.get("q") ?? undefined,
      eventId: params.get("event") ?? undefined,
      status: (params.get("status") as RegistrationStatus | null) ?? undefined,
      checkedIn: (params.get("presente") as "sim" | "nao" | null) ?? undefined,
      // Limite alto e explícito: acima disso a exportação vira job assíncrono.
      limit: 5000,
    });

    const columns: CsvColumn<RegistrationRow>[] = [
      { header: "Inscrição", value: (row) => row.number },
      { header: "Nome", value: (row) => row.full_name },
      {
        header: "CPF",
        value: (row) => (row.cpf ? (showSensitive ? formatCpf(row.cpf) : maskCpf(row.cpf)) : ""),
      },
      { header: "E-mail", value: (row) => row.email },
      { header: "Telefone", value: (row) => row.phone },
      { header: "Cidade", value: (row) => row.city },
      { header: "Estado", value: (row) => row.state },
      { header: "Evento", value: (row) => row.event_name },
      { header: "Status", value: (row) => row.status },
      { header: "Ingresso", value: (row) => row.ticket_code },
      { header: "Compareceu", value: (row) => (row.checked_in ? "Sim" : "Não") },
      {
        header: "Check-in em",
        value: (row) => (row.checked_in_at ? formatDateTime(row.checked_in_at) : ""),
      },
      { header: "Inscrito em", value: (row) => formatDateTime(row.created_at) },
    ];

    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse(toCsv(items, columns), `participantes-${stamp}.csv`);
  } catch {
    return NextResponse.json(
      { error: "Sem permissão para exportar participantes." },
      { status: 403 },
    );
  }
}
