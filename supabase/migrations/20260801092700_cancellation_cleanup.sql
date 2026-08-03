-- =============================================================================
-- 20260801092700_cancellation_cleanup
--
-- `cancellations.replaced_by_registration_id` registrava quem assumia a vaga
-- pela convocação da lista de espera. Sem fila, nada preenche essa coluna.
--
-- Ela também quebrava a tela de cancelamentos: com DUAS chaves estrangeiras
-- para `registrations`, o PostgREST não conseguia decidir qual usar no embed e
-- respondia PGRST201 ("more than one relationship was found").
-- =============================================================================

alter table public.cancellations drop column if exists replaced_by_registration_id;

comment on column public.cancellations.seat_released is
  'Sempre verdadeiro hoje: cancelar libera a vaga imediatamente para o público.';
