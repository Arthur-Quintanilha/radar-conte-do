/**
 * Endereco da pagina de resultados de uma busca por palavra.
 *
 * A busca digitada foi testada e abandonada: a barra do Explorar nao aceitava
 * o clique pela automacao e cada tentativa custava 8 s de espera. Ir direto
 * pela URL e o mesmo que abrir um link compartilhado de busca.
 */
export function searchUrl(termo: string): string {
  return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(termo)}`
}
