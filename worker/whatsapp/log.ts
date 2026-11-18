/**
 * Log estruturado (uma linha JSON por evento) — o PM2 junta no arquivo.
 *
 * Nunca recebe token, e telefone só mascarado. `sanitize` é a rede de
 * segurança para texto que vem de fora (mensagens de erro da Meta às vezes
 * repetem o número): qualquer sequência longa de dígitos vira asteriscos.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void;

export function sanitize(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{8,}\d/g, "[número]").slice(0, 500);
}

export const jsonLogger: Logger = (level, msg, fields = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};
