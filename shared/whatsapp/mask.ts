/**
 * Telefone para log: o suficiente para alguém reconhecer o caso, nunca o
 * número inteiro. `+5511987654321` → `+55 11 9****-4321`.
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "(sem número)";
  const digits = e164.replace(/\D/g, "");
  if (!digits.startsWith("55") || (digits.length !== 12 && digits.length !== 13)) return "****";
  const ddd = digits.slice(2, 4);
  const last = digits.slice(-4);
  const mobile = digits.length === 13 ? digits[4] : "";
  return `+55 ${ddd} ${mobile}****-${last}`;
}
