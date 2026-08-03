"use client";

import * as React from "react";

import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { IMAGE_MAX_BYTES, IMAGE_TYPES } from "@shared/schemas/event-content";

import { Button } from "@/components/ui/button";
import { removeEventImage, uploadEventImage } from "@/features/events/actions/content.actions";

interface Props {
  eventId: string;
  kind: "cover" | "banner";
  label: string;
  hint: string;
  currentUrl: string | null;
}

/**
 * Envio de imagem em linha, com miniatura.
 *
 * A pré-visualização em tamanho real estica o cartão e desalinha o formulário —
 * e não ajuda: quem quer conferir o enquadramento abre a página pública. Aqui
 * basta saber se existe imagem e poder trocá-la.
 */
export function ImageUpload({ eventId, kind, label, hint, currentUrl }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [url, setUrl] = React.useState(currentUrl);
  const [isUploading, setIsUploading] = React.useState(false);

  async function handleFile(file: File) {
    // Valida antes de subir: recusar 8 MB depois do upload é desperdiçar o
    // tempo de quem está numa conexão ruim.
    if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) {
      toast.error("Formato não suportado. Use JPG, PNG, WebP ou AVIF.");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error("A imagem deve ter no máximo 8 MB.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setIsUploading(true);
    try {
      const result = await uploadEventImage(eventId, kind, formData);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setUrl(result.data.url);
      toast.success(`${label} atualizada.`);
    } catch {
      // Erro lançado pelo framework — 413, rede caída, servidor reiniciando.
      // Sem este catch, a exceção escapa e o indicador fica girando para sempre.
      toast.error("Falha no envio. Verifique sua conexão e tente novamente.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRemove() {
    setIsUploading(true);
    try {
      const result = await removeEventImage(eventId, kind);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setUrl(null);
      toast.success(`${label} removida.`);
    } catch {
      toast.error("Não foi possível remover a imagem. Tente novamente.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      {/* Miniatura em caixa fixa: banner 16:6 e capa 16:9 ocupam o mesmo espaço
          na tela, então as duas linhas ficam alinhadas. */}
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground/50">
            <ImageIcon className="size-4" />
          </span>
        )}

        {isUploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="size-4 animate-spin text-primary" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      <div className="flex shrink-0 gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
        >
          <Upload /> {url ? "Trocar" : "Enviar"}
        </Button>

        {url && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleRemove}
            disabled={isUploading}
            aria-label={`Remover ${label.toLowerCase()}`}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
