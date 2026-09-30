#!/usr/bin/env node
/**
 * Dados de demonstração: a turnê do Bispo Bruno Leonardo, com inscrições e
 * check-ins.
 *
 *   npm run db:demo
 *
 * O roteiro abaixo é a descrição fiel do que deve existir no banco — rodar de
 * novo converge para ele, não duplica. Cada parada é casada pelo `slug`; o
 * conteúdo da landing só nasce uma vez (estas tabelas não têm chave natural,
 * recriar geraria duplicata), então o que foi editado à mão fica de pé.
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

const ORGANIZER = "Ministério Bruno Leonardo";
const CONTACT_EMAIL = "eventos@agenciamay.com.br";
const CONTACT_PHONE = "11999998888";

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

// -----------------------------------------------------------------------------
// O roteiro
//
// Datas absolutas, com o fuso escrito: a turnê tem data de verdade, e data
// relativa a `hoje` fazia a mesma parada andar a cada execução. As paradas já
// realizadas ficam com inscrição fechada; as futuras, abertas.
// -----------------------------------------------------------------------------
const TOUR = [
  {
    slug: "bispo-maracana-rj",
    name: "Bispo Bruno Leonardo no Maracanã",
    category: "palestra",
    starts_at: "2026-07-16T09:00:00-03:00",
    ends_at: "2026-07-16T18:00:00-03:00",
    capacity: 120,
    status: "encerrado",
    registrations_open: false,
    registrations: 95,
    checkins: 71,
    venue_name: "Estádio do Maracanã",
    address: "Av. Presidente Castelo Branco, portão 2",
    district: "Maracanã",
    city: "Rio de Janeiro",
    state: "RJ",
    zip_code: "20271130",
    lat: -22.9121,
    lng: -43.2302,
    short_description: "A noite em que o Maracanã se encheu de oração. Reveja como foi.",
    description:
      "<p>Primeira parada da visita do Bispo Bruno Leonardo. O Maracanã recebeu uma noite inteira de louvor, palavra e oração, com o Cristo Redentor ao fundo e a arquibancada acesa de ponta a ponta.</p><p>As inscrições estão encerradas. As próximas paradas seguem com entrada gratuita.</p>",
    accessibility:
      "O Maracanã tem setor reservado para cadeirantes e acompanhante, com acesso pelo portão 2. Procure a equipe de apoio na entrada.",
    parking:
      "Há estacionamento pago no entorno, com lotação limitada. O metrô, pela estação Maracanã, é o caminho mais rápido na saída.",
  },
  {
    slug: "bispo-mineirao-bh",
    name: "Bispo Bruno Leonardo no Mineirão",
    category: "workshop",
    starts_at: "2026-08-06T09:00:00-03:00",
    ends_at: "2026-08-06T18:00:00-03:00",
    capacity: 40,
    status: "publicado",
    registrations_open: false,
    registrations: 40, // lota de propósito: exercita a constraint de capacidade
    venue_name: "Estádio Mineirão",
    address: "Av. Antônio Abrahão Caram, 1001",
    district: "São José",
    city: "Belo Horizonte",
    state: "MG",
    zip_code: "31275000",
    lat: -19.8659,
    lng: -43.9709,
    short_description: "Uma noite de louvor, palavra e oração no coração de Belo Horizonte.",
    description:
      "<p>O Mineirão abre as portas para a segunda parada da visita do Bispo Bruno Leonardo. Uma noite de louvor, palavra e oração, com equipes de acolhimento em todos os setores.</p><p>A entrada é gratuita e o ingresso garante o seu lugar. Chegue cedo: a fila começa a se formar bem antes da abertura dos portões.</p>",
    accessibility:
      "O Mineirão tem setor reservado para cadeirantes e acompanhante. Procure a equipe de apoio na entrada.",
    parking:
      "Há estacionamento pago no entorno. Como a lotação é grande, recomendamos transporte público — a estação São Gabriel tem linha direta para o estádio.",
  },
  {
    slug: "bispo-allianz-parque-sp",
    name: "Bispo Bruno Leonardo no Allianz Parque",
    category: "congresso",
    starts_at: "2026-08-20T09:00:00-03:00",
    ends_at: "2026-08-20T18:00:00-03:00",
    capacity: 500,
    status: "publicado",
    registrations_open: true,
    registrations: 183,
    checkins: 2,
    venue_name: "Allianz Parque",
    address: "Av. Francisco Matarazzo, 1705",
    district: "Água Branca",
    city: "São Paulo",
    state: "SP",
    zip_code: "05001200",
    lat: -23.5275,
    lng: -46.6784,
    short_description: "A visita chega a São Paulo para encher a arena de fé numa só noite.",
    description:
      "<p>O Allianz Parque recebe a maior noite da visita do Bispo Bruno Leonardo. Louvor, palavra e um momento de oração conduzido do gramado, com a cidade inteira convidada.</p><p>A entrada é gratuita, por ingresso. Cada pedido de oração entregue nas entradas é levado ao momento final da noite.</p>",
    accessibility:
      "O Allianz Parque tem setor reservado para cadeirantes e acompanhante, com elevador de acesso. Procure a equipe de apoio na entrada.",
    parking:
      "Há estacionamento pago no próprio complexo, com vagas limitadas. A estação Água Branca da CPTM fica a poucos minutos a pé.",
  },
  {
    slug: "bispo-beira-rio-poa",
    name: "Bispo Bruno Leonardo no Beira-Rio",
    category: "treinamento",
    starts_at: "2026-09-03T09:00:00-03:00",
    ends_at: "2026-09-03T18:00:00-03:00",
    capacity: 60,
    status: "publicado",
    registrations_open: false,
    registrations: 1,
    venue_name: "Estádio Beira-Rio",
    address: "Av. Padre Cacique, 891",
    district: "Praia de Belas",
    city: "Porto Alegre",
    state: "RS",
    zip_code: "90810240",
    lat: -30.0653,
    lng: -51.2359,
    short_description: "Grande culto em Porto Alegre, às margens do Guaíba.",
    description:
      "<p>O Beira-Rio recebe o grande culto da visita do Bispo Bruno Leonardo em Porto Alegre. Uma noite de louvor, palavra e oração, com equipes de acolhimento em todos os setores.</p><p>A entrada é gratuita, por ingresso. Chegue cedo: a fila se forma bem antes da abertura dos portões.</p>",
    accessibility:
      "O Beira-Rio tem setor reservado para cadeirantes e acompanhante. Procure a equipe de apoio na entrada.",
    parking:
      "Há estacionamento pago no entorno. Como a lotação é grande, recomendamos transporte público — em Porto Alegre é o caminho mais rápido na saída.",
  },

  // ---------------------------------------------------------------------------
  // Próximas paradas. Começam às 18h e terminam à meia-noite: a programação
  // gerada sai noturna, coerente com o que o texto promete.
  // ---------------------------------------------------------------------------
  {
    slug: "bispo-fonte-nova-ssa",
    name: "Bispo Bruno Leonardo na Fonte Nova",
    category: "palestra",
    starts_at: "2026-11-07T18:00:00-03:00",
    ends_at: "2026-11-08T00:00:00-03:00",
    capacity: 150,
    status: "publicado",
    registrations_open: true,
    registrations: 141, // deixa ~6% das vagas: acende o selo "Últimas vagas"
    art_from: "bispo-allianz-parque-sp",
    venue_name: "Arena Fonte Nova",
    address: "Ladeira da Fonte das Pedras, s/n",
    district: "Nazaré",
    city: "Salvador",
    state: "BA",
    zip_code: "40050565",
    lat: -12.9786,
    lng: -38.5044,
    short_description: "A turnê chega ao Nordeste: uma noite de fé no coração de Salvador.",
    description:
      "<p>A Arena Fonte Nova abre a etapa nordestina da visita do Bispo Bruno Leonardo. Uma noite inteira de louvor, palavra e oração, com equipes de acolhimento em todos os setores da arena.</p><p>A entrada é gratuita, por ingresso. Cada pedido de oração entregue nas entradas é levado ao momento final da noite.</p>",
    accessibility:
      "A Fonte Nova tem setor reservado para cadeirantes e acompanhante, com rampa de acesso em todos os anéis. Procure a equipe de apoio na entrada.",
    parking:
      "Há estacionamento pago no entorno, com vagas limitadas. Recomendamos transporte público — a estação Campo da Pólvora fica a poucos minutos a pé.",
  },
  {
    slug: "bispo-castelao-for",
    name: "Bispo Bruno Leonardo no Castelão",
    category: "palestra",
    starts_at: "2026-11-28T18:00:00-03:00",
    ends_at: "2026-11-29T00:00:00-03:00",
    capacity: 90,
    status: "publicado",
    registrations_open: true,
    registrations: 90, // lota: a vitrine mostra "Lotado" e a inscrição é recusada
    art_from: "bispo-mineirao-bh",
    venue_name: "Arena Castelão",
    address: "Av. Alberto Craveiro, 2901",
    district: "Castelão",
    city: "Fortaleza",
    state: "CE",
    zip_code: "60861630",
    lat: -3.8072,
    lng: -38.5223,
    short_description: "Fortaleza recebe a segunda parada da etapa nordestina.",
    description:
      "<p>A Arena Castelão recebe o Bispo Bruno Leonardo para uma noite de louvor, palavra e oração. O setor liberado para esta data tem lotação limitada, e o ingresso gratuito garante o seu lugar.</p><p>Chegue cedo: a fila começa a se formar bem antes da abertura dos portões.</p>",
    accessibility:
      "O Castelão tem setor reservado para cadeirantes e acompanhante, com acesso nivelado pelo portão principal. Procure a equipe de apoio na entrada.",
    parking:
      "A arena tem estacionamento próprio, pago e com vagas limitadas. Nas noites de maior público, o transporte público é o caminho mais rápido na saída.",
  },
  {
    slug: "bispo-arena-pernambuco-rec",
    name: "Bispo Bruno Leonardo na Arena Pernambuco",
    category: "palestra",
    starts_at: "2026-12-12T18:00:00-03:00",
    ends_at: "2026-12-13T00:00:00-03:00",
    capacity: 200,
    status: "publicado",
    registrations_open: true,
    registrations: 76,
    art_from: "bispo-beira-rio-poa",
    venue_name: "Arena Pernambuco",
    address: "Av. Deputado Hernandes Bezerra Lyra, s/n — São Lourenço da Mata",
    district: "Nossa Senhora do Ó",
    city: "Recife",
    state: "PE",
    zip_code: "54735510",
    lat: -8.0389,
    lng: -35.0083,
    short_description: "Grande culto na região metropolitana do Recife, na Arena Pernambuco.",
    description:
      "<p>A Arena Pernambuco recebe a terceira parada da etapa nordestina da visita do Bispo Bruno Leonardo. Louvor, palavra e um momento de oração conduzido do gramado.</p><p>A entrada é gratuita, por ingresso. A arena fica em São Lourenço da Mata, a cerca de 20 km do centro do Recife — programe-se para chegar com antecedência.</p>",
    accessibility:
      "A Arena Pernambuco tem setor reservado para cadeirantes e acompanhante, com elevador de acesso. Procure a equipe de apoio na entrada.",
    parking:
      "A arena tem estacionamento próprio, pago e com boa capacidade. Nos dias de evento há linhas especiais de ônibus a partir do terminal Cosme e Damião.",
  },
  {
    slug: "bispo-mane-garrincha-bsb",
    name: "Bispo Bruno Leonardo no Mané Garrincha",
    category: "palestra",
    starts_at: "2027-03-06T18:00:00-03:00",
    ends_at: "2027-03-07T00:00:00-03:00",
    capacity: 400,
    status: "publicado",
    registrations_open: true,
    registrations: 0, // acabou de abrir: a vitrine mostra a parada zerada
    art_from: "bispo-maracana-rj",
    venue_name: "Estádio Nacional Mané Garrincha",
    address: "SRPN — Eixo Monumental",
    district: "Asa Norte",
    city: "Brasília",
    state: "DF",
    zip_code: "70070701",
    lat: -15.7835,
    lng: -47.8992,
    short_description: "O encerramento da turnê, no Eixo Monumental de Brasília.",
    description:
      "<p>O Estádio Nacional Mané Garrincha recebe a noite de encerramento da turnê do Bispo Bruno Leonardo. Louvor, palavra e um momento de oração conduzido do gramado, no coração da capital.</p><p>A entrada é gratuita, por ingresso, e as inscrições acabam de abrir. Cada pedido de oração entregue nas entradas é levado ao momento final da noite.</p>",
    accessibility:
      "O Mané Garrincha tem setor reservado para cadeirantes e acompanhante, com rampa de acesso em toda a volta do estádio. Procure a equipe de apoio na entrada.",
    parking:
      "Há estacionamento no entorno do Eixo Monumental, com vagas limitadas. A estação Central do metrô fica a cerca de 15 minutos a pé.",
  },
];

// -----------------------------------------------------------------------------
// Conteúdo da landing, gerado a partir da parada
// -----------------------------------------------------------------------------

/** "HH:MM" no fuso do evento, deslocado em minutos a partir do início. */
const localTime = (iso, minutes) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(new Date(iso).getTime() + minutes * 60_000));

/** Minutos a partir do início — a mesma noite, em qualquer horário de começo. */
const PROGRAM = [
  [-120, 0, "Fila e organização do público", "Equipes de apoio orientam a entrada por setor."],
  [
    0,
    60,
    "Abertura dos portões",
    "Credenciamento por QR Code na entrada do setor indicado no ingresso.",
  ],
  [60, 150, "Louvor e adoração", "Ministério de louvor conduz a abertura da noite."],
  [150, 240, "Palavra com o Bispo Bruno Leonardo", "Mensagem central do encontro."],
  [240, 300, "Momento de oração", "Oração pelos pedidos entregues na entrada."],
  [300, 360, "Encerramento e saída organizada", "Saída por setores, orientada pelas equipes."],
];

const scheduleFor = (spec) =>
  PROGRAM.map(([from, to, title, description], position) => ({
    position,
    starts_at: localTime(spec.starts_at, from),
    ends_at: localTime(spec.starts_at, to),
    title,
    description,
  }));

const SPEAKERS = [
  { position: 0, name: "Bispo Bruno Leonardo", role: "Preletor", company: ORGANIZER },
  { position: 1, name: "Ministério de Louvor", role: "Condução musical", company: ORGANIZER },
  { position: 2, name: "Equipe de Intercessão", role: "Oração e acolhimento", company: ORGANIZER },
];

const faqsFor = (spec) => [
  {
    position: 0,
    question: "A entrada é gratuita?",
    answer:
      "Sim. O ingresso é gratuito e garante seu lugar no setor indicado — retire o seu com antecedência, porque a capacidade é limitada.",
  },
  {
    position: 1,
    question: "Preciso imprimir o ingresso?",
    answer: "Não. Basta apresentar o QR Code na tela do celular na entrada do setor.",
  },
  {
    position: 2,
    question: "Posso levar crianças?",
    answer:
      "Pode. Menores de 12 anos entram acompanhados de um responsável e não precisam de ingresso próprio.",
  },
  { position: 3, question: "Como funciona a acessibilidade?", answer: spec.accessibility },
  { position: 4, question: "Há estacionamento no local?", answer: spec.parking },
  {
    position: 5,
    question: "Posso deixar um pedido de oração?",
    answer: "Pode. Há postos de recolhimento de pedidos nas entradas, até o início da palavra.",
  },
];

const DOCUMENTS = [
  {
    document_type: "regulamento",
    version: 1,
    content:
      "1. A inscrição é pessoal e intransferível.\n2. A entrada é permitida mediante apresentação do QR Code do ingresso.\n3. É obrigatório apresentar documento oficial com foto, se solicitado.\n4. A organização pode alterar a programação por motivo de força maior.",
  },
  {
    document_type: "cancelamento",
    version: 1,
    content:
      "O cancelamento pode ser feito pela página do ingresso a qualquer momento antes do início do evento. A vaga é imediatamente liberada para quem chegar depois. Após o início, o cancelamento não é possível e a ausência é registrada como não comparecimento.",
  },
  {
    document_type: "lgpd",
    version: 1,
    content:
      "Os dados informados na inscrição são utilizados exclusivamente para a gestão da sua participação: emissão do ingresso, comunicação sobre o evento e controle de acesso. Não são compartilhados com terceiros para fins comerciais. O titular pode solicitar acesso, correção ou exclusão dos seus dados pelo e-mail de contato do evento, conforme a Lei 13.709/2018.",
  },
];

// -----------------------------------------------------------------------------
// Participantes sintéticos
// -----------------------------------------------------------------------------
const FIRST = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Felipe",
  "Gabriela",
  "Henrique",
  "Isabela",
  "João",
  "Karina",
  "Lucas",
  "Mariana",
  "Nicolas",
  "Olivia",
  "Pedro",
  "Queila",
  "Rafael",
  "Sofia",
  "Thiago",
  "Ursula",
  "Vitor",
  "Wanda",
  "Yasmin",
];
const LAST = [
  "Silva",
  "Santos",
  "Oliveira",
  "Souza",
  "Rodrigues",
  "Ferreira",
  "Alves",
  "Pereira",
  "Lima",
  "Gomes",
  "Costa",
  "Ribeiro",
  "Martins",
  "Carvalho",
  "Almeida",
  "Lopes",
];
const CITIES = [
  ["São Paulo", "SP"],
  ["Campinas", "SP"],
  ["Rio de Janeiro", "RJ"],
  ["Belo Horizonte", "MG"],
  ["Curitiba", "PR"],
  ["Porto Alegre", "RS"],
  ["Salvador", "BA"],
  ["Recife", "PE"],
  ["Fortaleza", "CE"],
  ["Brasília", "DF"],
];

/**
 * CPF sintético com dígitos verificadores válidos — passa na validação real.
 * A base precisa ter exatamente 9 dígitos que variem com o seed: cortar os 9
 * primeiros de um número de 11 dígitos gerava o mesmo CPF para seeds diferentes.
 */
function makeCpf(seed) {
  const base = String(100000000 + (seed % 899999999))
    .split("")
    .map(Number);
  for (const [len, pos] of [
    [9, 10],
    [10, 11],
  ]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += base[i] * (pos - i);
    const rest = (sum * 10) % 11;
    base.push(rest === 10 || rest === 11 ? 0 : rest);
  }
  return base.join("");
}

const pick = (arr, i) => arr[i % arr.length];

// -----------------------------------------------------------------------------
// Execução
// -----------------------------------------------------------------------------
console.log("▸ Eventos...");

/** Artes já no Storage, para as paradas novas tomarem emprestado (`art_from`). */
const { data: published } = await db
  .from("events")
  .select("slug, cover_url, banner_url")
  .eq("tenant_id", TENANT);
const artOf = (slug) => published?.find((e) => e.slug === slug) ?? null;

let totalRegs = 0;
let totalCheckins = 0;

for (const [index, spec] of TOUR.entries()) {
  const { data: current } = await db
    .from("events")
    .select("id, seats_taken, checked_in_count, cover_url, banner_url")
    .eq("tenant_id", TENANT)
    .eq("slug", spec.slug)
    .maybeSingle();

  const toCreate = Math.max((spec.registrations ?? 0) - (current?.seats_taken ?? 0), 0);
  const toCheckin = Math.max((spec.checkins ?? 0) - (current?.checked_in_count ?? 0), 0);

  // A RPC de inscrição recusa evento encerrado ou com inscrição fechada — e é
  // ela que semeia, de propósito. Quando ainda há o que semear numa parada
  // assim, o evento nasce aberto e no futuro, e recebe data e status
  // definitivos logo depois. Nada a semear, nada de janela: a parada já em dia
  // não precisa dar essa volta a cada execução.
  const isPast = new Date(spec.starts_at) < new Date();
  const needsSeedWindow =
    (toCreate > 0 || toCheckin > 0) &&
    (isPast || spec.status !== "publicado" || !spec.registrations_open);

  const future = new Date();
  future.setDate(future.getDate() + 30);
  const seedStartsAt = needsSeedWindow ? future.toISOString() : spec.starts_at;
  const seedEndsAt = needsSeedWindow
    ? new Date(future.getTime() + 6 * 3600_000).toISOString()
    : spec.ends_at;

  const { data: event, error } = await db
    .from("events")
    .upsert(
      {
        tenant_id: TENANT,
        name: spec.name,
        slug: spec.slug,
        short_description: spec.short_description,
        description: spec.description,
        category_id: catId(spec.category),
        starts_at: seedStartsAt,
        ends_at: seedEndsAt,
        capacity: spec.capacity,
        status: needsSeedWindow ? "publicado" : spec.status,
        registrations_open: needsSeedWindow ? true : spec.registrations_open,
        venue_name: spec.venue_name,
        address: spec.address,
        address_number: spec.address_number ?? null,
        district: spec.district ?? null,
        city: spec.city,
        state: spec.state,
        zip_code: spec.zip_code ?? null,
        // geography aceita EWKT como texto — evita precisar de uma RPC só para isto.
        location: `SRID=4326;POINT(${spec.lng} ${spec.lat})`,
        google_maps_url: `https://maps.google.com/?q=${spec.lat},${spec.lng}`,
        organizer_name: ORGANIZER,
        contact_email: CONTACT_EMAIL,
        contact_phone: CONTACT_PHONE,
        ...(current || spec.status === "rascunho"
          ? {}
          : { published_at: new Date().toISOString() }),
      },
      { onConflict: "tenant_id,slug" },
    )
    .select("id")
    .single();

  if (error) {
    console.error(`  ✗ ${spec.name}: ${error.message}`);
    continue;
  }

  // Arte emprestada de outra parada, só enquanto a própria não tem: um upload
  // feito pelo painel nunca é sobrescrito por uma execução do seed.
  if (spec.art_from && !current?.cover_url && !current?.banner_url) {
    const art = artOf(spec.art_from);
    if (art?.cover_url) {
      await db
        .from("events")
        .update({ cover_url: art.cover_url, banner_url: art.banner_url })
        .eq("id", event.id);
    }
  }

  // Conteúdo da landing. Só nasce uma vez: recriar a cada execução geraria
  // duplicatas, já que estas tabelas não têm chave natural.
  const { count: hasContent } = await db
    .from("event_schedule_items")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id);

  if (!hasContent) {
    const base = { tenant_id: TENANT, event_id: event.id };
    await db.from("event_schedule_items").insert(scheduleFor(spec).map((s) => ({ ...base, ...s })));
    await db.from("event_speakers").insert(SPEAKERS.map((s) => ({ ...base, ...s })));
    await db.from("event_faqs").insert(faqsFor(spec).map((f) => ({ ...base, ...f })));
    await db.from("event_documents").insert(DOCUMENTS.map((d) => ({ ...base, ...d })));
  }

  // Inscrições. Cada parada tem a sua faixa de CPF sintético: assim o seed de
  // uma parada nova não reescreve o cadastro de quem já está no banco por
  // outra, e rodar de novo cai exatamente nas mesmas pessoas.
  let created = 0;
  for (let i = 0; i < toCreate; i++) {
    const seed = (index + 1) * 1000 + i + 1;
    const [city, state] = pick(CITIES, seed);
    const { error: regError } = await db.rpc("create_registration", {
      p_event_id: event.id,
      p_attendee: {
        first_name: pick(FIRST, seed),
        last_name: pick(LAST, seed * 3),
        cpf: makeCpf(seed),
        email: `participante${seed}@exemplo.com.br`,
        phone: `1199${String(1000000 + seed).slice(0, 7)}`,
        city,
        state,
      },
      p_consents: [
        { type: "lgpd", version: 1, accepted: true },
        { type: "regulamento", version: 1, accepted: true },
      ],
      p_context: { source: "seed", ip: "127.0.0.1", user_agent: "seed-demo" },
    });

    if (regError) {
      console.error(`  ✗ inscrição: ${regError.message}`);
      break;
    }
    created++;
  }

  // Check-ins. A assinatura fica gravada no ingresso; o token é `code.signature`.
  let checked = 0;
  if (toCheckin) {
    const { data: tickets } = await db
      .from("tickets")
      .select("code, signature")
      .eq("event_id", event.id)
      .eq("status", "valido")
      .limit(toCheckin);

    for (const t of tickets ?? []) {
      const { data: result, error: ciError } = await db.rpc("checkin", {
        p_token: `${t.code}.${t.signature}`,
        p_context: { source: "seed", ip: "127.0.0.1" },
      });
      if (!ciError && result?.result === "sucesso") checked++;
    }
  }

  // Data e status definitivos, depois de a RPC ter feito o seu trabalho.
  if (needsSeedWindow) {
    await db
      .from("events")
      .update({
        starts_at: spec.starts_at,
        ends_at: spec.ends_at,
        status: spec.status,
        registrations_open: spec.registrations_open,
      })
      .eq("id", event.id);
  }

  totalRegs += created;
  totalCheckins += checked;

  console.log(
    `  · ${spec.name.padEnd(44)} ${spec.starts_at.slice(0, 10)}` +
      (created ? ` · +${created} inscritos` : " · em dia") +
      (checked ? ` · +${checked} check-ins` : ""),
  );
}

console.log(`\n✓ Demonstração pronta — +${totalRegs} inscrições, +${totalCheckins} check-ins\n`);
