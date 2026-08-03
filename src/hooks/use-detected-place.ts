"use client";

import * as React from "react";

import { useGeolocation } from "@/hooks/use-geolocation";

export interface DetectedPlace {
  city: string;
  state: string | null;
  /** "São Paulo/SP" — mesmo formato que o evento usa na listagem. */
  label: string;
}

type PlaceState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; place: DetectedPlace }
  | { status: "failed"; message: string };

/**
 * Onde a pessoa está, em nome de cidade.
 *
 * A permissão nunca é pedida sozinha: o navegador guarda a negativa por origem,
 * e um pop-up disparado no carregamento — sem a pessoa ter pedido nada — é o
 * jeito mais rápido de queimar a permissão para sempre. Quando ela já tiver
 * sido concedida em uma visita anterior, aí sim a consulta acontece direto, sem
 * novo clique: a decisão já foi tomada.
 */
export function useDetectedPlace() {
  const { state: geo, request } = useGeolocation(false);
  const [place, setPlace] = React.useState<PlaceState>({ status: "idle" });

  React.useEffect(() => {
    if (!navigator.permissions?.query) return;

    let active = true;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (active && permission.state === "granted") request();
      })
      .catch(() => {
        // Firefox antigo e Safari rejeitam a consulta para geolocation; sem a
        // resposta, o caminho é o mesmo de quem nunca autorizou: espera o clique.
      });

    return () => {
      active = false;
    };
  }, [request]);

  React.useEffect(() => {
    if (geo.status === "locating") {
      setPlace({ status: "locating" });
      return;
    }

    if (geo.status === "denied" || geo.status === "unavailable") {
      setPlace({ status: "failed", message: geo.message });
      return;
    }

    if (geo.status !== "granted") return;

    const controller = new AbortController();
    const { latitude, longitude } = geo.position;

    setPlace({ status: "locating" });

    fetch(`/api/geo/reverse?lat=${latitude}&lng=${longitude}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { city?: string; state?: string; error?: string };
        if (!response.ok || !data.city) throw new Error(data.error ?? "Localização indisponível.");

        setPlace({
          status: "ready",
          place: {
            city: data.city,
            state: data.state ?? null,
            label: data.state ? `${data.city}/${data.state}` : data.city,
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPlace({
          status: "failed",
          message: error instanceof Error ? error.message : "Localização indisponível.",
        });
      });

    return () => controller.abort();
  }, [geo]);

  return { state: place, request };
}
