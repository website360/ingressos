import { NextResponse, type NextRequest } from "next/server";

import { ROUTES } from "@/constants/routes";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Callback do Supabase Auth (magic link, recuperação de senha, convite).
 * Troca o `code` PKCE por uma sessão e redireciona para o destino interno.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

  // Só aceitamos caminhos internos — bloqueia open redirect.
  const next =
    nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : ROUTES.admin.dashboard;

  if (!code) {
    return NextResponse.redirect(`${origin}${ROUTES.auth.login}?error=codigo_ausente`);
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}${ROUTES.auth.login}?error=link_invalido`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
