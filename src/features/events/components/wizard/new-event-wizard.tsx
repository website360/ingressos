"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Save, Send, SkipForward } from "lucide-react";

import { eventSchema, publishRequirements, type EventInput } from "@shared/schemas/event";
import {
  eventContentSchema,
  faqSchema,
  type EventContentInput,
} from "@shared/schemas/event-content";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { ROUTES } from "@/constants/routes";
import { saveEventContentSection } from "@/features/events/actions/content.actions";
import { createEvent, updateEvent } from "@/features/events/actions/event.actions";
import {
  DocumentsSection,
  ScheduleSection,
  SpeakersSection,
} from "@/features/events/components/event-content-sections";
import {
  EventCapacityField,
  EventDateFields,
  EventDescriptionFields,
  EventLocationFields,
  EventNameField,
  EventRegistrationFields,
  EventSlugField,
} from "@/features/events/components/event-fields";
import { ImageUpload } from "@/features/events/components/image-upload";
import { FaqStep } from "@/features/events/components/wizard/faq-step";
import {
  WIZARD_STEPS,
  type StepStatus,
  type WizardStep,
} from "@/features/events/components/wizard/wizard-steps";
import { contentFormDefaults, eventFormDefaults } from "@/features/events/lib/event-defaults";
import {
  buildEventFaqs,
  duplicatedChoices,
  initialFaqChoices,
  newTemplatesFrom,
  type FaqChoice,
} from "@/features/events/lib/faq-selection";
import { addFaqTemplates } from "@/features/settings/actions/faq-template.actions";
import { cn, slugify } from "@/lib/utils";

export interface WizardTemplate {
  id: string;
  question: string;
  answer: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: WizardTemplate[];
  canPublish: boolean;
  canManageSettings: boolean;
}

/**
 * Remonta o assistente a cada abertura: começar do zero é o esperado.
 *
 * Esc e o X do Dialog não fecham direto: passam pelo `requestClose` da etapa,
 * que avisa sobre alteração não salva e sobre o rascunho já criado.
 */
export function NewEventWizard(props: Props) {
  const [generation, setGeneration] = React.useState(0);
  const closeRequest = React.useRef<(() => void) | null>(null);

  const close = React.useCallback(() => {
    props.onOpenChange(false);
    setGeneration((g) => g + 1);
  }, [props]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) props.onOpenChange(true);
        else if (closeRequest.current) closeRequest.current();
        else close();
      }}
    >
      {props.open && (
        <WizardBody
          key={generation}
          {...props}
          close={close}
          registerCloseRequest={(fn) => (closeRequest.current = fn)}
        />
      )}
    </Dialog>
  );
}

interface BodyProps extends Props {
  close: () => void;
  registerCloseRequest: (fn: () => void) => void;
}

function WizardBody({
  templates,
  canPublish,
  canManageSettings,
  close,
  registerCloseRequest,
}: BodyProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [eventId, setEventId] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState(0);
  const [status, setStatus] = React.useState<StepStatus[]>(() => WIZARD_STEPS.map(() => "pending"));
  const [images, setImages] = React.useState<{ banner: string | null; cover: string | null }>({
    banner: null,
    cover: null,
  });

  // As perguntas padrão já foram copiadas para o evento na criação, então o
  // ponto de partida é "todas marcadas".
  const [savedFaqs, setSavedFaqs] = React.useState<FaqChoice[]>(() =>
    initialFaqChoices(templates, templates),
  );
  const [faqs, setFaqs] = React.useState<FaqChoice[]>(savedFaqs);
  const [faqErrors, setFaqErrors] = React.useState<Record<number, string>>({});

  const eventForm = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: eventFormDefaults(),
  });
  const contentForm = useForm<EventContentInput>({
    resolver: zodResolver(eventContentSchema),
    defaultValues: contentFormDefaults(),
  });

  // O react-hook-form só calcula `isDirty`/`dirtyFields` para quem os lê durante
  // a renderização. Sem estas leituras, os handlers abaixo veriam sempre
  // "nada mudou" — e o "Próximo" seguiria sem salvar.
  const eventDirty = eventForm.formState.isDirty;
  const slugTouched = Boolean(eventForm.formState.dirtyFields.slug);
  const contentDirty = contentForm.formState.isDirty;

  // Enquanto o evento não existe, o endereço na web acompanha o nome — até a
  // pessoa mexer nele.
  const name = eventForm.watch("name");
  React.useEffect(() => {
    if (!eventId && !slugTouched && name) {
      eventForm.setValue("slug", slugify(name));
    }
  }, [name, eventId, slugTouched, eventForm]);

  const step = WIZARD_STEPS[current]!;
  const isLast = current === WIZARD_STEPS.length - 1;
  const faqsDirty = JSON.stringify(faqs) !== JSON.stringify(savedFaqs);

  function isStepDirty(target: WizardStep): boolean {
    if (target.kind === "event" || target.kind === "review") return eventDirty;
    if (target.kind === "content") return contentDirty;
    if (target.kind === "faqs") return faqsDirty;
    return false;
  }

  /** Descarta o que foi digitado na etapa atual e volta ao último salvo. */
  function discardCurrent() {
    eventForm.reset();
    contentForm.reset();
    setFaqs(savedFaqs);
    setFaqErrors({});
  }

  /** Grava a etapa atual. `true` quando pode seguir. */
  async function saveCurrent(): Promise<boolean> {
    if (step.kind === "event" || step.kind === "review") {
      // Na etapa 1 sem evento ainda, salvar é criar — mesmo sem nada "sujo".
      if (eventId && !eventForm.formState.isDirty) return true;
      if (!(await eventForm.trigger(step.fields))) return false;

      const values = { ...eventForm.getValues(), status: "rascunho" as const };
      const result = eventId ? await updateEvent(eventId, values) : await createEvent(values);
      if (!result.ok) {
        if (/endereço|slug/i.test(result.error.message)) {
          eventForm.setError("slug", { message: result.error.message });
          setCurrent(0);
        } else {
          toast.error(result.error.message);
        }
        return false;
      }

      if (!eventId) {
        setEventId(result.data.id);
        toast.success("Rascunho criado. As próximas etapas podem ser puladas.");
      }
      eventForm.reset(eventForm.getValues());
      return true;
    }

    if (step.kind === "content") {
      if (!contentForm.formState.isDirty) return true;
      if (!(await contentForm.trigger(step.fields))) return false;

      const result = await saveEventContentSection(eventId!, step.section, contentForm.getValues());
      if (!result.ok) {
        toast.error(result.error.message);
        return false;
      }
      contentForm.reset(contentForm.getValues());
      return true;
    }

    if (step.kind === "faqs") {
      if (!faqsDirty) return true;

      const errors: Record<number, string> = {};
      faqs.forEach((choice, index) => {
        if (!choice.checked) return;
        const parsed = faqSchema.safeParse(choice);
        if (!parsed.success) errors[index] = parsed.error.issues[0]!.message;
      });
      for (const index of duplicatedChoices(faqs)) {
        errors[index] ??= "Esta pergunta já está na lista acima.";
      }
      setFaqErrors(errors);
      if (Object.keys(errors).length) return false;

      const toTemplate = newTemplatesFrom(faqs);
      if (toTemplate.length) {
        const saved = await addFaqTemplates({ items: toTemplate });
        if (!saved.ok) {
          toast.error(saved.error.message);
          return false;
        }
      }

      const result = await saveEventContentSection(eventId!, "faqs", {
        ...contentForm.getValues(),
        faqs: buildEventFaqs(faqs),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return false;
      }

      const committed = faqs.map((choice) => ({ ...choice, saveAsTemplate: false }));
      setFaqs(committed);
      setSavedFaqs(committed);
      if (toTemplate.length) {
        toast.success(
          toTemplate.length === 1
            ? "Pergunta salva também como padrão."
            : `${toTemplate.length} perguntas salvas também como padrão.`,
        );
      }
      return true;
    }

    return true;
  }

  function mark(index: number, value: StepStatus) {
    setStatus((list) => list.map((s, i) => (i === index ? value : s)));
  }

  function goNext() {
    startTransition(async () => {
      if (!(await saveCurrent())) return;
      mark(current, "done");
      setCurrent((c) => Math.min(c + 1, WIZARD_STEPS.length - 1));
    });
  }

  function skip() {
    discardCurrent();
    mark(current, "skipped");
    setCurrent((c) => Math.min(c + 1, WIZARD_STEPS.length - 1));
  }

  function goTo(index: number) {
    if (index === current) return;
    startTransition(async () => {
      // Pular de etapa pela lista não pode jogar fora o que foi digitado.
      if (isStepDirty(step)) {
        if (!(await saveCurrent())) return;
        mark(current, "done");
      }
      setCurrent(index);
    });
  }

  function finish(publish: boolean) {
    startTransition(async () => {
      // O assistente valida o evento inteiro na saída: um campo inválido de
      // etapa pulada já foi descartado, então o que sobrar é o que vai gravar.
      if (!(await eventForm.trigger())) return;

      const values = {
        ...eventForm.getValues(),
        status: publish ? ("publicado" as const) : ("rascunho" as const),
      };
      const result = await updateEvent(eventId!, values);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(publish ? "Evento publicado." : "Rascunho salvo.");
      close();
      router.push(ROUTES.admin.event(eventId!));
      router.refresh();
    });
  }

  function requestClose() {
    if (isStepDirty(step) && eventId) {
      const leave = window.confirm(
        "Há alterações nesta etapa que ainda não foram salvas. Fechar mesmo assim?",
      );
      if (!leave) return;
    }
    if (eventId) {
      toast("Rascunho salvo. Você pode continuar pela edição do evento.");
      router.refresh();
    }
    close();
  }
  registerCloseRequest(requestClose);

  const missing = publishRequirements(eventForm.watch());

  return (
    <DialogContent
      className="flex h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[90dvh] sm:max-w-5xl sm:rounded-xl"
      // Clique fora não fecha: perder o passo a passo por um clique errado
      // custa caro. Esc e o X continuam funcionando, com aviso.
      onInteractOutside={(e) => e.preventDefault()}
    >
      <header className="border-b px-5 py-4 pr-12">
        <DialogTitle>Novo evento</DialogTitle>
        <DialogDescription className="md:hidden">
          Etapa {current + 1} de {WIZARD_STEPS.length} · {step.title}
        </DialogDescription>
        <DialogDescription className="hidden md:block">
          Só a primeira etapa é obrigatória. As outras podem ser puladas e completadas depois.
        </DialogDescription>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Etapas" className="hidden w-56 shrink-0 border-r p-3 md:block">
          <ol className="space-y-0.5">
            {WIZARD_STEPS.map((item, index) => {
              const locked = !eventId && index > 0;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={locked || isPending}
                    onClick={() => goTo(index)}
                    aria-current={index === current ? "step" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      index === current
                        ? "bg-primary/10 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      locked && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <StepBadge index={index} status={status[index]!} active={index === current} />
                    {item.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <h2 className="mb-1 text-base font-semibold">{step.title}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{STEP_HINTS[step.id]}</p>

          {(step.kind === "event" || step.kind === "review") && (
            <Form {...eventForm}>
              <form noValidate onSubmit={(e) => e.preventDefault()} className="space-y-6">
                {step.id === "revisar" && (
                  <ReviewSummary missing={missing} status={status} canPublish={canPublish} />
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  {step.id === "essencial" && (
                    <>
                      <EventNameField form={eventForm} />
                      <EventSlugField form={eventForm} />
                      <EventDateFields form={eventForm} />
                      <EventCapacityField form={eventForm} />
                    </>
                  )}
                  {step.id === "descricao" && <EventDescriptionFields form={eventForm} />}
                  {step.id === "local" && <EventLocationFields form={eventForm} />}
                  {step.id === "revisar" && <EventRegistrationFields form={eventForm} />}
                </div>
              </form>
            </Form>
          )}

          {step.kind === "images" && eventId && (
            <div className="space-y-3">
              <ImageUpload
                eventId={eventId}
                kind="banner"
                label="Banner"
                hint="Topo da página do evento e compartilhamento em redes. Ideal: 1600×600."
                currentUrl={images.banner}
                onChange={(url) => setImages((i) => ({ ...i, banner: url }))}
              />
              <ImageUpload
                eventId={eventId}
                kind="cover"
                label="Capa"
                hint="Imagem do evento em cards e listagens. Ideal: 800×450."
                currentUrl={images.cover}
                onChange={(url) => setImages((i) => ({ ...i, cover: url }))}
              />
            </div>
          )}

          {step.kind === "content" && (
            <Form {...contentForm}>
              <form noValidate onSubmit={(e) => e.preventDefault()}>
                {step.section === "schedule" && <ScheduleSection form={contentForm} />}
                {step.section === "speakers" && <SpeakersSection form={contentForm} />}
                {step.section === "documents" && <DocumentsSection form={contentForm} />}
              </form>
            </Form>
          )}

          {step.kind === "faqs" && (
            <FaqStep
              choices={faqs}
              onChange={setFaqs}
              errors={faqErrors}
              canSaveTemplate={canManageSettings}
            />
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t px-5 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={current === 0 || isPending}
          onClick={() => goTo(current - 1)}
        >
          <ArrowLeft /> <span className="hidden sm:inline">Voltar</span>
        </Button>

        <div className="flex gap-2">
          {isLast ? (
            <>
              <Button
                type="button"
                variant="outline"
                loading={isPending}
                onClick={() => finish(false)}
              >
                <Save /> Salvar rascunho
              </Button>
              {canPublish && (
                <Button
                  type="button"
                  loading={isPending}
                  disabled={missing.length > 0}
                  onClick={() => finish(true)}
                >
                  <Send /> Publicar
                </Button>
              )}
            </>
          ) : (
            <>
              {current > 0 && (
                <Button type="button" variant="ghost" disabled={isPending} onClick={skip}>
                  <SkipForward /> Pular
                </Button>
              )}
              <Button type="button" loading={isPending} onClick={goNext}>
                {eventId ? "Próximo" : "Criar e continuar"} <ArrowRight />
              </Button>
            </>
          )}
        </div>
      </footer>
    </DialogContent>
  );
}

const STEP_HINTS: Record<string, string> = {
  essencial: "O mínimo para o evento existir. Ao continuar, ele é salvo como rascunho.",
  descricao: "Textos da página pública. A descrição curta é exigida para publicar.",
  local: "Comece pelo CEP: o endereço e as coordenadas do check-in são preenchidos sozinhos.",
  fotos: "O envio é imediato — não depende do botão de continuar.",
  programacao: "A linha do tempo exibida na página do evento, na ordem em que aparece aqui.",
  palestrantes: "Quem apresenta. Aparece em cards na página do evento.",
  perguntas: "Reduz mensagens repetidas antes do evento.",
  regulamento: "Cada alteração publica uma versão nova; o aceite aponta para a versão lida.",
  revisar: "Confira o que falta e decida: guardar como rascunho ou publicar agora.",
};

function StepBadge({
  index,
  status,
  active,
}: {
  index: number;
  status: StepStatus;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] tabular-nums",
        status === "done" && "border-primary bg-primary text-primary-foreground",
        status === "skipped" && "border-dashed",
        active && status !== "done" && "border-primary text-primary",
      )}
    >
      {status === "done" ? <Check className="size-3" /> : index + 1}
    </span>
  );
}

function ReviewSummary({
  missing,
  status,
  canPublish,
}: {
  missing: string[];
  status: StepStatus[];
  canPublish: boolean;
}) {
  const skipped = WIZARD_STEPS.filter(
    (item, index) => item.kind !== "review" && status[index] === "skipped",
  );

  return (
    <div className="space-y-3">
      {missing.length > 0 ? (
        <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">Para publicar, ainda falta: {missing.join(", ")}.</p>
            <p className="text-muted-foreground">
              Dá para salvar como rascunho e completar depois na edição do evento.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-success" />
          <p className="font-medium">
            {canPublish
              ? "Tudo pronto para publicar."
              : "Tudo pronto. A publicação fica com quem tem permissão para publicar."}
          </p>
        </div>
      )}

      {skipped.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Etapas puladas: {skipped.map((item) => item.title).join(", ")}.
        </p>
      )}
    </div>
  );
}
