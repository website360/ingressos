import "server-only";

import { TICKET_CODE_TTL_MINUTES } from "@shared/schemas/second-copy";

/**
 * Templates de e-mail transacional.
 *
 * HTML com estilos inline e tabela: é o único formato que sobrevive ao Outlook,
 * ao Gmail e aos clientes móveis sem quebrar. Toda mensagem tem versão em texto
 * puro — filtros de spam penalizam e-mails só-HTML, e leitores de tela agradecem.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "#2563eb";

function layout(title: string, body: string, footer?: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:16px;font-weight:600">Ingressos</td></tr>
  <tr><td style="padding:28px">${body}</td></tr>
  <tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
    ${footer ?? "Você recebeu este e-mail porque se inscreveu em um evento. Seus dados são tratados conforme a LGPD."}
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">${label}</a>`;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export interface EmailPayload {
  to: string;
  name?: string;
  event_name?: string;
  event_starts_at?: string;
  event_slug?: string;
  venue?: string;
  city?: string;
  number?: string;
  ticket_code?: string;
  token?: string;
  /** Código de seis dígitos da segunda via. */
  code?: string;
}

export function renderEmail(type: string, payload: EmailPayload, appUrl: string): EmailContent {
  const name = payload.name ?? "";

  switch (type) {
    case "email.registration_confirmed": {
      const ticketUrl = `${appUrl}/ingresso/${payload.token}`;
      const when = payload.event_starts_at ? formatWhen(payload.event_starts_at) : "";
      const place = [payload.venue, payload.city].filter(Boolean).join(" · ");

      return {
        subject: `Inscrição confirmada: ${payload.event_name}`,
        html: layout(
          "Inscrição confirmada",
          `<p style="margin:0 0 14px;font-size:16px">Olá, ${name}!</p>
           <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
             Sua vaga em <strong>${payload.event_name}</strong> está confirmada.
           </p>
           <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
             <tr><td style="font-size:13px;line-height:1.8;color:#334155">
               <strong>Quando:</strong> ${when}<br>
               ${place ? `<strong>Onde:</strong> ${place}<br>` : ""}
               <strong>Inscrição:</strong> ${payload.number}<br>
               <strong>Ingresso:</strong> ${payload.ticket_code}
             </td></tr>
           </table>
           <p style="margin:0 0 18px">${button(ticketUrl, "Ver meu ingresso")}</p>
           <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">
             Apresente o QR Code do ingresso na entrada — não precisa imprimir.
             Se não puder comparecer, cancele por esse mesmo link para liberar sua vaga.
           </p>`,
        ),
        text: `Olá, ${name}!\n\nSua vaga em ${payload.event_name} está confirmada.\n\nQuando: ${when}\n${place ? `Onde: ${place}\n` : ""}Inscrição: ${payload.number}\nIngresso: ${payload.ticket_code}\n\nSeu ingresso: ${ticketUrl}\n\nApresente o QR Code na entrada. Se não puder comparecer, cancele pelo link para liberar sua vaga.`,
      };
    }

    case "email.registration_cancelled":
      return {
        subject: `Inscrição cancelada: ${payload.event_name}`,
        html: layout(
          "Inscrição cancelada",
          `<p style="margin:0 0 14px;font-size:16px">Olá, ${name}.</p>
           <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
             Sua inscrição <strong>${payload.number}</strong> em
             <strong>${payload.event_name}</strong> foi cancelada e o ingresso não é mais válido.
           </p>
           <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">
             Se foi engano, você pode se inscrever novamente pela página do evento, desde que ainda
             haja vagas. Um novo ingresso será emitido.
           </p>`,
        ),
        text: `Olá, ${name}.\n\nSua inscrição ${payload.number} em ${payload.event_name} foi cancelada e o ingresso não é mais válido.\n\nSe foi engano, inscreva-se novamente pela página do evento — um novo ingresso será emitido.`,
      };

    case "email.event_reminder":
      return {
        subject: `Amanhã: ${payload.event_name}`,
        html: layout(
          "Lembrete do evento",
          `<p style="margin:0 0 14px;font-size:16px">Olá, ${name}!</p>
           <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
             <strong>${payload.event_name}</strong> acontece em breve.
             ${payload.event_starts_at ? `<br>${formatWhen(payload.event_starts_at)}` : ""}
           </p>
           <p style="margin:0">${button(`${appUrl}/ingresso/${payload.token}`, "Abrir meu ingresso")}</p>`,
        ),
        text: `Olá, ${name}!\n\n${payload.event_name} acontece em breve.\n${payload.event_starts_at ? formatWhen(payload.event_starts_at) : ""}\n\nSeu ingresso: ${appUrl}/ingresso/${payload.token}`,
      };

    /**
     * Código da segunda via.
     *
     * Sem link para o ingresso: o código serve para abrir a lista na tela onde
     * foi pedido, e um e-mail que já trouxesse o ingresso tornaria a
     * conferência inútil — bastaria ter acesso à caixa de entrada, que é
     * justamente o que a pessoa diz ter perdido.
     */
    case "email.ticket_code": {
      return {
        subject: `Seu código: ${payload.code}`,
        html: layout(
          "Código da segunda via",
          `<p style="margin:0 0 14px;font-size:16px">Olá${name ? `, ${name}` : ""}!</p>
           <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
             Use o código abaixo na tela em que você pediu a segunda via do ingresso.
           </p>
           <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:20px">
             <tr><td align="center" style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
               ${payload.code}
             </td></tr>
           </table>
           <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">
             O código vale por ${TICKET_CODE_TTL_MINUTES} minutos e só pode ser usado uma vez.
             Se não foi você que pediu, ignore este e-mail — nada acontece sem o código.
           </p>`,
          "Você recebeu este e-mail porque alguém pediu a segunda via de um ingresso com o seu CPF.",
        ),
        text: `Olá${name ? `, ${name}` : ""}!\n\nSeu código para ver o ingresso: ${payload.code}\n\nEle vale por ${TICKET_CODE_TTL_MINUTES} minutos e só pode ser usado uma vez. Digite na tela em que você pediu a segunda via.\n\nSe não foi você que pediu, ignore este e-mail.`,
      };
    }

    default:
      throw new Error(`Template de e-mail desconhecido: ${type}`);
  }
}
