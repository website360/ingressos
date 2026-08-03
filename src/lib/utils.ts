import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Helper universal do Design System: merge de classes Tailwind sem conflito. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Marcas diacríticas combinantes (U+0300–U+036F), escapadas para não depender
// da codificação do arquivo.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Remove acentos — usado em buscas e geração de slug. */
export function deaccent(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

export function slugify(value: string): string {
  return deaccent(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Type guard útil para filtrar nulos preservando o tipo. */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
