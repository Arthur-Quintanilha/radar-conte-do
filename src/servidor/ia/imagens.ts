import { AsyncLocalStorage } from 'node:async_hooks'
import type { FonteImagens, Imagem, PedidoImagens, ImagensFornecidas } from '../../comum/imagens'
import { chaveDoPedido } from '../../comum/imagens'

/**
 * De onde a IA tira as imagens dos posts. Os arquivos ficam no computador de
 * quem coletou, então há dois jeitos:
 *  - no mesmo processo do worker (terminal, painel local): a fonte lê a pasta;
 *  - na API: as imagens chegam junto do pedido. Faltou alguma, o servidor
 *    responde quais faltam (FaltamImagens), o worker extrai e pede de novo.
 */
let atual: FonteImagens | null = null

export function definirFonteImagens(f: FonteImagens): void {
  atual = f
}

export function fonteImagens(): FonteImagens {
  if (!atual) throw new Error('sem fonte de imagens: chame definirFonteImagens() ao iniciar o programa')
  return atual
}

/** Pediu imagens que nao vieram no pedido: o cliente extrai e repete o pedido com elas. */
export class FaltamImagens extends Error {
  constructor(readonly pedidos: PedidoImagens[]) {
    super(`faltam as imagens de ${pedidos.length} pedido(s)`)
    this.name = 'FaltamImagens'
  }
}

interface Contexto {
  fornecidas: ImagensFornecidas
  faltam: Map<string, PedidoImagens>
}
const contexto = new AsyncLocalStorage<Contexto>()

/** Roda `fn` com as imagens que vieram no pedido (as que faltarem ficam anotadas). */
export function comImagensDoPedido<T>(fornecidas: ImagensFornecidas | undefined, fn: () => Promise<T>): Promise<T> {
  return contexto.run({ fornecidas: fornecidas ?? {}, faltam: new Map() }, fn)
}

/** Chamado antes de perguntar à IA: se faltou imagem, para aqui (nada foi gasto ainda). */
export function exigirImagensCompletas(): void {
  const c = contexto.getStore()
  if (c && c.faltam.size) throw new FaltamImagens([...c.faltam.values()])
}

function buscar(pedido: PedidoImagens): { imagens: Imagem[]; duracao: number | null } | null {
  const c = contexto.getStore()
  if (!c) throw new Error('fonte de imagens do pedido usada fora de um pedido')
  const chave = chaveDoPedido(pedido)
  const r = c.fornecidas[chave]
  if (r) return r
  c.faltam.set(chave, pedido)
  return null
}

/** A fonte da API: só o que veio no pedido. */
export const imagensDoPedido: FonteImagens = {
  async quadrosDoPost(shortcode, maxQuadros = 6, maxSlides = 10, largura = 480) {
    return buscar({ tipo: 'quadros', shortcode, maxQuadros, maxSlides, largura }) ?? { imagens: [], duracao: null }
  },
  async slidesDosPosts(posts, porPost, largura, teto = 90) {
    const r = buscar({ tipo: 'slides', posts, porPost, largura, teto })
    if (!r) return { imagens: [], porShortcode: new Map() }
    // a contagem por post vem do rotulo "post SHORTCODE · slide N"
    const porShortcode = new Map<string, number>()
    for (const im of r.imagens) {
      const sc = /^post (\S+) ·/.exec(im.rotulo)?.[1]
      if (sc) porShortcode.set(sc, (porShortcode.get(sc) ?? 0) + 1)
    }
    return { imagens: r.imagens, porShortcode }
  },
}
