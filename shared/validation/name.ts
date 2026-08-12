/**
 * Nome completo em campo único.
 *
 * O formulário coleta uma linha só ("Nome completo"), mas o banco continua com
 * `first_name` / `last_name` — as views de check-in, a busca por nome e os
 * e-mails já dependem dessas colunas. A divisão acontece aqui, na borda, e não
 * espalhada por quem escreve no banco.
 */

/** Colapsa espaços repetidos e remove os das pontas. */
export function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Ao menos duas palavras — o mesmo mínimo que os dois campos antigos exigiam. */
export function hasSurname(value: string): boolean {
  return normalizeFullName(value).split(" ").length >= 2;
}

/**
 * "Ana Maria da Silva" → { first_name: "Ana", last_name: "Maria da Silva" }.
 *
 * A primeira palavra é o nome de tratamento usado nos e-mails ("Olá, Ana");
 * todo o resto é sobrenome, sem tentar adivinhar nomes compostos.
 */
export function splitFullName(value: string): { first_name: string; last_name: string } {
  const parts = normalizeFullName(value).split(" ");
  return {
    first_name: parts[0] ?? "",
    last_name: parts.slice(1).join(" "),
  };
}
