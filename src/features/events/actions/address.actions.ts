"use server";

import { fail, ok, type Result } from "@/lib/errors";

export interface AddressLookup {
  address: string;
  district: string;
  city: string;
  state: string;
  zip_code: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Consulta de CEP com coordenadas.
 *
 * Roda no servidor, não no navegador, por dois motivos:
 *  · o Nominatim exige User-Agent identificando a aplicação e limita a 1
 *    requisição por segundo — política que não dá para respeitar a partir de
 *    milhares de navegadores;
 *  · uma chamada só do cliente em vez de duas, e sem depender de CORS alheio.
 *
 * O ViaCEP é gratuito e sem chave. Se a geocodificação falhar, o endereço ainda
 * é devolvido — coordenada é para o geofence do check-in, não para salvar o
 * evento, e não pode bloquear o cadastro.
 */
export async function lookupCep(rawCep: string): Promise<Result<AddressLookup>> {
  try {
    const cep = rawCep.replace(/\D/g, "");

    if (cep.length !== 8) {
      return fail(new Error("CEP deve ter 8 dígitos."));
    }

    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      // CEP não muda: vale cachear por bastante tempo.
      next: { revalidate: 60 * 60 * 24 * 30 },
    });

    if (!response.ok) throw new Error("Serviço de CEP indisponível.");

    const data = (await response.json()) as {
      erro?: boolean | string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      cep?: string;
    };

    if (data.erro) {
      return fail(new Error("CEP não encontrado."));
    }

    const result: AddressLookup = {
      address: data.logradouro ?? "",
      district: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
      zip_code: cep,
      latitude: null,
      longitude: null,
    };

    const coords = await geocode(result);
    if (coords) {
      result.latitude = coords.latitude;
      result.longitude = coords.longitude;
    }

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}

/** Coordenadas do endereço via Nominatim (OpenStreetMap). Falha em silêncio. */
async function geocode(
  address: AddressLookup,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const query = [address.address, address.district, address.city, address.state, "Brasil"]
      .filter(Boolean)
      .join(", ");

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "br");

    const response = await fetch(url, {
      headers: {
        // Exigido pela política de uso do Nominatim.
        "User-Agent": "Ingressos/1.0 (gestao de eventos)",
        "Accept-Language": "pt-BR",
      },
      next: { revalidate: 60 * 60 * 24 * 7 },
    });

    if (!response.ok) return null;

    const results = (await response.json()) as { lat: string; lon: string }[];
    const first = results[0];
    if (!first) return null;

    return { latitude: Number(first.lat), longitude: Number(first.lon) };
  } catch {
    return null;
  }
}
