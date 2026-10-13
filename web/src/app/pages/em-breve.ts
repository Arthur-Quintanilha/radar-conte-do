import { Component, inject } from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import { MatIconModule } from '@angular/material/icon'

/** Telas que ainda nao vieram do painel antigo. */
@Component({
  selector: 'app-em-breve',
  imports: [MatIconModule],
  template: `
    <div class="grid place-items-center rounded-xl border border-dashed border-linha p-16 text-center text-apagado">
      <mat-icon class="!size-10 !text-[40px]">construction</mat-icon>
      <p class="m-0 mt-3 text-base font-medium text-tinta">{{ nome }}</p>
      <p class="m-0 mt-1 text-sm">Esta tela ainda está no painel antigo (porta 4321) e vem para cá nas próximas etapas.</p>
    </div>
  `,
})
export class EmBreve {
  protected readonly nome = (inject(ActivatedRoute).snapshot.data['nome'] as string | undefined) ?? 'Em breve'
}
