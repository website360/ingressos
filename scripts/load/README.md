# Teste de carga — WhatsApp em escala

O teste simula picos de inscrição e mede se a confirmação pelo WhatsApp acompanha. Ele **nunca** fala com a Meta de verdade nem com o banco de produção: a ferramenta recusa qualquer host que não seja `localhost`.

## Pré-requisitos

```bash
npx supabase start          # Postgres local (Docker), com as migrations aplicadas
npm run test:int            # uma vez: cria a empresa de teste no banco local
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

## Rodar

```bash
node scripts/load/run.mjs --profile 15m                       # 100 mil em 15 min (≈111 inscrições/s)
node scripts/load/run.mjs --profile 1h --window-minutes 10    # ritmo de 100 mil/1 h, janela de 10 min
node scripts/load/run.mjs --profile 3h --window-minutes 10    # ritmo de 100 mil/3 h, janela de 10 min
```

| Opção | Padrão | O que é |
| ----- | ------ | ------- |
| `--profile` | `15m` | `15m`, `1h` ou `3h`. O ritmo de inscrição é `--total` ÷ a duração do perfil. |
| `--total` | 100000 | Inscrições no perfil completo. |
| `--window-minutes` | perfil inteiro | Injeta só esta janela, no ritmo do perfil. Serve para perfis longos. |
| `--rate` | 80 | Vazão configurada do número (msg/s). O padrão da Meta é 80. |
| `--meta-latency` | 150 | Latência média da Meta simulada, em ms (varia de 0,5× a 1,5×). |
| `--meta-error-rate` | 0 | Fração de respostas 500 simuladas (que viram nova tentativa). |
| `--connections` | 16 | Conexões injetando inscrições em paralelo. |
| `--concurrency` | 32 | Envios simultâneos do worker. |
| `--worker-log` | — | Arquivo para o log do worker. |

## Como funciona

1. Cria um evento novo e aponta a empresa para uma Meta **simulada** (um servidor HTTP local que só conta e responde).
2. Sobe o worker real (`dist/worker.js`) como **processo separado**, igual a produção.
3. Injeta as inscrições pela RPC real `create_registration`, em ritmo constante, com consentimento de WhatsApp, CPF único e telefone único.
4. A cada 5 s mede:
   - inscrições por segundo e latência da inscrição (p50, p95 e p99);
   - mensagens aceitas por segundo;
   - tamanho e idade da fila;
   - memória e CPU do worker (pelo batimento);
   - conexões abertas no Postgres.
5. Espera a fila esvaziar e grava `scripts/load/results/<perfil>-<data>.json` (amostras e resumo) e um `.md` com o resumo.

## Limites do que o teste prova

- **Roda numa só máquina.** A máquina de desenvolvimento roda ao mesmo tempo o Postgres (no Docker), o worker e o gerador de carga. O servidor de produção (1 vCPU, 2 GB) e o Supabase hospedado têm outro desempenho.
- **A Meta é simulada.** Vazão, latência e erros são parâmetros. Em produção mandam o nível de limite da conta e a vazão aprovada para o número.
- **A inscrição real passa também pelo navegador, pela rede, pelo nginx e pelo Next.** O teste chama a RPC direto: mede o banco e a fila, não a borda.
