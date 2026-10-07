-- =============================================================================
-- 20260801093800_segunda_via_service_role
-- Fecha as RPCs da segunda via ao acesso direto pelo PostgREST.
--
-- A migration anterior (20260801093600) abriu as duas funções ao papel anônimo,
-- porque quem perdeu o link do ingresso não tem login. O raciocínio estava
-- certo quanto ao usuário e errado quanto ao caminho: a action roda no
-- servidor, e era ela — não o navegador — que precisava do acesso.
--
-- O preço do engano: `request_ticket_code` recebe o IP em `p_context`, e esse
-- IP é o que limita a varredura de CPF. Com a função aberta ao papel anônimo,
-- qualquer um chama o endpoint direto com a chave `anon` — que o Next embute no
-- bundle do navegador por construção, e portanto é pública — e omite o
-- `p_context`. O `v_ip` fica nulo, o `if v_ip is not null` pula a checagem
-- inteira, e o limite por IP deixa de existir.
--
-- O limite por CPF (3 a cada 15 minutos) seguia valendo, porque o `cpf_hash`
-- nasce dentro da função. Mas era o limite por IP que impedia varrer MUITOS
-- CPFs, e cada CPF encontrado dispara e-mail e WhatsApp reais para a pessoa —
-- saindo da conta de e-mail e do número de WhatsApp da organização.
--
-- A correção é de caminho, não de regra: só o service_role chama, e só o
-- servidor tem essa chave. O IP volta a ser confiável porque passa a vir de
-- `getRequestContext()`, que o lê do `x-forwarded-for` propagado pelo Nginx
-- (docs/08, seção 2) — e não mais de um parâmetro que o chamador escolhe.
--
-- `revoke from public` não é redundante: o Postgres concede EXECUTE a PUBLIC
-- por padrão ao criar a função, e `anon` herda daí. Revogar só de `anon` e
-- `authenticated` deixaria a porta aberta. Mesmo padrão do facade da fila
-- (20260801092000).
-- =============================================================================

revoke execute on function public.request_ticket_code(text, jsonb) from public, anon, authenticated;
revoke execute on function public.verify_ticket_code(text, text)   from public, anon, authenticated;

grant execute on function public.request_ticket_code(text, jsonb) to service_role;
grant execute on function public.verify_ticket_code(text, text)   to service_role;
