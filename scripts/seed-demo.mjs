#!/usr/bin/env node
/**
 * Dados de demonstração: eventos, inscrições e check-ins.
 *
 *   npm run db:demo
 *
 * As inscrições são criadas pela RPC `create_registration` de verdade — não por
 * INSERT direto. Assim o seed também serve de teste do caminho crítico:
 * controle de vagas, geração de ingresso, assinatura e consentimento LGPD.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error(".env.local não encontrado.");
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: tenant } = await db.from("tenants").select("id").limit(1).single();
if (!tenant) {
  console.error("✗ Nenhuma empresa. Rode `npm run db:seed` antes.");
  process.exit(1);
}
const TENANT = tenant.id;

// Datas relativas a hoje, sem depender de fuso do processo.
const day = (offset) => {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};
const hoursAfter = (iso, hours) => new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();

console.log("\n▸ Categorias...");
const CATEGORIES = [
  { name: "Congresso", slug: "congresso", color: "#2563eb" },
  { name: "Workshop", slug: "workshop", color: "#7c3aed" },
  { name: "Palestra", slug: "palestra", color: "#0891b2" },
  { name: "Treinamento", slug: "treinamento", color: "#059669" },
];
const { data: categories } = await db
  .from("categories")
  .upsert(
    CATEGORIES.map((c, i) => ({ ...c, tenant_id: TENANT, position: i })),
    { onConflict: "tenant_id,slug" },
  )
  .select("id, slug");

const catId = (slug) => categories?.find((c) => c.slug === slug)?.id ?? null;

console.log("▸ Eventos...");
const EVENTS = [
  {
    name: "Congresso de Tecnologia 2026",
    slug: "congresso-tecnologia-2026",
    short_description: "Dois dias sobre engenharia de software, IA aplicada e produto.",
    description:
      "<p>O maior encontro de tecnologia da região, com trilhas de engenharia, dados e produto.</p>",
    category_id: catId("congresso"),
    starts_at: day(21),
    capacity: 500,
    status: "publicado",
    venue_name: "Centro de Convenções Anhembi",
    address: "Av. Olavo Fontoura",
    address_number: "1209",
    district: "Santana",
    city: "São Paulo",
    state: "SP",
    zip_code: "02012021",
    lat: -23.5155,
    lng: -46.6333,
    registrations: 180,
  },
  {
    name: "Workshop de Vendas Consultivas",
    slug: "workshop-vendas-consultivas",
    short_description: "Técnicas práticas de negociação e follow-up para times comerciais.",
    category_id: catId("workshop"),
    starts_at: day(7),
    capacity: 40,
    status: "publicado",
    venue_name: "Sede Agência May",
    city: "São Paulo",
    state: "SP",
    lat: -23.5629,
    lng: -46.6544,
    registrations: 40, // lota de propósito: exercita a constraint de capacidade
  },
  {
    name: "Meetup de Produto — Edição de Inverno",
    slug: "meetup-produto-inverno",
    short_description: "Networking e cases de discovery com PMs da região.",
    category_id: catId("palestra"),
    starts_at: day(-14),
    capacity: 120,
    status: "encerrado",
    venue_name: "Hub Paulista",
    city: "São Paulo",
    state: "SP",
    lat: -23.5613,
    lng: -46.6565,
    registrations: 95,
    checkins: 71,
  },
  {
    name: "Treinamento Interno — LGPD na Prática",
    slug: "treinamento-lgpd",
    short_description: "Obrigações do controlador e do operador no dia a dia.",
    category_id: catId("treinamento"),
    starts_at: day(35),
    capacity: 60,
    status: "rascunho",
    city: "São Paulo",
    state: "SP",
    registrations: 0,
  },
];

const FIRST = ["Ana","Bruno","Carla","Diego","Elisa","Felipe","Gabriela","Henrique","Isabela","João","Karina","Lucas","Mariana","Nicolas","Olivia","Pedro","Queila","Rafael","Sofia","Thiago","Ursula","Vitor","Wanda","Yasmin"];
const LAST = ["Silva","Santos","Oliveira","Souza","Rodrigues","Ferreira","Alves","Pereira","Lima","Gomes","Costa","Ribeiro","Martins","Carvalho","Almeida","Lopes"];
const CITIES = [["São Paulo","SP"],["Campinas","SP"],["Rio de Janeiro","RJ"],["Belo Horizonte","MG"],["Curitiba","PR"],["Porto Alegre","RS"],["Salvador","BA"],["Recife","PE"],["Fortaleza","CE"],["Brasília","DF"]];

/**
 * CPF sintético com dígitos verificadores válidos — passa na validação real.
 * A base precisa ter exatamente 9 dígitos que variem com o seed: cortar os 9
 * primeiros de um número de 11 dígitos gerava o mesmo CPF para seeds diferentes.
 */
function makeCpf(seed) {
  const base = String(100000000 + (seed % 899999999)).split("").map(Number);
  for (const [len, pos] of [[9, 10], [10, 11]]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += base[i] * (pos - i);
    const rest = (sum * 10) % 11;
    base.push(rest === 10 || rest === 11 ? 0 : rest);
  }
  return base.join("");
}

const pick = (arr, i) => arr[i % arr.length];
let cpfSeed = 1;
let totalRegs = 0;
let totalWait = 0;
let totalCheckins = 0;

for (const spec of EVENTS) {
  const ends_at = hoursAfter(spec.starts_at, 9);

  // Evento passado precisa nascer publicado e no futuro: a RPC de inscrição
  // recusa evento encerrado, e é ela que semeia (de propósito). A data e o
  // status reais são aplicados depois, no backdate.
  const isPast = new Date(spec.starts_at) < new Date();
  const seedStartsAt = isPast ? day(30) : spec.starts_at;
  const seedEndsAt = isPast ? hoursAfter(day(30), 9) : ends_at;
  const seedStatus = spec.registrations ? "publicado" : spec.status;

  const { data: event, error } = await db
    .from("events")
    .upsert(
      {
        tenant_id: TENANT,
        name: spec.name,
        slug: spec.slug,
        short_description: spec.short_description,
        description: spec.description ?? null,
        category_id: spec.category_id,
        starts_at: seedStartsAt,
        ends_at: seedEndsAt,
        capacity: spec.capacity,
        status: seedStatus,
        venue_name: spec.venue_name ?? null,
        address: spec.address ?? null,
        address_number: spec.address_number ?? null,
        district: spec.district ?? null,
        city: spec.city,
        state: spec.state,
        zip_code: spec.zip_code ?? null,
        organizer_name: "Agência May Eventos",
        contact_email: "eventos@agenciamay.com.br",
        contact_phone: "11999998888",
        published_at: spec.status === "publicado" ? new Date().toISOString() : null,
      },
      { onConflict: "tenant_id,slug" },
    )
    .select("id, name, capacity, seats_taken")
    .single();

  if (error) {
    console.error(`  ✗ ${spec.name}: ${error.message}`);
    continue;
  }

  // geography aceita EWKT como texto — evita precisar de uma RPC só para isto.
  if (spec.lat) {
    await db
      .from("events")
      .update({
        location: `SRID=4326;POINT(${spec.lng} ${spec.lat})`,
        google_maps_url: `https://maps.google.com/?q=${spec.lat},${spec.lng}`,
      })
      .eq("id", event.id);
  }


  // Conteúdo da landing. Só é criado uma vez: recriar a cada execução geraria
  // duplicatas, já que estas tabelas não têm chave natural.
  const { count: hasContent } = await db
    .from("event_schedule_items")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id);

  if (!hasContent) {
    const base = { tenant_id: TENANT, event_id: event.id };

    await db.from("event_schedule_items").insert([
      { ...base, position: 0, starts_at: "08:30", ends_at: "09:00", title: "Credenciamento e café" },
      { ...base, position: 1, starts_at: "09:00", ends_at: "10:00", title: "Abertura", speaker: "Renata Duarte", description: "Panorama do setor e o que esperar dos próximos dois dias." },
      { ...base, position: 2, starts_at: "10:15", ends_at: "11:30", title: "Painel: engenharia em escala", speaker: "Marcos Vieira" },
      { ...base, position: 3, starts_at: "11:30", ends_at: "13:00", title: "Almoço livre" },
      { ...base, position: 4, starts_at: "13:00", ends_at: "14:30", title: "Workshop prático", speaker: "Helena Souza", description: "Traga o notebook — a atividade é mão na massa." },
      { ...base, position: 5, starts_at: "14:45", ends_at: "16:00", title: "Encerramento e networking" },
    ]);

    await db.from("event_speakers").insert([
      { ...base, position: 0, name: "Renata Duarte", role: "Diretora de Operações", company: "Agência May", bio: "15 anos organizando eventos corporativos de médio e grande porte." },
      { ...base, position: 1, name: "Marcos Vieira", role: "Head de Engenharia", company: "Instituto Horizonte", bio: "Trabalha com sistemas distribuídos e times de alta performance." },
      { ...base, position: 2, name: "Helena Souza", role: "Product Manager", company: "Lumen Software", bio: "Especialista em discovery contínuo e pesquisa com usuários." },
    ]);

    await db.from("event_faqs").insert([
      { ...base, position: 0, question: "A inscrição é gratuita?", answer: "Sim. A vaga é confirmada no momento da inscrição, por ordem de chegada." },
      { ...base, position: 1, question: "Preciso imprimir o ingresso?", answer: "Não. Basta apresentar o QR Code pelo celular na entrada." },
      { ...base, position: 2, question: "Posso cancelar minha inscrição?", answer: "Pode, pela própria página do ingresso, até o início do evento. A vaga é liberada na hora para quem estiver na lista de espera." },
      { ...base, position: 3, question: "O evento fornece certificado?", answer: "Sim, para quem realizar o check-in presencial. O envio é feito por e-mail após o encerramento." },
      { ...base, position: 4, question: "Há estacionamento no local?", answer: "O local possui estacionamento pago no subsolo, com vagas limitadas." },
    ]);


    await db.from("event_documents").insert([
      {
        ...base,
        document_type: "regulamento",
        version: 1,
        content:
          "1. A inscrição é pessoal e intransferível.\n2. A entrada é permitida mediante apresentação do QR Code do ingresso.\n3. É obrigatório apresentar documento oficial com foto, se solicitado.\n4. A organização pode alterar a programação por motivo de força maior.",
      },
      {
        ...base,
        document_type: "cancelamento",
        version: 1,
        content:
          "O cancelamento pode ser feito pela página do ingresso a qualquer momento antes do início do evento. A vaga é imediatamente liberada para a lista de espera. Após o início, o cancelamento não é possível e a ausência é registrada como não comparecimento.",
      },
      {
        ...base,
        document_type: "lgpd",
        version: 1,
        content:
          "Os dados informados na inscrição são utilizados exclusivamente para a gestão da sua participação: emissão do ingresso, comunicação sobre o evento e controle de acesso. Não são compartilhados com terceiros para fins comerciais. O titular pode solicitar acesso, correção ou exclusão dos seus dados pelo e-mail de contato do evento, conforme a Lei 13.709/2018.",
      },
    ]);
  }

  const target = spec.registrations ?? 0;
  const existing = event.seats_taken ?? 0;
  const toCreate = Math.max(target - existing, 0);
  let created = 0;
  let waitlisted = 0;
  const ticketTokens = [];

  for (let i = 0; i < toCreate; i++) {
    const [city, state] = pick(CITIES, i + cpfSeed);
    const { data: result, error: regError } = await db.rpc("create_registration", {
      p_event_id: event.id,
      p_attendee: {
        first_name: pick(FIRST, i + cpfSeed),
        last_name: pick(LAST, i * 3 + cpfSeed),
        cpf: makeCpf(cpfSeed),
        email: `participante${cpfSeed}@exemplo.com.br`,
        phone: `1199${String(1000000 + cpfSeed).slice(0, 7)}`,
        city,
        state,
        birth_date: `19${70 + (i % 30)}-0${1 + (i % 9)}-1${i % 9}`,
      },
      p_consents: [
        { type: "lgpd", version: 1, accepted: true },
        { type: "regulamento", version: 1, accepted: true },
      ],
      p_context: { source: "seed", ip: "127.0.0.1", user_agent: "seed-demo" },
    });

    cpfSeed++;

    if (regError) {
      console.error(`  ✗ inscrição: ${regError.message}`);
      break;
    }

    created++;
    if (result?.token) ticketTokens.push(result.token);
  }

  // Check-ins do evento já encerrado.
  let checked = 0;
  if (spec.checkins) {
    // A assinatura fica gravada no ingresso; o token é `code.signature`.
    const { data: tickets } = await db
      .from("tickets")
      .select("code, signature")
      .eq("event_id", event.id)
      .eq("status", "valido")
      .limit(spec.checkins);

    for (const t of tickets ?? []) {
      const { data: result, error: ciError } = await db.rpc("checkin", {
        p_token: `${t.code}.${t.signature}`,
        p_context: { source: "seed", ip: "127.0.0.1" },
      });
      if (!ciError && result?.result === "sucesso") checked++;
    }
  }

  // Backdate: agora o evento recebe a data e o status definitivos.
  if (isPast || seedStatus !== spec.status) {
    await db
      .from("events")
      .update({ starts_at: spec.starts_at, ends_at, status: spec.status })
      .eq("id", event.id);
  }

  totalRegs += created;
  totalWait += waitlisted;
  totalCheckins += checked;

  console.log(
    `  · ${spec.name.padEnd(38)} ${String(created).padStart(3)} inscritos` +
      (waitlisted ? ` · ${waitlisted} na fila` : "") +
      (checked ? ` · ${checked} check-ins` : ""),
  );
}

console.log(
  `\n✓ Demonstração pronta — ${totalRegs} inscrições, ${totalWait} em lista de espera, ${totalCheckins} check-ins\n`,
);
