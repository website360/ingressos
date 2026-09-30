/**
 * Mensagens transacionais do WhatsApp.
 *
 * Texto puro, com a marcação leve que o WhatsApp entende (`*negrito*`). Nada
 * de HTML: o que o e-mail resolve com tabela, aqui se resolve com linha em
 * branco. O texto é curto de propósito — mensagem longa chega cortada com
 * "Ler mais" e o link some da prévia.
 *
 * Sem `server-only`: é função pura, e o teste unitário importa daqui.
 */

export interface WhatsappPayload {
  phone: string;
  name?: string;
  event_name?: string;
  event_starts_at?: string;
  venue?: string;
  city?: string;
  number?: string;
  ticket_code?: string;
  token?: string;
}

export interface WhatsappContent {
  /** Texto da mensagem — vira legenda da imagem quando há QR anexado. */
  body: string;
  /** Anexa o QR Code do ingresso como imagem. */
  attachTicketQr: boolean;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export function renderWhatsapp(
  type: string,
  payload: WhatsappPayload,
  appUrl: string,
): WhatsappContent {
  const name = payload.name ?? "";

  switch (type) {
    case "whatsapp.registration_confirmed": {
      const when = payload.event_starts_at ? formatWhen(payload.event_starts_at) : "";
      const place = [payload.venue, payload.city].filter(Boolean).join(" · ");

      // O link do ingresso vai por último e sozinho na linha: é assim que o
      // WhatsApp monta a prévia do cartão em vez de deixar a URL crua no meio
      // do parágrafo.
      const lines = [
        `Olá, ${name}! Sua inscrição em *${payload.event_name}* está confirmada. ✅`,
        "",
        when ? `📅 ${when}` : null,
        place ? `📍 ${place}` : null,
        payload.number ? `🎟️ Inscrição ${payload.number}` : null,
        "",
        "Apresente o QR Code acima na entrada — não precisa imprimir.",
        "",
        `${appUrl}/ingresso/${payload.token}`,
      ];

      return { body: lines.filter((line) => line !== null).join("\n"), attachTicketQr: true };
    }

    case "whatsapp.registration_cancelled": {
      const lines = [
        `Olá, ${name}. Sua inscrição em *${payload.event_name}* foi cancelada.`,
        payload.number ? `Inscrição ${payload.number}.` : null,
        "",
        "A vaga voltou para o público. Se foi engano, é só se inscrever de novo enquanto houver lugar.",
      ];

      return { body: lines.filter((line) => line !== null).join("\n"), attachTicketQr: false };
    }

    default:
      throw new Error(`Template de WhatsApp desconhecido: ${type}`);
  }
}
