import { type NextRequest, NextResponse } from "next/server";

import { AUTH_ROUTES, PROTECTED_PREFIXES, ROUTES } from "@/constants/routes";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Middleware — três responsabilidades, nesta ordem:
 *  1. renovar a sessão (cookies do Supabase);
 *  2. redirecionar rota protegida sem sessão e rota de auth com sessão;
 *  3. propagar `x-request-id` para correlacionar log ↔ auditoria (docs/02, seção 14).
 *
 * Isto é UX e defesa em profundidade — a segurança real está na RLS (docs/07).
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

  /**
   * Redirect para a origem por onde a pessoa realmente chegou.
   *
   * Atrás de proxy, `request.nextUrl` volta apontando para localhost:3000 — o
   * Next não reconstrói a origem a partir do `Host`. Sem isto, quem tenta
   * abrir o painel é mandado para a própria máquina. E `Location` relativo não
   * resolve: o middleware do Next exige URL absoluta e rejeita o resto.
   *
   * Confiar no cabeçalho pede que o servidor da frente só aceite hosts
   * conhecidos — o vhost em deploy/nginx tem um `default_server` que descarta
   * requisição com Host desconhecido, senão isto vira redirect aberto.
   *
   * Os cookies vêm do `response` de propósito: o refresh de sessão acontece no
   * `updateSession`, e uma resposta nova os descartaria — a pessoa seria
   * deslogada exatamente no redirect que deveria levá-la ao login.
   */
  function redirecionar(caminho: string, busca = "") {
    const url = request.nextUrl.clone();
    const hostReal = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

    if (hostReal) {
      url.protocol = `${request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}:`;
      url.host = hostReal;
    }

    url.pathname = caminho;
    url.search = busca;

    const saida = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => saida.cookies.set(cookie));
    saida.headers.set("x-request-id", requestId);
    return saida;
  }

  if (isProtected && !user) {
    // Preserva o destino para retornar após o login.
    return redirecionar(
      ROUTES.auth.login,
      `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`,
    );
  }

  if (isAuthRoute && user) {
    return redirecionar(ROUTES.admin.dashboard);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Tudo, exceto:
     *  - _next/static, _next/image, favicon
     *  - arquivos com extensão (imagens, fontes, manifest, service worker)
     *  - /api (rotas cuidam da própria autenticação por Bearer token)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|json|webmanifest|js)$).*)",
  ],
};
