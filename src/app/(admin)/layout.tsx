import { redirect } from "next/navigation";

import { CommandPalette } from "@/components/layout/command-palette";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ROUTES } from "@/constants/routes";
import { getSession } from "@/lib/auth/session";
import { AdminProviders } from "@/providers";

/**
 * Layout do painel administrativo.
 * A sessão é resolvida no servidor e hidratada nos providers — o cliente não
 * refaz a consulta no boot.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect(ROUTES.auth.login);

  // Usuário autenticado sem nenhuma empresa não tem painel para ver.
  if (session.tenants.length === 0) redirect(ROUTES.auth.selectTenant);

  return (
    <AdminProviders session={session}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar className="hidden lg:flex" />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {/* Full width: o painel usa toda a largura disponível, sem container
              centralizado. Tabelas de participantes e check-ins são o conteúdo
              principal do sistema e ganham diretamente com isso. */}
          <main className="flex-1 overflow-y-auto">
            <div className="w-full p-4 sm:p-6">{children}</div>
          </main>
        </div>
      </div>

      <CommandPalette />
    </AdminProviders>
  );
}
