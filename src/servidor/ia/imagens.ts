import type { FonteImagens } from '../../comum/imagens'

/**
 * De onde a IA tira as imagens dos posts. Os arquivos ficam no computador de
 * quem coletou; quem monta o programa liga aqui a fonte (o worker local, ou o
 * que o app mandou junto do pedido).
 */
let atual: FonteImagens | null = null

export function definirFonteImagens(f: FonteImagens): void {
  atual = f
}

export function fonteImagens(): FonteImagens {
  if (!atual) throw new Error('sem fonte de imagens: chame definirFonteImagens() ao iniciar o programa')
  return atual
}
