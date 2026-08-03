/**
 * Validação de CPF (dígitos verificadores).
 * Vive em shared/ porque é usada no formulário, na Server Action e na Edge Function (ADR-010).
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return false;
  // Rejeita sequências repetidas (000.000.000-00, 111.111.111-11, ...)
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number) as number[];

  for (const [length, position] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += (digits[i] ?? 0) * (position - i);
    }
    const remainder = (sum * 10) % 11;
    const check = remainder === 10 || remainder === 11 ? 0 : remainder;
    if (check !== digits[length]) return false;
  }

  return true;
}

export function formatCpf(input: string): string {
  const cpf = onlyDigits(input).slice(0, 11);
  return cpf
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** Mascaramento para exibição (LGPD): 123.456.789-01 → ***.456.789-** */
export function maskCpf(input: string): string {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return "***.***.***-**";
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
