import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/**
 * Graph API da Meta, simulada. Nenhum teste fala com a Meta de verdade.
 *
 * `script` decide a resposta de cada requisição: status e corpo, atraso, ou
 * `hang` (recebe e nunca responde — o "timeout depois de enviado") e
 * `destroy` (derruba a conexão sem responder).
 */
export interface MockRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
  at: number;
}

export interface MockReply {
  status?: number;
  body?: unknown;
  delayMs?: number;
  hang?: boolean;
  destroy?: boolean;
}

export interface MockMeta {
  url: string;
  requests: MockRequest[];
  close(): Promise<void>;
}

let wamidCounter = 0;

export function okReply(): MockReply {
  wamidCounter += 1;
  return {
    status: 200,
    body: {
      messaging_product: "whatsapp",
      contacts: [{ input: "x", wa_id: "x" }],
      messages: [{ id: `wamid.TESTE${Date.now().toString(36)}${wamidCounter}` }],
    },
  };
}

export function errorReply(status: number, code: number, message = "erro simulado"): MockReply {
  return { status, body: { error: { message, type: "OAuthException", code } } };
}

export async function startMockMeta(
  opts: { latencyMs?: number; script?: (req: MockRequest, index: number) => MockReply } = {},
): Promise<MockMeta> {
  const requests: MockRequest[] = [];
  const sockets = new Set<Socket>();

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        // multipart ou texto: guarda cru
      }
      const record: MockRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body,
        at: Date.now(),
      };
      requests.push(record);
      const reply = opts.script ? opts.script(record, requests.length - 1) : okReply();

      if (reply.hang) return;
      if (reply.destroy) {
        req.socket.destroy();
        return;
      }
      const send = () => {
        res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reply.body ?? {}));
      };
      const delay = (reply.delayMs ?? 0) + (opts.latencyMs ?? 0);
      if (delay > 0) setTimeout(send, delay);
      else send();
    });
  });

  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
