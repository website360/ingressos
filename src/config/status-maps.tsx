import type { BadgeProps } from "@/components/ui/badge";
import type {
  CheckinResult,
  EmailStatus,
  EventStatus,
  RegistrationStatus,
  SupportPriority,
  SupportStatus,
  TicketStatus,
} from "@/lib/supabase/database.types";

/**
 * Rótulo, cor e ordem de cada status — num único lugar.
 * Regra anti-duplicação 4 (docs/04): nenhum componente decide cor de status.
 */
type Variant = NonNullable<BadgeProps["variant"]>;
export interface StatusMeta {
  label: string;
  variant: Variant;
}

export const EVENT_STATUS: Record<EventStatus, StatusMeta> = {
  rascunho: { label: "Rascunho", variant: "muted" },
  publicado: { label: "Publicado", variant: "success" },
  privado: { label: "Privado", variant: "secondary" },
  encerrado: { label: "Encerrado", variant: "outline" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

export const REGISTRATION_STATUS: Record<RegistrationStatus, StatusMeta> = {
  pendente: { label: "Pendente", variant: "warning" },
  confirmada: { label: "Confirmada", variant: "success" },
  cancelada: { label: "Cancelada", variant: "destructive" },
  lista_espera: { label: "Lista de espera", variant: "secondary" },
  no_show: { label: "Não compareceu", variant: "muted" },
};

export const TICKET_STATUS: Record<TicketStatus, StatusMeta> = {
  valido: { label: "Válido", variant: "success" },
  utilizado: { label: "Utilizado", variant: "default" },
  cancelado: { label: "Cancelado", variant: "destructive" },
  expirado: { label: "Expirado", variant: "muted" },
  reemitido: { label: "Reemitido", variant: "warning" },
};

export const CHECKIN_RESULT: Record<CheckinResult, StatusMeta> = {
  sucesso: { label: "Confirmado", variant: "success" },
  duplicado: { label: "Duplicado", variant: "warning" },
  invalido: { label: "Inválido", variant: "destructive" },
  cancelado: { label: "Cancelado", variant: "destructive" },
  fora_do_raio: { label: "Fora do raio", variant: "warning" },
};

export const SUPPORT_STATUS: Record<SupportStatus, StatusMeta> = {
  aberto: { label: "Aberto", variant: "default" },
  em_andamento: { label: "Em andamento", variant: "warning" },
  aguardando: { label: "Aguardando", variant: "secondary" },
  resolvido: { label: "Resolvido", variant: "success" },
  fechado: { label: "Fechado", variant: "muted" },
};

export const SUPPORT_PRIORITY: Record<SupportPriority, StatusMeta> = {
  baixa: { label: "Baixa", variant: "muted" },
  media: { label: "Média", variant: "secondary" },
  alta: { label: "Alta", variant: "warning" },
  critica: { label: "Crítica", variant: "destructive" },
};

export const EMAIL_STATUS: Record<EmailStatus, StatusMeta> = {
  fila: { label: "Na fila", variant: "secondary" },
  enviado: { label: "Enviado", variant: "default" },
  entregue: { label: "Entregue", variant: "success" },
  aberto: { label: "Aberto", variant: "success" },
  falhou: { label: "Falhou", variant: "destructive" },
  bounce: { label: "Bounce", variant: "destructive" },
};

const FALLBACK: StatusMeta = { label: "—", variant: "muted" };

export function statusMeta<T extends string>(
  map: Record<string, StatusMeta>,
  value: T | null | undefined,
): StatusMeta {
  if (!value) return FALLBACK;
  return map[value] ?? { label: value, variant: "muted" };
}
