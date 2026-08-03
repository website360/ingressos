import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Geocodificação reversa: coordenada do GPS → cidade/UF.
 *
 * Passa pelo servidor em vez de o navegador chamar o provedor direto por dois
 * motivos. O primeiro é de dados: aqui a coordenada é arredondada antes de sair
 * (2 casas ≈ 1 km, de sobra para acertar o município e insuficiente para
 * apontar um endereço), e o provedor nunca vê o IP nem o user-agent de quem
 * está navegando. O segundo é de custo: coordenada arredondada repete entre
 * visitantes da mesma região, então o cache de um dia atende quase todo mundo
 * sem uma chamada externa.
 */
const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const PROVIDER = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const CACHE_SECONDS = 86_400;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    lat: searchParams.get("lat"),
    lng: searchParams.get("lng"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Coordenada inválida." }, { status: 400 });
  }

  const latitude = parsed.data.lat.toFixed(2);
  const longitude = parsed.data.lng.toFixed(2);

  try {
    const response = await fetch(
      `${PROVIDER}?latitude=${latitude}&longitude=${longitude}&localityLanguage=pt`,
      { next: { revalidate: CACHE_SECONDS }, signal: AbortSignal.timeout(5000) },
    );

    if (!response.ok) throw new Error(`Provedor respondeu ${response.status}`);

    const data = (await response.json()) as {
      city?: string;
      locality?: string;
      principalSubdivisionCode?: string;
      countryCode?: string;
      localityInfo?: { administrative?: { adminLevel?: number; name?: string }[] };
    };

    /*
      O campo `city` não serve no Brasil: em São Paulo ele devolve "Região
      Metropolitana de São Paulo", e o evento está cadastrado como "São Paulo".
      O nível 8 da hierarquia administrativa do OpenStreetMap é o município, que
      é a unidade que a pessoa reconhece e a que o cadastro usa. `locality`
      costuma trazer o mesmo valor e entra como reserva.
    */
    const municipality = data.localityInfo?.administrative?.find(
      (level) => level.adminLevel === 8,
    )?.name;

    const city = municipality?.trim() || data.locality?.trim() || data.city?.trim() || null;

    // "BR-SP" → "SP". Só interessa a sigla, que é como o evento guarda o estado.
    const state = data.principalSubdivisionCode?.split("-")[1]?.trim() || null;

    if (!city) {
      return NextResponse.json(
        { error: "Não foi possível identificar a cidade." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { city, state, country: data.countryCode ?? null },
      { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } },
    );
  } catch {
    // Localização é conveniência, nunca requisito: o site funciona inteiro sem
    // ela, então a falha do provedor vira um aviso discreto e não um erro.
    return NextResponse.json(
      { error: "Serviço de localização indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
