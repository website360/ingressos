import type { MetadataRoute } from "next";

/**
 * Manifesto PWA.
 *
 * `start_url` aponta para o check-in: quem instala o aplicativo na tela inicial
 * é o recepcionista, não o administrador — o painel é usado no computador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ingressos — Gestão de Eventos",
    short_name: "Ingressos",
    description: "Check-in de eventos com leitura de QR Code e operação offline.",
    start_url: "/checkin",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    lang: "pt-BR",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
