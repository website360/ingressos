-- =============================================================================
-- 20260801092800_registration_details
--
-- A tela de cancelamentos deixa de existir: motivo, autor, data e IP passam a
-- ser exibidos na própria linha do participante. Uma tela a menos, nenhuma
-- informação perdida.
--
-- A view também passa a expor o contexto do check-in. Entrada validada FORA do
-- raio permitido é exceção auditada — precisa estar visível na listagem, não
-- escondida numa tela separada de alertas.
--
-- LEFT JOIN em tudo: a view usa `security_invoker`, então quem não tem
-- permissão sobre `profiles` (a Recepção, por exemplo) simplesmente recebe nulo
-- no nome do operador, em vez de perder a linha inteira.
-- =============================================================================

drop view if exists public.v_registration_full;

create view public.v_registration_full with (security_invoker = true) as
select
  r.id              as registration_id,
  r.tenant_id,
  r.event_id,
  r.number,
  r.status,
  r.source,
  r.referral,
  r.created_at,
  r.cancelled_at,

  a.id              as attendee_id,
  a.first_name,
  a.last_name,
  a.first_name || ' ' || a.last_name as full_name,
  a.cpf,
  a.email,
  a.phone,
  a.city,
  a.state,
  a.company,
  a.job_title,
  a.birth_date,

  e.name            as event_name,
  e.starts_at       as event_starts_at,

  t.code            as ticket_code,
  t.status          as ticket_status,

  -- Check-in
  c.checked_in_at,
  (c.id is not null)                as checked_in,
  c.within_geofence                 as checkin_within_geofence,
  c.distance_m                      as checkin_distance_m,
  c.override_confirmed              as checkin_forced,
  c.override_reason                 as checkin_force_reason,
  c.source                          as checkin_source,
  c.offline_captured                as checkin_offline,
  op.full_name                      as checkin_operator,

  -- Cancelamento
  cx.reason_code                    as cancel_reason_code,
  cx.reason_text                    as cancel_reason_text,
  cx.cancelled_by_type              as cancel_by_type,
  cx.ip::text                       as cancel_ip,
  cb.full_name                      as cancel_by_name
from public.registrations r
join public.attendees a on a.id = r.attendee_id
join public.events e    on e.id = r.event_id
left join public.tickets t  on t.registration_id = r.id
left join public.checkins c on c.ticket_id = t.id and c.result = 'sucesso'
left join public.profiles op on op.id = c.operator_id
left join public.cancellations cx on cx.registration_id = r.id
left join public.profiles cb on cb.id = cx.cancelled_by_user;
