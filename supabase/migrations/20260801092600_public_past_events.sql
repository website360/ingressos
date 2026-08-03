-- =============================================================================
-- 20260801092600_public_past_events
--
-- A raiz do site passa a listar também os eventos já realizados. A política
-- pública só permitia `publicado`, então o histórico voltava vazio — e a página
-- de um evento passado, cujo link continua circulando, dava 404.
--
-- `encerrado` entra na leitura anônima. `rascunho`, `privado` e `cancelado`
-- continuam fora: o primeiro não está pronto, o segundo é por definição
-- restrito, e o terceiro não deve ser divulgado como se fosse acontecer.
--
-- Inscrição segue bloqueada para evento encerrado — quem controla isso é a RPC
-- `create_registration`, que exige `status = 'publicado'`. Ler não é inscrever.
-- =============================================================================

drop policy if exists events_public_select on public.events;

create policy events_public_select on public.events
  for select to anon
  using (status in ('publicado', 'encerrado') and deleted_at is null);
