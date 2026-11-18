/**
 * Disjuntor por taxa de erro numa janela deslizante.
 *
 * Erro de DESTINATÁRIO (número inexistente, bloqueio) conta como envio normal:
 * é problema daquela pessoa, não do sistema, e uma lista com muitos números
 * ruins não deve parar a fila de todo mundo.
 */
export type BreakerSample = "ok" | "error" | "recipient_error";

export class Breaker {
  private samples: { at: number; error: boolean }[] = [];

  constructor(
    private readonly opts: { windowMs?: number; minSamples?: number; threshold?: number } = {},
  ) {}

  private get windowMs() {
    return this.opts.windowMs ?? 60_000;
  }

  record(kind: BreakerSample, at: number): void {
    this.samples.push({ at, error: kind === "error" });
  }

  shouldOpen(at: number): boolean {
    this.samples = this.samples.filter((s) => at - s.at <= this.windowMs);
    const total = this.samples.length;
    if (total < (this.opts.minSamples ?? 50)) return false;
    const errors = this.samples.filter((s) => s.error).length;
    return errors / total > (this.opts.threshold ?? 0.2);
  }

  reset(): void {
    this.samples = [];
  }
}
