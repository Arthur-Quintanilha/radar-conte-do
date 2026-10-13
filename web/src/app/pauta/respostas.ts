import { Component, inject, input, output, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Estado } from '../core/estado'

/**
 * Responder uma ideia da pauta (Vou postar / Recusar com motivo e nota /
 * desfazer) ou um tema do radar (adotar / dispensar). Igual no card e no detalhe.
 */
@Component({
  selector: 'app-respostas',
  imports: [FormsModule, MatButtonModule, MatIconModule],
  template: `
    @if (tipo() === 'radar') {
      @if (status() === 'nova') {
        @if (comDetalhe()) {
          <input [(ngModel)]="detalhe" maxlength="400" placeholder="O que você tem a ver com isso? (opcional)"
                 class="mb-2 w-full rounded-md border border-linha bg-white px-3 py-2 text-sm" />
        }
        <div class="flex flex-wrap gap-2">
          <button mat-flat-button (click)="adotar('pessoal')" [disabled]="ocupado()">Adotar (pessoal)</button>
          <button mat-stroked-button (click)="adotar('temas')" [disabled]="ocupado()">Adotar (profissional)</button>
          <button mat-button (click)="enviar('radar.dispensar', {})" [disabled]="ocupado()">não é pra mim</button>
        </div>
      } @else {
        <span class="rounded-full px-2.5 py-0.5 text-[13px]" [class]="status() === 'adotado' ? 'bg-emerald-100 text-emerald-800' : 'bg-black/5 text-apagado'">
          {{ status() === 'adotado' ? 'adotado no território' : 'dispensado' }}
        </span>
      }
    } @else if (status() === 'nova') {
      @if (recusando()) {
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap gap-1.5">
            @for (m of motivos(); track m[0]) {
              <button mat-stroked-button class="!h-8 !text-[13px]" (click)="recusar(m[0])" [disabled]="ocupado()">{{ m[1] }}</button>
            }
          </div>
          <input [(ngModel)]="nota" maxlength="600" placeholder="Nota (opcional): o que não serviu"
                 class="w-full rounded-md border border-linha bg-white px-3 py-2 text-sm" />
          <button mat-button class="self-start" (click)="recusando.set(false)">cancelar</button>
        </div>
      } @else {
        <div class="flex flex-wrap gap-2">
          <button mat-flat-button (click)="enviar('ideia.responder', { status: 'aceita' })" [disabled]="ocupado()">Vou postar</button>
          <button mat-stroked-button (click)="recusando.set(true)">Recusar</button>
        </div>
      }
    } @else {
      <div class="flex flex-wrap items-center gap-2 text-[13px]">
        @if (status() === 'aceita') {
          <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-800">aceita</span>
        } @else {
          <span class="rounded-full bg-red-100 px-2.5 py-0.5 text-red-800">recusada</span>
          <span class="text-apagado">{{ estado.dados()?.motivosRecusa?.[motivo() ?? ''] ?? '' }}@if (notaAtual()) { — {{ notaAtual() }}}</span>
        }
        <button mat-button class="!h-7" (click)="enviar('ideia.responder', { status: 'nova' })" [disabled]="ocupado()">desfazer</button>
      </div>
    }
  `,
})
export class Respostas {
  readonly id = input.required<string>()
  readonly tipo = input<string>('pauta')
  readonly status = input.required<string>()
  readonly motivo = input<string | null>(null)
  readonly notaAtual = input<string | null>(null)
  /** radar: mostra o campo "o que voce tem a ver com isso" */
  readonly comDetalhe = input(false)
  readonly respondeu = output<void>()

  protected readonly estado = inject(Estado)
  private readonly avisos = inject(MatSnackBar)
  protected readonly recusando = signal(false)
  protected readonly ocupado = signal(false)
  protected nota = ''
  protected detalhe = ''

  protected motivos(): [string, string][] {
    return Object.entries(this.estado.dados()?.motivosRecusa ?? {})
  }

  protected recusar(motivo: string): void {
    void this.enviar('ideia.responder', { status: 'recusada', motivo, nota: this.nota })
  }

  protected adotar(como: 'pessoal' | 'temas'): void {
    void this.enviar('radar.adotar', { como, detalhe: this.detalhe })
  }

  protected async enviar(acao: string, dados: Record<string, unknown>): Promise<void> {
    this.ocupado.set(true)
    try {
      await this.estado.acao(acao, { id: this.id(), ...dados })
      this.recusando.set(false)
      this.nota = ''
      this.respondeu.emit()
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 6000 })
    } finally {
      this.ocupado.set(false)
    }
  }
}
