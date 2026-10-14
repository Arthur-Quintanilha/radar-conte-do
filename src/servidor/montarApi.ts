import { definirFonteImagens, imagensDoPedido } from './ia/imagens'
import { definirControleJobs } from './api/controllers/etapas-controller'
import { exigirLoginSempre } from './web/gate'

/**
 * Só a API, sem o worker (o que vai para a nuvem): imagens só as que vêm no
 * pedido, etapas não rodam lá e todo pedido precisa de login.
 */
export function montarSoApi(): void {
  definirFonteImagens(imagensDoPedido)
  definirControleJobs(null)
  exigirLoginSempre()
}
