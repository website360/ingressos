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

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.auth.login;
    // Preserva o destino para retornar após o login.
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.admin.dashboard;
    url.search = "";
    return NextResponse.redirect(url);
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
