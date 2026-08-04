import { type NextRequest } from "next/server";

import { carimbo, criarPlanilha, folha, xlsxResponse } from "@/lib/export/xlsx";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatCpf, maskCpf } from "@/lib/format";
import { getRepositories } from "@/repositories";
import type { RegistrationRow } from "@/repositories";
import type { RegistrationStatus } from "@/lib/supabase/database.types";

/**
 * Exportação de participantes em Excel.
 *
 * Mesmos filtros e o mesmo mascaramento de CPF do CSV e da tela: exportar não
 * pode virar um caminho para contornar a permissão `attendee.read_sensitive`.
 * Trocar o formato do arquivo não muda quem pode ver o quê.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requirePermission(PERMISSIONS.REGISTRATION_EXPORT);
  const mostrarSensivel = session.permissions.includes(PERMISSIONS.ATTENDEE_READ_SENSITIVE);

  const params = request.nextUrl.searchParams;
  const { registrations } = await getRepositories();

  const { items } = await registrations.list({
    q: params.get("q") ?? undefined,
    eventId: params.get("event") ?? undefined,
    status: (params.get("status") as RegistrationStatus | null) ?? undefined,
    checkedIn: (params.get("presente") as "sim" | "nao" | null) ?? undefined,
    limit: 5000,
  });

  const planilha = criarPlanilha([
    folha<RegistrationRow>({
      name: "Participantes",
      rows: items,
      columns: [
        { header: "Inscrição", width: 18, value: (linha) => linha.number },
        { header: "Nome", width: 32, value: (linha) => linha.full_name },
        {
          header: "CPF",
          width: 16,
          value: (linha) =>
            linha.cpf ? (mostrarSensivel ? formatCpf(linha.cpf) : maskCpf(linha.cpf)) : "",
        },
        { header: "E-mail", width: 32, value: (linha) => linha.email },
        { header: "Telefone", width: 18, value: (linha) => linha.phone },
        { header: "Cidade", width: 22, value: (linha) => linha.city },
        { header: "Estado", width: 10, value: (linha) => linha.state },
        { header: "Evento", width: 36, value: (linha) => linha.event_name },
        { header: "Status", width: 14, value: (linha) => linha.status },
        { header: "Ingresso", width: 20, value: (linha) => linha.ticket_code },
        { header: "Compareceu", width: 13, value: (linha) => (linha.checked_in ? "Sim" : "Não") },
        {
          header: "Check-in em",
          width: 20,
          numFmt: "dd/mm/yyyy hh:mm",
          value: (linha) => (linha.checked_in_at ? new Date(linha.checked_in_at) : null),
        },
        {
          header: "Inscrito em",
          width: 20,
          numFmt: "dd/mm/yyyy hh:mm",
          value: (linha) => (linha.created_at ? new Date(linha.created_at) : null),
        },
      ],
    }),
  ]);

  return xlsxResponse(planilha, `participantes-${carimbo()}.xlsx`);
}
