/**
 * O que fazer com uma falha de envio à Meta.
 *
 * A pergunta que importa não é "deu erro?", e sim "posso tentar de novo sem
 * risco de a pessoa receber duas vezes?". Por isso a FASE conta: falha antes
 * de a requisição sair (DNS, conexão recusada) é segura para repetir; timeout
 * ou conexão perdida depois de enviada é INCERTA — a Meta pode ter aceitado.
 *
 * Códigos: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export type FailureClass =
  | "retry_safe" // repetir com backoff, gastando tentativa
  | "throttle" // a Meta pediu calma: repetir sem gastar tentativa e frear a vazão
  | "permanent_recipient" // o destinatário não recebe (número, bloqueio): não repetir
  | "permanent_message" // a mensagem/modelo está errada: não repetir até corrigir
  | "systemic" // token, permissão, conta, modelo inexistente: parar tudo
  | "uncertain"; // pode ter saído: não repetir sozinho

export interface MetaFailure {
  phase: "before_send" | "after_send";
  status?: number;
  code?: number;
  timeout?: boolean;
}

const THROTTLE = new Set([4, 80007, 130429, 131056]);
export const PERMANENT_RECIPIENT = new Set([131021, 131026, 131049, 131050]);
const PERMANENT_MESSAGE = new Set([100, 131008, 131051, 132000, 132005, 132007, 132012]);
const SYSTEMIC = new Set([10, 190, 200, 368, 131031, 131042, 132001, 132015, 132016, 133010]);

export function classifyMetaFailure(f: MetaFailure): FailureClass {
  if (f.phase === "before_send") return "retry_safe";
  if (f.timeout || f.status === undefined) return "uncertain";

  if (f.code !== undefined) {
    if (THROTTLE.has(f.code)) return "throttle";
    if (PERMANENT_RECIPIENT.has(f.code)) return "permanent_recipient";
    if (SYSTEMIC.has(f.code)) return "systemic";
    if (PERMANENT_MESSAGE.has(f.code)) return "permanent_message";
  }

  if (f.status === 429) return "throttle";
  if (f.status >= 500) return "retry_safe";
  return "permanent_message";
}
