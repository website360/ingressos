"use client";

import * as React from "react";

import { Camera, CameraOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

interface Props {
  onDetect: (value: string) => void;
  /** Pausa a leitura enquanto o resultado anterior está na tela. */
  paused: boolean;
}

/**
 * Scanner de QR Code.
 *
 * Usa o BarcodeDetector nativo — sem biblioteca de decodificação, o que
 * significa nenhum WASM para baixar no 4G da portaria. Navegadores sem suporte
 * caem na busca manual, que é a única alternativa honesta: um fallback lento
 * numa fila de entrada é pior do que digitar o CPF.
 */
export function QrScanner({ onDetect, paused }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [state, setState] = React.useState<"idle" | "starting" | "running" | "error">("idle");
  const [message, setMessage] = React.useState<string>("");
  const [supported, setSupported] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState("idle");
  }, []);

  const start = React.useCallback(async () => {
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Câmera traseira: a portaria aponta o aparelho para o QR do participante.
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("running");
    } catch {
      setState("error");
      setMessage("Não foi possível acessar a câmera. Verifique a permissão do navegador.");
    }
  }, []);

  React.useEffect(() => stop, [stop]);

  // Laço de detecção: um quadro por vez, com pausa entre leituras.
  React.useEffect(() => {
    if (state !== "running" || paused || !supported) return;

    let active = true;
    const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });

    async function tick() {
      if (!active || !videoRef.current || videoRef.current.readyState < 2) {
        if (active) requestAnimationFrame(tick);
        return;
      }

      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0 && codes[0]?.rawValue) {
          onDetect(codes[0].rawValue);
          return; // `paused` sobe e o laço encerra até o operador liberar.
        }
      } catch {
        // Quadro ilegível é normal — segue para o próximo.
      }

      if (active) setTimeout(tick, 150);
    }

    tick();
    return () => {
      active = false;
    };
  }, [state, paused, supported, onDetect]);

  if (supported === false) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <CameraOff className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Leitura por câmera indisponível</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Este navegador não suporta leitura de QR Code. Use a busca por CPF ou nome — é igualmente
          rápida.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-foreground/90">
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn("size-full object-cover", state !== "running" && "opacity-0")}
        />

        {/* Alvo: enquadrar dentro do quadrado acelera a leitura. */}
        {state === "running" && !paused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="size-56 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}

        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            {state === "starting" ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <>
                <Camera className="size-8 opacity-80" />
                <Button onClick={start} size="lg">
                  Ativar câmera
                </Button>
                {state === "error" && (
                  <p className="max-w-xs px-6 text-center text-sm text-white/80">{message}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {state === "running" && (
        <Button variant="outline" size="sm" onClick={stop} className="w-full">
          <CameraOff /> Desligar câmera
        </Button>
      )}
    </div>
  );
}
