-- =============================================================================
-- 20260801091800_checkin_operations
-- Módulo M3 — suporte de banco para o aplicativo de check-in.
--
-- Inclui uma CORREÇÃO DE SEGURANÇA: `public.checkin` era SECURITY DEFINER sem
-- verificar permissão. Qualquer usuário autenticado — inclusive um perfil de
-- Suporte, que não opera portaria — conseguia registrar entrada. SECURITY
-- DEFINER contorna a RLS por definição; a checagem tem que ser explícita.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. search_attendees — busca da portaria por CPF, nome, e-mail ou nº
--
-- RPC própria em vez de consulta direta à view: a Recepção precisa localizar a
-- pessoa, não ler a base de participantes. O CPF sai mascarado, e só quem tem
-- `attendee.read_sensitive` recebe o número completo.
-- -----------------------------------------------------------------------------
create or replace function public.search_attendees(p_event_id uuid, p_term text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
stable
as $$
declare
  v_term    text := btrim(coalesce(p_term, ''));
  v_digits  text := regexp_replace(v_term, '\D', '', 'g');
  v_full    boolean := private.has_perm('attendee.read_sensitive');
  v_result  jsonb;
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
        a.cpf like v_digits || '%'
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

-- -----------------------------------------------------------------------------
-- 2. checkin — agora exige a permissão do módulo
-- -----------------------------------------------------------------------------
create or replace function public.checkin(
  p_token   text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_code      text := split_part(p_token, '.', 1);
  v_sig       text := split_part(p_token, '.', 2);
  v_ticket    public.tickets%rowtype;
  v_reg       public.registrations%rowtype;
  v_attendee  public.attendees%rowtype;
  v_event     public.events%rowtype;
  v_previous  public.checkins%rowtype;
  v_result    public.checkin_result;
  v_within    boolean;
  v_distance  numeric;
  v_point     geography;
begin
  -- SECURITY DEFINER ignora a RLS: sem esta linha, qualquer autenticado
  -- registraria entrada.
  if not private.has_perm('checkin.execute') then
    raise exception 'Sem permissão para realizar check-in.' using errcode = 'IG005';
  end if;

  perform private.set_request_context(p_context);

  select * into v_ticket from public.tickets where code = v_code;

  if v_ticket.id is null or v_sig is distinct from private.sign_code(v_code) then
    return jsonb_build_object('result', 'invalido', 'message', 'Ingresso inválido.');
  end if;

  -- O ingresso precisa pertencer ao tenant de quem opera.
  if v_ticket.tenant_id is distinct from private.current_tenant() then
    return jsonb_build_object('result', 'invalido', 'message', 'Ingresso de outra organização.');
  end if;

  select * into v_event    from public.events        where id = v_ticket.event_id;
  select * into v_reg      from public.registrations where id = v_ticket.registration_id;
  select * into v_attendee from public.attendees     where id = v_reg.attendee_id;

  if (p_context ->> 'latitude') is not null then
    v_point := st_setsrid(
      st_makepoint((p_context ->> 'longitude')::float8, (p_context ->> 'latitude')::float8), 4326
    )::geography;

    if v_event.location is not null then
      v_distance := st_distance(v_event.location, v_point);
      v_within := v_distance <= v_event.allowed_radius_m;
    end if;
  end if;

  if v_ticket.status = 'cancelado' or v_reg.status = 'cancelada' then
    v_result := 'cancelado';
  else
    select * into v_previous
      from public.checkins
     where ticket_id = v_ticket.id and result = 'sucesso'
     limit 1;

    if v_previous.id is not null then
      v_result := 'duplicado';
    elsif v_within is false and not coalesce((p_context ->> 'override')::boolean, false) then
      v_result := 'fora_do_raio';
    else
      v_result := 'sucesso';
    end if;
  end if;

  -- Validar fora do raio exige permissão própria: é exceção auditada, não
  -- conveniência de operação.
  if v_result = 'sucesso'
     and coalesce((p_context ->> 'override')::boolean, false)
     and not private.has_perm('checkin.override') then
    raise exception 'Sem permissão para validar check-in fora do raio.' using errcode = 'IG005';
  end if;

  insert into public.checkins (
    tenant_id, event_id, ticket_id, registration_id, result, operator_id,
    device_id, user_agent, ip, location, accuracy_m, within_geofence, distance_m,
    override_confirmed, override_reason, offline_captured, idempotency_key, source,
    checked_in_at
  )
  values (
    v_ticket.tenant_id, v_ticket.event_id, v_ticket.id, v_ticket.registration_id, v_result, auth.uid(),
    p_context ->> 'device_id', p_context ->> 'user_agent', nullif(p_context ->> 'ip', '')::inet,
    v_point, nullif(p_context ->> 'accuracy_m', '')::numeric, v_within, v_distance,
    coalesce((p_context ->> 'override')::boolean, false), p_context ->> 'override_reason',
    coalesce((p_context ->> 'offline')::boolean, false),
    nullif(p_context ->> 'idempotency_key', ''),
    coalesce(p_context ->> 'source', 'scanner'),
    coalesce(nullif(p_context ->> 'checked_in_at', '')::timestamptz, now())
  )
  on conflict do nothing;

  if v_result = 'sucesso' then
    update public.tickets set status = 'utilizado' where id = v_ticket.id;
  end if;

  perform audit.log('checkin', 'ticket', v_ticket.id,
                    jsonb_build_object('result', v_result), v_ticket.tenant_id);

  return jsonb_build_object(
    'result', v_result,
    'ticket_code', v_ticket.code,
    'event', jsonb_build_object('id', v_event.id, 'name', v_event.name),
    'attendee', jsonb_build_object(
      'name', v_attendee.first_name || ' ' || v_attendee.last_name,
      'cpf_masked', '***.' || substr(v_attendee.cpf, 4, 3) || '.' || substr(v_attendee.cpf, 7, 3) || '-**',
      'photo_url', v_attendee.photo_url
    ),
    'registration_number', v_reg.number,
    'within_geofence', v_within,
    'distance_m', v_distance,
    'first_checkin', case when v_result = 'duplicado' then jsonb_build_object(
      'at', v_previous.checked_in_at,
      'operator', (select full_name from public.profiles where id = v_previous.operator_id)
    ) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. checkin_batch — sincronização da fila offline
--
-- Idempotente por `idempotency_key`: reenviar o mesmo lote não duplica nada.
-- Conflito entre dois dispositivos resolve por timestamp — o primeiro vence, o
-- segundo vira 'duplicado' e aparece no painel de alertas.
-- -----------------------------------------------------------------------------
create or replace function public.checkin_batch(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item     jsonb;
  v_results  jsonb := '[]'::jsonb;
  v_one      jsonb;
  v_existing uuid;
begin
  if not private.has_perm('checkin.execute') then
    raise exception 'Sem permissão para realizar check-in.' using errcode = 'IG005';
  end if;

  -- Ordenar pelo horário do dispositivo é o que faz "primeiro vence" ser
  -- verdade, mesmo que os lotes cheguem fora de ordem.
  for v_item in
    select value
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as value
     order by (value ->> 'checked_in_at')::timestamptz
  loop
    select id into v_existing
      from public.checkins
     where tenant_id = private.current_tenant()
       and idempotency_key = (v_item ->> 'idempotency_key');

    if v_existing is not null then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'idempotency_key', v_item ->> 'idempotency_key',
        'result', 'ja_sincronizado'
      ));
      continue;
    end if;

    v_one := public.checkin(
      v_item ->> 'token',
      (v_item - 'token') || jsonb_build_object('offline', true, 'source', 'offline')
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'idempotency_key', v_item ->> 'idempotency_key',
      'result', v_one ->> 'result',
      'attendee', v_one -> 'attendee'
    ));
  end loop;

  return v_results;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. checkin_manifest — pacote para operar offline
--
-- Baixado explicitamente antes do evento. Traz o hash do código, nunca o
-- código em claro: o aparelho consegue VERIFICAR um ingresso apresentado, mas
-- não FABRICAR um. Se o celular for perdido, ninguém emite entrada com ele.
-- -----------------------------------------------------------------------------
create or replace function public.checkin_manifest(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
stable
as $$
declare
  v_event public.events%rowtype;
begin
  if not private.has_perm('checkin.execute') then
    raise exception 'Sem permissão para preparar o modo offline.' using errcode = 'IG005';
  end if;

  select * into v_event
    from public.events
   where id = p_event_id and tenant_id = private.current_tenant();

  if v_event.id is null then
    raise exception 'Evento não encontrado.' using errcode = 'IG003';
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'venue_name', v_event.venue_name,
      'allowed_radius_m', v_event.allowed_radius_m,
      'latitude', st_y(v_event.location::geometry),
      'longitude', st_x(v_event.location::geometry)
    ),
    'generated_at', now(),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'h', encode(digest(t.code, 'sha256'), 'hex'),
        'n', a.first_name || ' ' || a.last_name,
        'c', '***.' || substr(a.cpf, 4, 3) || '.' || substr(a.cpf, 7, 3) || '-**',
        'r', r.number,
        's', t.status,
        'u', (c.id is not null)
      ))
      from public.tickets t
      join public.registrations r on r.id = t.registration_id
      join public.attendees a on a.id = r.attendee_id
      left join public.checkins c on c.ticket_id = t.id and c.result = 'sucesso'
      where t.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.search_attendees(uuid, text)  to authenticated;
grant execute on function public.checkin_batch(jsonb)          to authenticated;
grant execute on function public.checkin_manifest(uuid)        to authenticated;

comment on function public.checkin(text, jsonb) is
  'Check-in transacional. Exige checkin.execute; validar fora do raio exige checkin.override.';
