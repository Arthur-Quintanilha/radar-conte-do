/**
 * Imagens que a IA recebe (quadros de vídeo, slides de carrossel, fotos).
 * Os arquivos ficam no computador de quem coletou: o servidor pede, o worker
 * extrai e devolve, e nada é gravado no banco.
 */

export interface Imagem {
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  base64: string
  rotulo: string
}

/** tipos de post cujo conteúdo está nas imagens (reels têm transcrição) */
export const ehDeImagem = (tipo: string | null | undefined): boolean => tipo === 'carousel' || tipo === 'image'

export interface FonteImagens {
  /** quadros do vídeo (gancho e ao longo dele) ou as imagens do carrossel/foto, pequenas */
  quadrosDoPost(shortcode: string, maxQuadros?: number, maxSlides?: number, largura?: number): Promise<{ imagens: Imagem[]; duracao: number | null }>
  /** slides de vários posts de uma vez, com teto total de imagens */
  slidesDosPosts(
    posts: { shortcode: string; tipo: string | null }[],
    porPost: number,
    largura: number,
    teto?: number,
  ): Promise<{ imagens: Imagem[]; porShortcode: Map<string, number> }>
}

/** O que a IA quer ver: quadros de um post ou slides de vários. */
export type PedidoImagens =
  | { tipo: 'quadros'; shortcode: string; maxQuadros: number; maxSlides: number; largura: number }
  | { tipo: 'slides'; posts: { shortcode: string; tipo: string | null }[]; porPost: number; largura: number; teto: number }

/** As imagens que o cliente mandou junto do pedido, pela chave de cada pedido. */
export type ImagensFornecidas = Record<string, { imagens: Imagem[]; duracao: number | null }>

/** O mesmo pedido sempre dá a mesma chave (a ordem dos campos é fixa). */
export function chaveDoPedido(p: PedidoImagens): string {
  return p.tipo === 'quadros'
    ? JSON.stringify(['q', p.shortcode, p.maxQuadros, p.maxSlides, p.largura])
    : JSON.stringify(['s', p.posts.map((x) => [x.shortcode, x.tipo]), p.porPost, p.largura, p.teto])
}

/** Atende os pedidos com uma fonte (no worker, a pasta local). */
export async function atenderPedidos(fonte: FonteImagens, pedidos: PedidoImagens[]): Promise<ImagensFornecidas> {
  const out: ImagensFornecidas = {}
  for (const p of pedidos) {
    out[chaveDoPedido(p)] =
      p.tipo === 'quadros'
        ? await fonte.quadrosDoPost(p.shortcode, p.maxQuadros, p.maxSlides, p.largura)
        : { imagens: (await fonte.slidesDosPosts(p.posts, p.porPost, p.largura, p.teto)).imagens, duracao: null }
  }
  return out
}
