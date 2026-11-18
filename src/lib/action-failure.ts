import { toast } from "sonner";

/**
 * Falha de TRANSPORTE de uma Server Action: a chamada nem chegou a devolver
 * `Result`. Na prática, quase sempre é o sistema atualizado com a aba aberta —
 * o navegador chama uma versão da ação que o servidor já não tem. Recarregar
 * resolve; o aviso diz isso em vez de derrubar a tela.
 */
export function toastActionFailure(error: unknown) {
  console.error("[action-failure]", error);
  toast.error(
    "Não foi possível falar com o servidor. Se o sistema acabou de ser atualizado, recarregue a página — o que já foi salvo não se perde.",
    {
      duration: 20_000,
      action: { label: "Recarregar", onClick: () => window.location.reload() },
    },
  );
}
