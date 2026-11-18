/**
 * Destino da Graph API do worker.
 *
 * `META_BASE_URL` existe só para homologação e carga contra um simulador. Como
 * o token de acesso vai em toda requisição, um valor errado ou malicioso aqui
 * entregaria a credencial a terceiros — por isso só passam endereços de
 * loopback (o simulador na própria máquina) ou a Graph API oficial por HTTPS.
 * Qualquer outro valor impede o worker de subir.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function resolveMetaBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("META_BASE_URL inválida.");
  }
  const loopback = LOOPBACK.has(url.hostname) && (url.protocol === "http:" || url.protocol === "https:");
  const official = url.protocol === "https:" && url.hostname === "graph.facebook.com";
  if (!loopback && !official) {
    throw new Error(
      "META_BASE_URL só aceita loopback (simulador) ou https://graph.facebook.com — o token iria junto.",
    );
  }
  return raw;
}
