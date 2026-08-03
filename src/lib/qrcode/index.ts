import "server-only";

import QRCode from "qrcode";

/**
 * QR Code do ingresso.
 *
 * O conteúdo é o token assinado (`código.assinatura`) — nenhum dado pessoal
 * viaja na imagem. Nível de correção de erro M: tolera ~15% de dano, o que
 * cobre tela riscada, brilho e impressão ruim sem inflar o código.
 */
export async function ticketQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** Versão SVG — usada no PDF, onde vetor imprime melhor que bitmap. */
export async function ticketQrSvg(token: string): Promise<string> {
  return QRCode.toString(token, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}
