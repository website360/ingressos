/**
 * Mensagem de modelo (template) da Cloud API, montada a partir da linha de
 * `whatsapp_templates`.
 *
 * O texto aprovado mora na Meta; aqui se preenchem as variáveis na ordem de
 * `param_order`, que é contrato com o texto aprovado. Montar a partir da linha
 * (e não de um `switch` por tipo) é o que deixa versionar o modelo sem mexer
 * em código: a v2 com data e horário separados é só outra linha.
 *
 * Função pura: o worker e o teste importam daqui.
 */

export const TEMPLATE_KEYS = [
  "name",
  "event_name",
  "date",
  "time",
  "datetime",
  "place",
  "number",
  "code",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type TemplateValues = Record<TemplateKey, string> & { token: string };

export interface TemplateRow {
  name: string;
  language: string;
  header_type: string;
  param_order: string[];
  button_param: string | null;
}

export interface MetaTemplateMessage {
  name: string;
  language: { code: string };
  components: Record<string, unknown>[];
}

/** A Meta recusa parâmetro vazio (131008); travessão mantém a frase legível. */
const text = (value: string | null | undefined) => ({
  type: "text",
  text: value && value.trim() !== "" ? value.trim() : "—",
});

export function templateValues(input: {
  name: string | null;
  eventName: string | null;
  startsAt: string | null;
  timezone: string | null;
  venue: string | null;
  city: string | null;
  number: string | null;
  token: string | null;
  code: string | null;
}): TemplateValues {
  const timeZone = input.timezone || "America/Sao_Paulo";
  const when = input.startsAt ? new Date(input.startsAt) : null;
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    when ? new Intl.DateTimeFormat("pt-BR", { ...options, timeZone }).format(when) : "";

  return {
    name: input.name ?? "",
    event_name: input.eventName ?? "",
    date: fmt({ day: "2-digit", month: "2-digit", year: "numeric" }),
    time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }),
    datetime: fmt({ dateStyle: "full", timeStyle: "short" }),
    place: [input.venue, input.city].filter((v) => v && v.trim()).join(" · "),
    number: input.number ?? "",
    code: input.code ?? "",
    token: input.token ?? "",
  };
}

export function buildTemplateMessage(
  template: TemplateRow,
  values: TemplateValues,
  options: { headerImageUrl?: string },
): MetaTemplateMessage {
  const components: Record<string, unknown>[] = [];

  if (template.header_type === "image") {
    if (!options.headerImageUrl) {
      throw new Error("Modelo com imagem no cabeçalho exige a URL do QR Code do ingresso.");
    }
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: options.headerImageUrl } }],
    });
  }

  if (template.param_order.length > 0) {
    components.push({
      type: "body",
      parameters: template.param_order.map((key) => {
        if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) {
          throw new Error(`Parâmetro de modelo desconhecido: ${key}`);
        }
        return text(values[key as TemplateKey]);
      }),
    });
  }

  if (template.button_param) {
    const value = template.button_param === "code" ? values.code : values.token;
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: value }],
    });
  }

  return { name: template.name, language: { code: template.language }, components };
}
