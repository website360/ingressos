import { PublicFooter } from "@/components/public/public-footer";
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

      <PublicFooter />
    </div>
  );
}
