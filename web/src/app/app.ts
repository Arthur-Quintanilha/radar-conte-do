import { Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { MatIconRegistry } from '@angular/material/icon'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor() {
    // o index.html carrega a fonte Material Symbols; sem isto o mat-icon procura a Material Icons antiga
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined')
  }
}
