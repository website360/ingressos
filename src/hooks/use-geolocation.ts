"use client";

import * as React from "react";

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "granted"; position: GeoPosition }
  | { status: "denied" | "unavailable"; message: string };

/**
 * Geolocalização do check-in.
 *
 * Nunca bloqueia a operação: negar a permissão ou não ter sinal registra o
 * check-in sem coordenadas e sinaliza no painel. Portaria travada por GPS é
 * pior do que auditoria incompleta.
 */
export function useGeolocation(enabled = true) {
  const [state, setState] = React.useState<GeoState>({ status: "idle" });

  const request = React.useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "unavailable", message: "Este dispositivo não informa localização." });
      return;
    }

    setState({ status: "locating" });

    navigator.geolocation.getCurrentPosition(
      (position) =>
        setState({
          status: "granted",
          position: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        }),
      (error) =>
        setState({
          status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
          message:
            error.code === error.PERMISSION_DENIED
              ? "Permissão de localização negada."
              : "Não foi possível obter a localização.",
        }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  React.useEffect(() => {
    if (enabled) request();
  }, [enabled, request]);

  return {
    state,
    request,
    position: state.status === "granted" ? state.position : null,
  };
}
