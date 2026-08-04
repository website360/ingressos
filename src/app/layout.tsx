import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";

import { AppProviders } from "@/providers";

import "./globals.css";

/** Design System — seção 2. Fontes expostas como CSS variables. */
const sans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ingressos — Gestão de Eventos",
    template: "%s · Ingressos",
  },
  description:
    "Plataforma completa para criar eventos, gerenciar inscrições, emitir ingressos com QR Code e controlar o check-in.",
  applicationName: "Ingressos",
  formatDetection: { telephone: false },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#070d1c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={sans.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
