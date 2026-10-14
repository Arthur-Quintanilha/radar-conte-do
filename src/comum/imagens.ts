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
