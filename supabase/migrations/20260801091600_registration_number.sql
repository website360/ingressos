-- =============================================================================
-- 20260801091600_registration_number
--
-- Correção: a numeração usava `count(*) + 1` POR EVENTO, mas a unicidade é
-- POR EMPRESA — dois eventos geravam `EVT-2026-000001` e colidiam.
--
-- Além disso, `count(*)` a cada inscrição vira table scan: com 100 mil
-- inscrições, cada nova inscrição pagaria por todas as anteriores.
--
-- Uma sequence resolve os dois: unicidade garantida e custo constante.
-- Lacunas na numeração (por transações abortadas) são aceitáveis — o número é
-- identificador legível, não contagem contábil.
-- =============================================================================

create sequence if not exists public.registration_number_seq;

-- Continua de onde a numeração antiga parou.
select setval(
  'public.registration_number_seq',
  greatest((select count(*) from public.registrations), 1),
  true
);

create or replace function private.generate_registration_number()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.number is not null and new.number <> '' then
    return new;
  end if;

  new.number := 'EVT-' || to_char(now(), 'YYYY') || '-' ||
                lpad(nextval('public.registration_number_seq')::text, 6, '0');
  return new;
end;
$$;

grant usage, select on sequence public.registration_number_seq to authenticated;

comment on sequence public.registration_number_seq is
  'Numeração legível das inscrições. Única por empresa; lacunas são esperadas.';
