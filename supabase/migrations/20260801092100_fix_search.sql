-- =============================================================================
-- 20260801092100_fix_search
--
-- Correção: `search_attendees` filtrava por CPF com `a.cpf like v_digits || '%'`.
-- Quando o termo buscado não tem dígitos — "Maria", por exemplo — `v_digits`
-- fica vazio e a condição vira `cpf like '%'`, que casa com TODAS as linhas.
-- Resultado: buscar um nome devolvia participantes aleatórios do evento.
--
-- Na portaria isso é grave: o operador confirma a entrada da pessoa errada.
-- =============================================================================

create or replace function public.search_attendees(p_event_id uuid, p_term text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
stable
as $$
declare
  v_term   text := btrim(coalesce(p_term, ''));
  v_digits text := regexp_replace(v_term, '\D', '', 'g');
  v_full   boolean := private.has_perm('attendee.read_sensitive');
  v_result jsonb;
begin
  if not private.has_perm('registration.read') then
    raise exception 'Sem permissão para consultar participantes.' using errcode = 'IG005';
  end if;

  if length(v_term) < 3 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_result
  from (
    select
      r.id            as registration_id,
      r.number,
      r.status,
      a.first_name || ' ' || a.last_name as full_name,
      case when v_full then a.cpf
           else '***.' || substr(a.cpf, 4, 3) || '.' || substr(a.cpf, 7, 3) || '-**'
      end             as cpf,
      a.email,
      a.photo_url,
      t.code          as ticket_code,
      t.signature     as ticket_signature,
      t.status        as ticket_status,
      (c.id is not null) as checked_in,
      c.checked_in_at
    from public.registrations r
    join public.attendees a on a.id = r.attendee_id
    left join public.tickets t on t.registration_id = r.id
    left join public.checkins c on c.ticket_id = t.id and c.result = 'sucesso'
    where r.event_id = p_event_id
      and r.tenant_id = private.current_tenant()
      and (
        -- CPF só entra na busca com 3+ dígitos: sem esta guarda, um termo
        -- sem números vira `like '%'` e casa com a base inteira.
        (length(v_digits) >= 3 and a.cpf like v_digits || '%')
        or r.number ilike '%' || v_term || '%'
        or a.email ilike '%' || v_term || '%'
        or private.unaccent_immutable(lower(a.first_name || ' ' || a.last_name))
             like '%' || private.unaccent_immutable(lower(v_term)) || '%'
      )
    order by a.first_name
    limit 25
  ) x;

  return v_result;
end;
$$;

grant execute on function public.search_attendees(uuid, text) to authenticated;
