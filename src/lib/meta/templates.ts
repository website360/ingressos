/**
 * Mensagens no formato de modelo (template) da API oficial do WhatsApp.
 *
 * Na Meta, mensagem iniciada pela empresa só sai por modelo aprovado: o texto
 * fica cadastrado lá, e aqui só se preenchem as variáveis ({{1}}, {{2}}...). Por
 * isso a ORDEM dos parâmetros abaixo é contrato com o texto aprovado — mudar
 * uma sem a outra troca o nome do participante pelo do evento.
 *
 * Função pura, sem `server-only`: o teste unitário importa daqui.
 */
import { formatWhen, type WhatsappPayload } from "@/lib/whatsapp/templates";

export interface MetaTemplateConfig {
  confirmed: string;
  cancelled: string;
  code: string;
  language: string;
}

export const META_TEMPLATE_DEFAULTS: MetaTemplateConfig = {
  confirmed: "ingresso_confirmado",
  cancelled: "inscricao_cancelada",
  code: "codigo_segunda_via",
  language: "pt_BR",
};

/** Nome de modelo na Meta: minúsculas, números e sublinhado. */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE = /^[a-z]{2}(_[A-Z]{2})?$/;

/** Junta o que a empresa configurou com os padrões, descartando valor inválido. */
export function resolveTemplateConfig(raw: unknown): MetaTemplateConfig {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (key: keyof MetaTemplateConfig, pattern: RegExp) => {
    const value = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    return pattern.test(value) ? value : META_TEMPLATE_DEFAULTS[key];
  };
  return {
    confirmed: pick("confirmed", TEMPLATE_NAME),
    cancelled: pick("cancelled", TEMPLATE_NAME),
    code: pick("code", TEMPLATE_NAME),
    language: pick("language", LANGUAGE),
  };
}

export interface MetaTemplateMessage {
  name: string;
  language: { code: string };
  components: Record<string, unknown>[];
}

/** A Meta recusa parâmetro vazio (erro 131008); travessão mantém a frase legível. */
const text = (value: string | null | undefined) => ({
  type: "text",
  text: value && value.trim() !== "" ? value.trim() : "—",
});

export function buildMetaTemplate(
  type: string,
  payload: WhatsappPayload,
  config: MetaTemplateConfig,
  options: { headerMediaId?: string },
): MetaTemplateMessage {
  const language = { code: config.language };

  switch (type) {
    case "whatsapp.registration_confirmed": {
      if (!options.headerMediaId) {
        throw new Error("Confirmação pela Meta exige a imagem do QR Code no cabeçalho.");
      }
      return {
        name: config.confirmed,
        language,
        components: [
          {
            type: "header",
            parameters: [{ type: "image", image: { id: options.headerMediaId } }],
          },
          {
            type: "body",
            parameters: [
              text(payload.name),
              text(payload.event_name),
              text(payload.event_starts_at ? formatWhen(payload.event_starts_at) : ""),
              text([payload.venue, payload.city].filter(Boolean).join(" · ")),
              text(payload.number),
            ],
          },
          // Botão "Ver ingresso": a URL base fica no modelo, o token entra aqui.
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: payload.token ?? "" }],
          },
        ],
      };
    }

    case "whatsapp.registration_cancelled":
      return {
        name: config.cancelled,
        language,
        components: [
          {
            type: "body",
            parameters: [text(payload.name), text(payload.event_name), text(payload.number)],
          },
        ],
      };

    // Modelo de autenticação: o código vai no corpo e de novo no botão "Copiar
    // código" — é assim que a Meta exige, mesmo sendo o mesmo valor.
    case "whatsapp.ticket_code":
      return {
        name: config.code,
        language,
        components: [
          { type: "body", parameters: [text(payload.code)] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: payload.code ?? "" }],
          },
        ],
      };

    default:
      throw new Error(`Template de WhatsApp desconhecido: ${type}`);
  }
}

export interface MetaTemplateGuideItem {
  key: "confirmed" | "cancelled" | "code";
  title: string;
  name: string;
  category: string;
  header: string | null;
  body: string;
  variables: string;
  button: string | null;
}

/**
 * O que cadastrar no Gerenciador do WhatsApp da Meta — exibido na tela para
 * copiar. Os textos espelham as mensagens da Evolution, com as variáveis no
 * lugar dos dados.
 */
export function metaTemplateGuide(
  config: MetaTemplateConfig,
  appUrl: string,
): MetaTemplateGuideItem[] {
  return [
    {
      key: "confirmed",
      title: "Confirmação com o ingresso",
      name: config.confirmed,
      category: "Utilidade",
      header: "Imagem (o QR Code do ingresso vai a cada mensagem)",
      body: [
        "Olá, {{1}}! Sua inscrição em *{{2}}* está confirmada. ✅",
        "",
        "📅 {{3}}",
        "📍 {{4}}",
        "🎟️ Inscrição {{5}}",
        "",
        "Apresente o QR Code acima na entrada — não precisa imprimir.",
      ].join("\n"),
      variables:
        "{{1}} nome · {{2}} evento · {{3}} data e hora · {{4}} local · {{5}} nº da inscrição",
      button: `Botão de URL “Ver ingresso”, tipo dinâmico: ${appUrl}/ingresso/{{1}}`,
    },
    {
      key: "cancelled",
      title: "Cancelamento",
      name: config.cancelled,
      category: "Utilidade",
      header: null,
      body: [
        "Olá, {{1}}. Sua inscrição em *{{2}}* foi cancelada (inscrição {{3}}).",
        "",
        "A vaga voltou para o público. Se foi engano, é só se inscrever de novo enquanto houver lugar.",
      ].join("\n"),
      variables: "{{1}} nome · {{2}} evento · {{3}} nº da inscrição",
      button: null,
    },
    {
      key: "code",
      title: "Código da segunda via",
      name: config.code,
      category: "Autenticação",
      header: null,
      body: "Texto fixo da Meta para autenticação: “{{1}} é seu código de verificação.”",
      variables: "{{1}} código de 6 dígitos",
      button: "Botão “Copiar código” · marque o aviso de validade de 10 minutos",
    },
  ];
}
