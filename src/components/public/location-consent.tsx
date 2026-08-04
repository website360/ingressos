"use client";

import * as React from "react";

import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Decisão anterior de quem já respondeu — para não perguntar de novo a cada visita. */
const CHAVE = "ingressos:localizacao-perguntada";

/**
 * Espera antes de aparecer.
 *
 * Modal que abre junto com a página é lido como anúncio e fechado no reflexo,
 * antes de alguém ler uma palavra. Um segundo e meio é o suficiente para a
 * pessoa ver que chegou num site de eventos — e aí a pergunta tem contexto.
 */
const ESPERA_MS = 1500;

interface Props {
  /** Dispara o pedido nativo do navegador. Só pode ser chamado por gesto do usuário. */
  onPermitir: () => void;
}

/**
 * Preparo para o pedido de localização do navegador.
 *
 * O pop-up nativo aparece sem contexto, some rápido e não explica nada — quem
 * não entende nega por reflexo, e a negativa fica gravada para a origem
 * inteira: não dá para perguntar de novo, nem nas próximas visitas. Este passo
 * existe para que o pedido nativo só apareça depois de a pessoa saber para que
 * serve e ter dito que sim.
 *
 * Por isso ele não aparece quando já há resposta: com permissão concedida não
 * há o que pedir, e com permissão negada o navegador nem exibiria o pop-up —
 * insistir seria só um modal sem efeito.
 */
export function LocationConsent({ onPermitir }: Props) {
  const [aberto, setAberto] = React.useState(false);

  React.useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function avaliar() {
      if (localStorage.getItem(CHAVE)) return;

      // A consulta de permissão não existe em todo navegador; sem ela, o
      // caminho é perguntar — no pior caso a pessoa vê o convite uma vez.
      try {
        const permissao = await navigator.permissions?.query({ name: "geolocation" });
        if (permissao && permissao.state !== "prompt") {
          localStorage.setItem(CHAVE, permissao.state);
          return;
        }
      } catch {
        // Segue para o convite.
      }

      if (ativo) timer = setTimeout(() => setAberto(true), ESPERA_MS);
    }

    void avaliar();
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, []);

  function responder(permitiu: boolean) {
    localStorage.setItem(CHAVE, permitiu ? "aceito" : "recusado");
    setAberto(false);
    // O pedido nativo precisa sair do gesto de clique: adiar quebraria isso em
    // parte dos navegadores, que exigem que a chamada venha da própria ação.
    if (permitiu) onPermitir();
  }

  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && responder(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MapPin className="size-5" />
          </span>
          <DialogTitle>Mostrar os eventos perto de você?</DialogTitle>
          <DialogDescription>
            Se você permitir, usamos sua localização para indicar a cidade onde a visita acontece
            mais perto e já preencher cidade e estado na hora da inscrição.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Em seguida o navegador vai pedir sua confirmação. Você pode recusar agora e usar o site
          normalmente — a agenda completa continua visível.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => responder(false)}>
            Agora não
          </Button>
          <Button onClick={() => responder(true)}>
            <MapPin /> Permitir localização
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
