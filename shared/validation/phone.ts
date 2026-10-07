import { onlyDigits } from "./cpf";

/** Telefone brasileiro: 10 dígitos (fixo) ou 11 dígitos (celular, começando com 9). */
export function isValidBrPhone(input: string): boolean {
  const phone = onlyDigits(input);
  if (phone.length !== 10 && phone.length !== 11) return false;

  const ddd = Number(phone.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;

  if (phone.length === 11 && phone[2] !== "9") return false;
  return true;
}

export function formatBrPhone(input: string): string {
  const phone = onlyDigits(input).slice(0, 11);
  if (phone.length <= 10) {
    return phone.replace(/(\d{2})(\d{1,4})(\d{0,4})/, (_, a, b, c) =>
      c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`,
    );
  }
  return phone.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) =>
    c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`,
  );
}

export const BR_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type BrState = (typeof BR_STATES)[number];

export function isValidBrState(value: string): value is BrState {
  return (BR_STATES as readonly string[]).includes(value.toUpperCase());
}

/**
 * Número no formato que a Evolution espera: DDI + DDD + número, só dígitos.
 *
 * O formulário público guarda o telefone sem DDI (é sempre Brasil), mas o
 * WhatsApp endereça por número internacional. Retorna `null` no telefone que
 * não passa na validação — quem chama decide se isso é erro ou se é só pular.
 *
 * O `55` inicial é ambíguo: é DDI do Brasil e também DDD de Santa Maria/RS.
 * Só tiramos o prefixo quando sobra um telefone brasileiro válido sem ele —
 * `5511987654321` (13 dígitos) é DDI + celular de SP, enquanto `5511987654`
 * (10 dígitos) é um fixo do DDD 55.
 */
export function toWhatsAppNumber(input: string): string | null {
  const digits = onlyDigits(input);
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return isValidBrPhone(local) ? `55${local}` : null;
}

/**
 * Formata o número como ele é GUARDADO nas tabelas de WhatsApp: com DDI.
 *
 * `formatBrPhone` espera número nacional — dar a ela `5511963059112` faz o
 * corte em 11 dígitos virar `(55) 11963-0591`, que não é telefone nenhum.
 * Existe porque a alternativa era cada tela tirar o `55` por conta própria, e
 * bastou uma esquecer para o número aparecer errado no painel.
 *
 * Só tira o prefixo quando o tamanho fecha com DDI + nacional (12 ou 13
 * dígitos) — assim um fixo do DDD 55 guardado sem DDI continua intacto.
 */
export function formatWhatsAppNumber(stored: string): string {
  const digits = onlyDigits(stored);
  const local =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
  return formatBrPhone(local);
}
