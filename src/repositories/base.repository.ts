import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

export type Client = SupabaseClient<Database>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Camada única de acesso a dados (ADR-009).
 * Nenhum componente chama `supabase.from(...)` diretamente.
 */
export abstract class BaseRepository {
  protected constructor(protected readonly client: Client) {}

  /** Traduz o erro do Postgres para o domínio antes de propagar. */
  protected unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
    if (result.error) throw mapPostgrestError(result.error);
    if (result.data === null) {
      throw mapPostgrestError({
        code: "PGRST116",
        message: "No rows returned",
        details: "",
        hint: "",
        name: "PostgrestError",
      } as PostgrestError);
    }
    return result.data;
  }

  protected unwrapMaybe<T>(result: { data: T | null; error: PostgrestError | null }): T | null {
    if (result.error) throw mapPostgrestError(result.error);
    return result.data;
  }

  /**
   * Paginação por cursor (keyset). OFFSET degrada linearmente e é proibido nas
   * listas grandes do projeto (docs/02, seção 13).
   *
   * O cursor codifica o valor da coluna de ordenação da última linha lida.
   */
  protected buildPage<T>(rows: T[], limit: number, cursorField: keyof T): CursorPage<T> {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(String(last[cursorField])) : null;
    return { items, nextCursor, hasMore };
  }
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
