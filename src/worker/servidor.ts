import type { Servidor } from '../comum/porta'

/**
 * Por onde o worker fala com o servidor. Quem monta o programa (o CLI, o app
 * desktop) escolhe a implementação no começo: no mesmo processo ou por HTTP.
 */
let atual: Servidor | null = null

export function definirServidor(s: Servidor): void {
  atual = s
}

export function servidor(): Servidor {
  if (!atual) throw new Error('worker sem servidor: chame definirServidor() ao iniciar o programa')
  return atual
}
