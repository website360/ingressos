import { toWhatsAppNumber } from "../validation/phone";

/**
 * Telefone brasileiro em E.164 (`+5511987654321`), ou `null` se não for um
 * número válido. Mesmas regras de `toWhatsAppNumber` — inclusive a ambiguidade
 * do `55` (DDI × DDD de Santa Maria) — com o `+` que o padrão exige.
 *
 * O banco tem a gêmea `private.to_e164_br`, usada pelo gatilho da inscrição; o
 * teste de integração confere as duas contra a mesma tabela de casos.
 */
export function toE164Br(input: string | null | undefined): string | null {
  const number = toWhatsAppNumber(input ?? "");
  return number ? `+${number}` : null;
}
