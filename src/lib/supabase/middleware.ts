import { type NextRequest, NextResponse } from "next/server";

import { createServerClient, type CookieOptions } from "@supabase/ssr";

import type { Database } from "./database.types";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Renova a sessão a cada requisição e devolve a resposta com os cookies
 * atualizados. Server Components não podem escrever cookies — por isso o
 * refresh precisa acontecer aqui.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalida o token no servidor — getSession() confiaria no cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
