import { PublicHeader } from "@/components/public/public-header";

/**
 * Layout da área pública — sem sessão, sem menu administrativo.
 * Segue o mesmo Design System, mas com respiro maior: quem chega aqui está
 * decidindo se vai ao evento, não operando um sistema.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-surface flex min-h-dvh flex-col bg-background">
      <PublicHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t py-8">
        <div className="mx-auto w-full max-w-6xl px-4 text-center text-xs text-muted-foreground">
          <p>
            Seus dados são tratados conforme a Lei Geral de Proteção de Dados (LGPD) e utilizados
            exclusivamente para a gestão da sua participação no evento.
          </p>
        </div>
      </footer>
    </div>
  );
}
