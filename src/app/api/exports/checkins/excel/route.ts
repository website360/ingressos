import { type NextRequest } from "next/server";

import { carimbo, criarPlanilha, folha, xlsxResponse } from "@/lib/export/xlsx";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";
import type { CheckinResult } from "@/lib/supabase/database.types";

/**
 * Exportação de check-ins em Excel.
 *
 * Mesmos filtros da tela — evento, resultado, busca e período. Um exportador
 * que monta o próprio recorte entrega um arquivo que não bate com o que a
 * pessoa estava vendo, e ninguém percebe até a conferência dar errado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LinhaCheckin {
  result: CheckinResult;
  checked_in_at: string;
  within_geofence: boolean | null;
  distance_m: number | null;
  override_confirmed: boolean;
  source: string;
  offline_captured: boolean;
  event: { name: string } | null;
  operator: { full_name: string } | null;
  registration: {
    number: string;
    attendee: { first_name: string; last_name: string } | null;
  } | null;
}

const RESULTADO: Record<string, string> = {
  sucesso: "Confirmado",
  duplicado: "Duplicado",
  invalido: "Inválido",
  cancelado: "Cancelado",
  fora_do_raio: "Fora do raio",
};

export async function GET(request: NextRequest) {
  await requireAnyPermission([PERMISSIONS.CHECKIN_READ, PERMISSIONS.CHECKIN_EXECUTE]);

  const params = request.nextUrl.searchParams;
  const { checkins } = await getRepositories();

  const { items } = await checkins.list({
    eventId: params.get("event") ?? undefined,
    result: (params.get("result") as CheckinResult | null) ?? undefined,
    q: params.get("q") ?? undefined,
    from: params.get("de") ?? undefined,
    to: params.get("ate") ?? undefined,
    // Limite alto e explícito, igual ao CSV de participantes: acima disso a
    // exportação precisa virar job assíncrono, não crescer calada.
    limit: 5000,
  });

  const linhas = items as unknown as LinhaCheckin[];

  const planilha = criarPlanilha([
    folha<LinhaCheckin>({
      name: "Check-ins",
      rows: linhas,
      columns: [
        {
          header: "Participante",
          width: 32,
          value: (linha) =>
            linha.registration?.attendee
              ? `${linha.registration.attendee.first_name} ${linha.registration.attendee.last_name}`
              : "—",
        },
        { header: "Inscrição", width: 18, value: (linha) => linha.registration?.number ?? "—" },
        { header: "Evento", width: 36, value: (linha) => linha.event?.name ?? "—" },
        {
          header: "Resultado",
          width: 16,
          value: (linha) => RESULTADO[linha.result] ?? linha.result,
        },
        {
          header: "Data e hora",
          width: 20,
          // Data de verdade, não texto: o Excel ordena cronologicamente e
          // permite agrupar por dia, o que uma string "04/08 09:12" não faz.
          numFmt: "dd/mm/yyyy hh:mm",
          value: (linha) => new Date(linha.checked_in_at),
        },
        {
          header: "Dentro do raio",
          width: 15,
          value: (linha) =>
            linha.within_geofence === null
              ? "Sem localização"
              : linha.within_geofence
                ? "Sim"
                : "Não",
        },
        {
          header: "Distância (m)",
          width: 14,
          numFmt: "0",
          value: (linha) => linha.distance_m ?? null,
        },
        {
          header: "Liberado com exceção",
          width: 20,
          value: (linha) => (linha.override_confirmed ? "Sim" : "Não"),
        },
        { header: "Recepcionista", width: 26, value: (linha) => linha.operator?.full_name ?? "—" },
        { header: "Origem", width: 14, value: (linha) => linha.source },
        {
          header: "Capturado offline",
          width: 17,
          value: (linha) => (linha.offline_captured ? "Sim" : "Não"),
        },
      ],
    }),
  ]);

  return xlsxResponse(planilha, `checkins-${carimbo()}.xlsx`);
}
