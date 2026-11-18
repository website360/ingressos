import { NextResponse } from "next/server";

import QRCode from "qrcode";

import { publicRepository } from "@/repositories/public.repository";

/**
 * QR Code do ingresso como imagem — o cabeçalho do modelo de confirmação no
 * WhatsApp aponta para cá (a Meta busca a imagem pelo link no envio).
 *
 * Uma chamada à Meta por mensagem, em vez de duas (subir a mídia e depois
 * enviar). O token assinado é a credencial: `get_ticket` confere a assinatura
 * antes de qualquer coisa, e token inválido é 404. A imagem só contém o
 * próprio token — nenhum dado pessoal.
 *
 * Cache de um dia: a Meta e os clientes do WhatsApp buscam de novo ao
 * reabrir a conversa. O QR de um ingresso cancelado continua sendo só um
 * token; quem decide na entrada é o check-in, que consulta a situação.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!/^[A-Za-z0-9._-]{8,200}$/.test(token)) {
    return new NextResponse("Ingresso não encontrado.", { status: 404 });
  }

  const ticket = await publicRepository.getTicket(token);
  if (!ticket) {
    return new NextResponse("Ingresso não encontrado.", { status: 404 });
  }

  const png = await QRCode.toBuffer(token, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 10,
    color: { dark: "#000000", light: "#ffffff" },
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
