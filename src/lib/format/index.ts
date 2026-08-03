import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export { formatCpf, maskCpf, onlyDigits } from "@shared/validation/cpf";
export { formatBrPhone } from "@shared/validation/phone";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function formatDate(
  value: string | Date | null | undefined,
  pattern = "dd/MM/yyyy",
): string {
  const date = toDate(value);
  return date ? format(date, pattern, { locale: ptBR }) : "—";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, "dd/MM/yyyy 'às' HH:mm");
}

export function formatTime(value: string | Date | null | undefined): string {
  return formatDate(value, "HH:mm");
}

export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? formatDistanceToNow(date, { locale: ptBR, addSuffix: true }) : "—";
}

/** Data/hora no fuso do evento — a UI nunca assume o fuso do navegador. */
export function formatInTimezone(
  value: string | Date | null | undefined,
  timezone = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: timezone }).format(date);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

export function formatDistanceMeters(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)} ${units[index]}`;
}

/** Mascaramento de e-mail para telas com dado sensível (LGPD). */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "—";
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
