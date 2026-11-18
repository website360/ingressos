/**
 * Casos compartilhados com o teste de integração, que confere a função SQL
 * `private.to_e164_br` contra a mesma tabela: as duas precisam concordar.
 */
export const E164_CASES: [string, string | null][] = [
  ["(11) 98765-4321", "+5511987654321"],
  ["11987654321", "+5511987654321"],
  ["5511987654321", "+5511987654321"],
  ["+55 11 98765-4321", "+5511987654321"],
  ["+55 (11) 98765-4321", "+5511987654321"],
  ["551187654321", "+551187654321"], // DDI + fixo de SP
  ["1187654321", "+551187654321"], // fixo de SP
  ["5587654321", "+555587654321"], // fixo do DDD 55 (Santa Maria), sem DDI
  ["55987654321", "+5555987654321"], // celular do DDD 55, sem DDI
  ["", null],
  ["123", null],
  ["11887654321", null], // 11 dígitos sem o 9
  ["(10) 98765-4321", null], // DDD inexistente
  ["0011987654321", null],
  ["abc", null],
];
