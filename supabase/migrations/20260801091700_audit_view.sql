-- =============================================================================
-- 20260801091700_audit_view
--
-- A tela de auditoria lia `audit.audit_logs` diretamente, o que exigiria expor
-- o schema `audit` na Data API — ou seja, outro clique de painel que migration
-- nenhuma captura. Mesmo problema do ADR-014, mesma solução: uma view em
-- `public`.
--
-- `security_invoker = true` mantém a RLS: a view não é um atalho para ler a
-- trilha, apenas o caminho exposto. Quem não tem `audit.read` continua sem ver
-- nada, e a tabela segue append-only.
-- =============================================================================

create view public.v_audit_logs with (security_invoker = true) as
select
  l.id,
  l.tenant_id,
  l.action::text as action,
  l.entity_type,
  l.entity_id,
  l.actor_id,
  l.actor_email,
  l.actor_role,
  l.changes,
  l.ip::text as ip,
  l.user_agent,
  l.device_id,
  l.request_id,
  l.created_at
from audit.audit_logs l;

comment on view public.v_audit_logs is
  'Superfície exposta da trilha de auditoria. Somente leitura, RLS herdada da tabela base.';

grant select on public.v_audit_logs to authenticated;
