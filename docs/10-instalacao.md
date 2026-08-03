# 10 — Instalação e execução

Dois caminhos possíveis. O projeto suporta os dois, com conjuntos de comandos separados:

| Caminho            | Comandos          | Quando usar                                       |
| ------------------ | ----------------- | ------------------------------------------------- |
| **Nuvem** (atual)  | `npm run db:*`    | Sem Docker na máquina. Ver seção 0.               |
| **Local** (Docker) | `npm run local:*` | Iteração rápida e `reset` sem risco. Ver seção 1. |

---

## 0. Caminho nuvem — passo a passo

### 0.1 Criar o projeto (navegador)

1. https://supabase.com → **Start your project** → entrar com GitHub ou e-mail.
2. **New project**:
   - **Name:** `ingressos-dev`
   - **Database Password:** gere uma senha forte e **guarde** — ela vai no `DATABASE_URL`
   - **Region:** `South America (São Paulo)` — menor latência
   - **Plan:** Free
3. Aguarde ~2 minutos até o projeto ficar verde.

### 0.2 Preencher o `.env.local`

Quatro valores, todos no painel do projeto:

| Variável                        | Onde encontrar                                                           |
| ------------------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project Settings → API → **Project URL**                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → **anon / public**                               |
| `SUPABASE_SERVICE_ROLE_KEY`     | Project Settings → API → **service_role (secret)**                       |
| `DATABASE_URL`                  | Project Settings → Database → Connection string → aba **Session pooler** |

No `DATABASE_URL`, troque `[YOUR-PASSWORD]` pela senha do passo 0.1.

> Use o **Session pooler**, não o _Direct connection_: o direto só atende IPv6 e falha na
> maioria das redes domésticas.

### 0.3 Aplicar schema, tipos e dados

```bash
npm run setup
```

Equivale a `db:push` (migrations) → `db:types` (tipos do schema real) → `db:seed`
(empresas e usuários de demonstração via Admin API).

### 0.4 Conferir

```bash
npm run doctor
```

O comando valida o ambiente de fora para dentro: autentica de verdade, decodifica o JWT, chama a
RPC de contexto e confere os dados. Quando algo falha, ele diz o quê e onde corrigir.

**Nenhuma configuração de painel é necessária.** As migrations entregam o sistema pronto — ver
ADR-014 e a migration `20260801091100_zero_config`.

### 0.5 Opcional — Custom Access Token Hook

Puramente performance: com o hook ativo, empresa, papel e permissões viajam no JWT e a RLS não
consulta o banco. Sem ele, os helpers fazem um lookup indexado por query (avaliado uma vez, não por
linha).

**Authentication → Hooks → Customize Access Token (JWT) Claims** → _Enable_ →
`private` / `custom_access_token_hook` → **Save**.

Contrapartida: com o hook ligado, revogar uma permissão só passa a valer no próximo refresh do
token (até 1h). Desligado, vale na hora. Em desenvolvimento, deixe desligado.

### 0.6 Fechar o cadastro público (recomendado)

**Authentication → Sign In / Providers → Email** → desmarcar **Allow new users to sign up**.
No projeto, conta se cria por convite (RF-02.2).

### 0.7 Rodar

```bash
npm run dev
```

Login: **admin@agenciamay.com.br** / **Ingressos@2026**.

### 0.8 Limitações do caminho nuvem

- **Migrations são só de ida.** Não existe `db:reset` seguro contra a nuvem — ele apagaria o
  banco. Correção de migration já aplicada exige uma nova migration por cima.
- Cada `db:push` é feito contra dados reais. Antes de aplicar algo destrutivo, confira o SQL.
- O projeto Free pausa após ~1 semana sem uso; basta reativar pelo painel.

---

## 1. Caminho local (Docker) — pré-requisitos

| Ferramenta         | Versão   | Observação                                               |
| ------------------ | -------- | -------------------------------------------------------- |
| Node.js            | ≥ 20 LTS | `node --version`                                         |
| npm                | ≥ 10     | acompanha o Node                                         |
| Git                | ≥ 2.40   |                                                          |
| **WSL2**           | —        | pré-requisito do Docker no Windows                       |
| **Docker Desktop** | atual    | **obrigatório** para o Supabase local (`supabase start`) |

> Sem Docker, o Supabase local não sobe. Alternativa na seção 9.

### 1.1 Windows — instalar WSL2 e Docker

Os dois comandos exigem **PowerShell como Administrador** (botão direito no menu Iniciar →
_Terminal (Administrador)_).

```powershell
# 1. WSL2 — apenas o kernel; o Docker cria as próprias distros
wsl --install --no-distribution

# 2. Reiniciar o computador

# 3. Docker Desktop
winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements

# 4. Reiniciar, abrir o Docker Desktop e aguardar "Engine running"
```

Verificação:

```bash
docker --version
docker ps          # tabela vazia, sem erro de conexão
```

O Supabase local sobe ~10 contêineres: cerca de 2 GB de RAM e 4 GB de disco. O primeiro
`supabase start` baixa as imagens e leva de 5 a 15 minutos.

## 2. Instalação

```bash
npm install
```

## 3. Subir o banco local (comando único)

```bash
npm run local:setup
```

Executa, em ordem: `supabase start` → sincroniza o `.env.local` com as credenciais geradas →
migrations + seed → roda os testes de RLS.

Passo a passo equivalente:

```bash
npm run local:start   # sobe os contêineres
npm run local:env     # grava as chaves reais no .env.local
npm run local:reset   # migrations + seed
npm run local:types   # regenera database.types.ts
npm run local:test    # pgTAP: isolamento multi-tenant
```

> No caminho local, o `config.toml` já habilita o Custom Access Token Hook automaticamente —
> o passo manual da seção 0.4 não é necessário.

Serviços locais:

| Serviço                     | URL                                                       |
| --------------------------- | --------------------------------------------------------- |
| API                         | http://127.0.0.1:54321                                    |
| Studio (painel do banco)    | http://127.0.0.1:54323                                    |
| Inbucket (e-mails de teste) | http://127.0.0.1:54324                                    |
| Postgres                    | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

## 4. Rodar a aplicação

```bash
npm run dev
```

http://localhost:3000

### Usuários do seed — senha `Ingressos@2026`

| E-mail                        | Perfil                | Empresa                                |
| ----------------------------- | --------------------- | -------------------------------------- |
| admin@agenciamay.com.br       | Administrador         | Agência May Eventos                    |
| organizador@agenciamay.com.br | Organizador           | Agência May Eventos                    |
| recepcao@agenciamay.com.br    | Recepção              | Agência May Eventos                    |
| suporte@agenciamay.com.br     | Suporte               | Agência May Eventos                    |
| admin@horizonte.org.br        | Administrador         | Instituto Horizonte                    |
| multi@agenciamay.com.br       | Organizador / Suporte | **Ambas** (testa o seletor de empresa) |

## 5. Verificar o isolamento multi-tenant

O critério de aceite da Sprint 1:

```bash
npm run local:test          # requer Docker
```

O teste autentica como administrador da Agência May e tenta ler e escrever dados do Instituto
Horizonte. Todas as tentativas devem retornar zero linhas ou erro de permissão.

> O pgTAP roda apenas no banco local — ele cria e descarta objetos de teste, o que não se faz
> contra a nuvem. No caminho nuvem, o isolamento é verificado manualmente (abaixo) e pelo CI,
> que sobe um Supabase local descartável a cada pull request.

Verificação manual: entre com `admin@agenciamay.com.br`, depois com `admin@horizonte.org.br`, e
confirme que nenhum dado atravessa. Com `multi@agenciamay.com.br`, troque de empresa pela topbar e
observe que o cache do painel é descartado por completo.

## 6. Comandos

| Comando                              | O que faz                                       |
| ------------------------------------ | ----------------------------------------------- |
| `npm run dev`                        | Servidor de desenvolvimento                     |
| `npm run build`                      | Build de produção (standalone)                  |
| `npm run lint` / `npm run typecheck` | Qualidade estática                              |
| `npm run format`                     | Prettier (inclui ordenação de classes Tailwind) |
| `npm test` / `npm run test:e2e`      | Vitest / Playwright                             |

**Banco na nuvem:**

| Comando            | O que faz                                            |
| ------------------ | ---------------------------------------------------- |
| `npm run setup`    | `db:push` + `db:types` + `db:seed`                   |
| `npm run db:push`  | Aplica as migrations pendentes no projeto remoto     |
| `npm run db:types` | Regenera `database.types.ts` a partir do schema real |
| `npm run db:seed`  | Cria empresas e usuários de demonstração             |

**Banco local (Docker):**

| Comando                              | O que faz                                              |
| ------------------------------------ | ------------------------------------------------------ |
| `npm run local:setup`                | Sobe tudo e valida de uma vez                          |
| `npm run local:start` / `local:stop` | Sobe/derruba os contêineres                            |
| `npm run local:env`                  | Grava as credenciais locais no `.env.local`            |
| `npm run local:reset`                | Recria o banco do zero: migrations + seed              |
| `npm run local:types`                | Regenera os tipos a partir do banco local              |
| `npm run local:test`                 | pgTAP (RLS e isolamento)                               |
| `npm run db:diff -- nome`            | Gera migration a partir de alterações feitas no Studio |

## 7. Regra de ouro do banco

Alterou o schema? **A alteração nasce em `supabase/migrations/`.**

Se você mexeu pelo Studio para prototipar, capture antes de perder:

```bash
npm run db:diff -- descricao_da_mudanca   # captura o SQL
npm run db:push                           # aplica na nuvem
npm run db:types                          # atualiza os tipos
```

O CI executa `supabase db reset` em base limpa a cada pull request: migration que só funciona no
seu banco não passa. É essa a rede de segurança do caminho nuvem, onde não existe `reset` local.

## 8. Problemas comuns

| Sintoma                                                               | Causa provável                                                                                                                                      | Solução                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Login funciona mas o painel fica vazio                                | Hook de token não habilitado                                                                                                                        | Nuvem: seção 0.4. Local: conferir o `config.toml` e rodar `local:reset`     |
| `db:push` falha com timeout de conexão                                | Usando o _Direct connection_                                                                                                                        | Trocar pelo **Session pooler** no `DATABASE_URL`                            |
| `password authentication failed`                                      | Senha errada na connection                                                                                                                          | Regenerar em Project Settings → Database → Reset database password          |
| `permission denied for schema private`                                | Migration do hook não aplicada                                                                                                                      | Rodar `npm run db:push` novamente e conferir se todas as migrations subiram |
| Trocar de empresa não muda nada                                       | Sessão não renovada                                                                                                                                 | O tenant vive no JWT; `switchTenant` chama `refreshSession` (ADR-004)       |
| Projeto Supabase "paused"                                             | Free tier sem uso por ~1 semana                                                                                                                     | Reativar pelo painel do projeto                                             |
| Auditoria com IP nulo em produção                                     | Nginx sem `X-Forwarded-For`                                                                                                                         | Configurar o proxy conforme docs/08, seção 2                                |
| `npm run dev` sobe na porta 3001                                      | Porta 3000 ocupada                                                                                                                                  | Liberar a porta ou usar `npm run dev -- -p 3005`                            |
| **Página abre sem estilo nenhum (HTML cru, links azuis sublinhados)** | `.next` corrompido — quase sempre por rodar `npm run build` com o `npm run dev` ativo: os dois compartilham o diretório e um sobrescreve o do outro | Parar o dev, apagar `.next`, subir de novo (ver abaixo)                     |
| Dois servidores respondendo em portas diferentes                      | Processo órfão de uma sessão anterior                                                                                                               | Encerrar o processo antigo: um dev server esquecido serve código velho      |
| `supabase start` falha                                                | Docker não está rodando                                                                                                                             | Iniciar o Docker Desktop                                                    |
| `wsl --install` falha                                                 | Terminal sem privilégio                                                                                                                             | Abrir o PowerShell como Administrador                                       |

### Página sem estilo — como resolver

```powershell
# 1. Encerrar QUALQUER dev server ativo (Ctrl+C no terminal, ou:)
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# 2. Limpar o cache de build
Remove-Item .next -Recurse -Force

# 3. Subir um único servidor
npm run dev -- -p 3005
```

**Regra prática:** `npm run build` e `npm run dev` não convivem. O build sobrescreve o
`.next/static` que o dev está servindo, e o resultado é o CSS respondendo 404 — a página carrega,
mas sem nenhum estilo. Rode o build só com o dev parado.

## 9. Migrar da nuvem para o local depois

Os dois caminhos usam as mesmas migrations. Quando o Docker estiver disponível, basta rodar
`npm run local:setup` e trocar as variáveis do `.env.local` — nenhuma alteração de código.
