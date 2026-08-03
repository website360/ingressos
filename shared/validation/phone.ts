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
