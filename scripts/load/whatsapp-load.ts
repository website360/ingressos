/**
 * Teste de carga do WhatsApp em escala — SEMPRE contra o Supabase local.
 *
 *   node scripts/load/run.mjs --profile 15m
 *   node scripts/load/run.mjs --profile 1h --window-minutes 10
 *
 * O que faz:
 *   1. cria um evento novo e liga a empresa à Meta SIMULADA (servidor HTTP
 *      local que só conta e responde — nenhuma mensagem real);
 *   2. sobe o worker de verdade (dist/worker.js) como processo separado,
 *      como em produção;
 *   3. injeta inscrições pela RPC real `create_registration` em ritmo
 *      constante (total ÷ duração do perfil), por um pool de conexões;
 *   4. a cada 5 s mede: inscrições/s, latência da inscrição, mensagens
 *      aceitas/s, tamanho e idade da fila, memória/CPU do worker e conexões
 *      abertas no Postgres;
 *   5. espera a fila esvaziar e grava JSON + resumo em Markdown em
 *      scripts/load/results/.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import pg from "pg";

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
}

const PROFILES: Record<string, number> = { "15m": 15 * 60, "1h": 60 * 60, "3h": 3 * 60 * 60 };
const profile = args.get("profile") ?? "15m";
const profileSeconds: number = PROFILES[profile] ?? 0;
if (!profileSeconds) throw new Error(`Perfil desconhecido: ${profile} (use 15m, 1h ou 3h)`);

const total = Number(args.get("total") ?? 100_000);
const regRate = total / profileSeconds;
const windowMinutes = Number(args.get("window-minutes") ?? 0);
const injectSeconds = windowMinutes > 0 ? Math.min(windowMinutes * 60, profileSeconds) : profileSeconds;
const toInject = Math.round(regRate * injectSeconds);
const metaRate = Number(args.get("rate") ?? 80);
const metaLatencyMs = Number(args.get("meta-latency") ?? 150);
const metaErrorRate = Number(args.get("meta-error-rate") ?? 0);
const connections = Number(args.get("connections") ?? 16);
const concurrency = Number(args.get("concurrency") ?? 32);

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(DATABASE_URL).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost"].includes(host)) {
  throw new Error("TEST_DATABASE_URL precisa apontar para localhost — teste de carga nunca roda em produção.");
}

// ---------------------------------------------------------------------------
// Meta simulada (leve: conta, não guarda corpo)
// ---------------------------------------------------------------------------
let metaRequests = 0;
let metaErrors = 0;
// wamid único por execução: o índice único do wamid recusaria repetição.
const RUN = Date.now().toString(36);

function startMeta(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const n = ++metaRequests;
      const fail = metaErrorRate > 0 && Math.random() < metaErrorRate;
      setTimeout(() => {
        if (fail) {
          metaErrors++;
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "simulado", code: 131000 } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: [{ id: `wamid.CARGA${RUN}.${n}` }] }));
      }, metaLatencyMs * (0.5 + Math.random()));
    });
  });
  server.keepAliveTimeout = 30_000;
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v23.0` }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quantile = (sorted: number[], q: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

interface Sample {
  t: number;
  inscritos: number;
  inscricoesPorS: number;
  latP50: number;
  latP95: number;
  latP99: number;
  aceitas: number;
  aceitasPorS: number;
  fila: number;
  idadeMaisAntigaS: number;
  workerRssMb: number | null;
  workerCpuPct: number | null;
  conexoesPg: number;
}

async function main() {
  const db = new pg.Pool({ connectionString: DATABASE_URL, max: connections + 4 });
  const runId = Date.now().toString(36);
  const cpfPrefix = String(Date.now() % 1000).padStart(3, "0");

  console.log(
    `Perfil ${profile}: ${total.toLocaleString("pt-BR")} em ${profileSeconds / 60} min = ${round(regRate, 1)} inscrições/s. ` +
      `Injetando ${toInject.toLocaleString("pt-BR")} em ${round(injectSeconds / 60, 1)} min. Meta simulada: ${metaRate} msg/s, ` +
      `latência ~${metaLatencyMs} ms, erro ${metaErrorRate * 100}%.`,
  );

  // Empresa, evento e Meta simulada
  const tenantId = (await db.query<{ id: string }>(`select id from public.tenants limit 1`)).rows[0]?.id;
  if (!tenantId) throw new Error("Nenhuma empresa no banco local (rode os testes de integração uma vez).");
  const event = await db.query<{ id: string }>(
    `insert into public.events (tenant_id, name, slug, starts_at, ends_at, capacity, status, venue_name, city)
     values ($1, $2, $3, now() + interval '30 days', now() + interval '30 days 6 hours', 1000000, 'publicado',
             'Arena de Carga', 'São Paulo') returning id`,
    [tenantId, `Carga ${profile} ${runId}`, `carga-${runId}`],
  );
  const eventId = event.rows[0]!.id;

  const meta = await startMeta();
  await db.query(
    `insert into public.whatsapp_connections
       (tenant_id, provider, base_url, api_key, api_key_hint, state, meta_phone_number_id,
        rate_per_second, daily_unique_limit, worker_concurrency)
     values ($1, 'meta', $2, 'token-de-carga', 'toke…rga', 'conectado', '1234567890', $3, 10000000, $4)
     on conflict (tenant_id) do update
       set provider = 'meta', base_url = excluded.base_url, state = 'conectado',
           meta_phone_number_id = '1234567890', rate_per_second = $3, daily_unique_limit = 10000000,
           worker_concurrency = $4, paused = false, paused_reason = null,
           breaker_open_until = null, breaker_manual = false`,
    [tenantId, meta.url, metaRate, concurrency],
  );
  await db.query(`delete from public.whatsapp_rate_buckets`);
  await db.query(`delete from public.whatsapp_worker_heartbeats`);

  // Worker de verdade, processo separado
  const worker = spawn(process.execPath, ["dist/worker.js"], {
    env: {
      ...process.env,
      DATABASE_URL,
      NEXT_PUBLIC_APP_URL: "https://ingressos.example",
      META_BASE_URL: meta.url,
      WORKER_ID: "carga",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let workerErrors = 0;
  const workerLog = args.get("worker-log");
  const logStream = workerLog ? createWriteStream(workerLog) : null;
  worker.stdout.on("data", (chunk: Buffer) => logStream?.write(chunk));
  worker.stderr.on("data", (chunk: Buffer) => {
    workerErrors++;
    logStream?.write(chunk);
  });

  // Injeção em ritmo constante
  const latencies: number[] = [];
  let window: number[] = [];
  let next = 0;
  let injected = 0;
  let regErrors = 0;
  const t0 = Date.now();

  const injector = async () => {
    const client = await db.connect();
    try {
      for (;;) {
        const i = next++;
        if (i >= toInject) return;
        const due = t0 + (i / regRate) * 1000;
        const wait = due - Date.now();
        if (wait > 0) await sleep(wait);
        const started = performance.now();
        try {
          await client.query(`select public.create_registration($1, $2::jsonb, $3::jsonb, $4::jsonb)`, [
            eventId,
            JSON.stringify({
              first_name: "Carga",
              last_name: `Sintética ${i}`,
              cpf: `${cpfPrefix}${String(i).padStart(8, "0")}`,
              email: `carga${i}@example.com`,
              phone: `119${String(i).padStart(8, "0")}`,
              city: "São Paulo",
              state: "SP",
            }),
            JSON.stringify([
              { type: "lgpd", version: 1, accepted: true },
              { type: "regulamento", version: 1, accepted: true },
              { type: "whatsapp", version: 1, accepted: true, subject: `119${String(i).padStart(8, "0")}` },
            ]),
            JSON.stringify({ source: "carga", ip: "10.0.0.1", user_agent: "carga" }),
          ]);
          injected++;
        } catch (error) {
          if (regErrors === 0) console.error("Primeira falha de inscrição:", (error as Error).message);
          regErrors++;
        }
        const ms = performance.now() - started;
        latencies.push(ms);
        window.push(ms);
      }
    } finally {
      client.release();
    }
  };

  const injection = Promise.all(Array.from({ length: connections }, injector)).then(() => Date.now());

  // Amostragem
  const samples: Sample[] = [];
  let lastAccepted = 0;
  let lastInjected = 0;
  let lastCpu: { ms: number; at: number } | null = null;
  let injectionEnd: number | null = null;
  void injection.then((t) => (injectionEnd = t));

  const sampleOnce = async (): Promise<Sample> => {
    const q = await db.query<{ aceitas: number; fila: number; idade: number | null }>(
      `select count(*) filter (where accepted_at is not null)::int as aceitas,
              count(*) filter (where status in ('pendente', 'processando'))::int as fila,
              extract(epoch from now() - min(queued_at) filter (where status = 'pendente'))::int as idade
         from public.whatsapp_notifications where event_id = $1`,
      [eventId],
    );
    const hb = await db.query<{ stats: { rssMb?: number; cpuMs?: number } }>(
      `select stats from public.whatsapp_worker_heartbeats where worker_id = 'carga'`,
    );
    const conns = await db.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = current_database()`);
    const now = Date.now();
    const stats = hb.rows[0]?.stats;
    let cpuPct: number | null = null;
    if (stats?.cpuMs !== undefined) {
      if (lastCpu) cpuPct = round(((stats.cpuMs - lastCpu.ms) / Math.max(1, now - lastCpu.at)) * 100);
      lastCpu = { ms: stats.cpuMs, at: now };
    }
    const sortedWindow = [...window].sort((a, b) => a - b);
    window = [];
    const row = q.rows[0]!;
    const sample: Sample = {
      t: round((now - t0) / 1000, 0),
      inscritos: injected,
      inscricoesPorS: round((injected - lastInjected) / 5),
      latP50: round(quantile(sortedWindow, 0.5)),
      latP95: round(quantile(sortedWindow, 0.95)),
      latP99: round(quantile(sortedWindow, 0.99)),
      aceitas: row.aceitas,
      aceitasPorS: round((row.aceitas - lastAccepted) / 5),
      fila: row.fila,
      idadeMaisAntigaS: row.idade ?? 0,
      workerRssMb: stats?.rssMb ?? null,
      workerCpuPct: cpuPct,
      conexoesPg: conns.rows[0]!.n,
    };
    lastAccepted = row.aceitas;
    lastInjected = injected;
    return sample;
  };

  const deadline = t0 + (injectSeconds + 60 * 60) * 1000;
  for (;;) {
    await sleep(5_000);
    const s = await sampleOnce();
    samples.push(s);
    console.log(
      `t=${s.t}s inscritos=${s.inscritos} (${s.inscricoesPorS}/s p95=${s.latP95}ms) ` +
        `aceitas=${s.aceitas} (${s.aceitasPorS}/s) fila=${s.fila} idade=${s.idadeMaisAntigaS}s ` +
        `worker=${s.workerRssMb ?? "?"}MB/${s.workerCpuPct ?? "?"}% pg=${s.conexoesPg}`,
    );
    if (injectionEnd && s.fila === 0 && s.aceitas >= injected - regErrors) break;
    if (Date.now() > deadline) {
      console.log("Tempo máximo atingido; encerrando com fila restante.");
      break;
    }
  }

  const end = Date.now();
  worker.kill("SIGINT");
  await sleep(2_000);
  if (!worker.killed) worker.kill("SIGKILL");
  meta.server.close();

  // Resumo
  const sorted = [...latencies].sort((a, b) => a - b);
  const first = await db.query<{ first: string | null; last: string | null; n: number; dup: number }>(
    `select min(accepted_at) as first, max(accepted_at) as last, count(*)::int as n,
            (count(*) - count(distinct registration_id))::int as dup
       from public.whatsapp_notifications where event_id = $1 and accepted_at is not null`,
    [eventId],
  );
  const f = first.rows[0]!;
  const sendSeconds = f.first && f.last ? (new Date(f.last).getTime() - new Date(f.first).getTime()) / 1000 : 0;

  const summary = {
    perfil: profile,
    janelaInjecaoMin: round(injectSeconds / 60, 1),
    alvoInscricoesPorS: round(regRate, 1),
    inscricoesInjetadas: injected,
    errosInscricao: regErrors,
    inscricoesPorSObtido: round(injected / ((((injectionEnd ?? end) as number) - t0) / 1000), 1),
    latenciaInscricaoMs: {
      p50: round(quantile(sorted, 0.5)),
      p95: round(quantile(sorted, 0.95)),
      p99: round(quantile(sorted, 0.99)),
      max: round(sorted[sorted.length - 1] ?? 0),
    },
    mensagensAceitas: f.n,
    duplicadas: f.dup,
    vazaoMediaMsgPorS: sendSeconds > 0 ? round(f.n / sendSeconds, 1) : null,
    picoVazaoMsgPorS: Math.max(...samples.map((s) => s.aceitasPorS)),
    picoFila: Math.max(...samples.map((s) => s.fila)),
    maiorIdadeFilaS: Math.max(...samples.map((s) => s.idadeMaisAntigaS)),
    esvaziamentoAposInjecaoS: injectionEnd ? round((end - (injectionEnd as number)) / 1000, 0) : null,
    duracaoTotalMin: round((end - t0) / 60_000, 1),
    workerPicoRssMb: Math.max(...samples.map((s) => s.workerRssMb ?? 0)),
    workerPicoCpuPct: Math.max(...samples.map((s) => s.workerCpuPct ?? 0)),
    picoConexoesPg: Math.max(...samples.map((s) => s.conexoesPg)),
    metaRequisicoes: metaRequests,
    metaErrosSimulados: metaErrors,
    linhasDeErroDoWorker: workerErrors,
    parametros: { metaRate, metaLatencyMs, metaErrorRate, connections, concurrency },
  };

  mkdirSync("scripts/load/results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `scripts/load/results/${profile}-${stamp}`;
  writeFileSync(`${base}.json`, JSON.stringify({ summary, samples }, null, 2));
  writeFileSync(
    `${base}.md`,
    [
      `# Carga ${profile} — ${new Date().toLocaleString("pt-BR")}`,
      "",
      "```json",
      JSON.stringify(summary, null, 2),
      "```",
    ].join("\n"),
  );
  console.log("\nRESUMO", JSON.stringify(summary, null, 2));
  console.log(`\nGravado em ${base}.json / .md`);
  await db.end();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
