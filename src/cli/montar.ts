import { definirServidor } from '../worker/servidor'
import { servidorHttp } from '../worker/servidorHttp'
import { servidorDireto } from '../servidor/portaDireta'
import { definirFonteImagens } from '../servidor/ia/imagens'
import { imagensLocais } from '../worker/midia/quadros'
import { definirControleJobs } from '../servidor/api/controllers/etapas-controller'
import { COMANDOS, estadoJob, iniciarJob, pararJob, personaDaRetomada, retomarJob } from '../worker/jobs'
import { config } from '../comum/config'

/**
 * Monta as peças. Três jeitos de rodar:
 *  - tudo local (padrão): worker e servidor no mesmo processo, a IA tira as
 *    imagens da pasta, o painel dispara as etapas aqui mesmo;
 *  - worker pela rede (API_URL no .env): o worker fala com a API por HTTP,
 *    como o app instalado vai fazer;
 *  - só a API (comando `api`): o que vai para a nuvem. Imagens só as que vêm no
 *    pedido; etapas não rodam lá.
 */
export function montarTudoLocal(): void {
  if (config.API_URL) {
    definirServidor(servidorHttp({ url: config.API_URL, token: () => config.API_TOKEN ?? null, persona: () => process.env['PERSONA_ID'] ?? null }))
  } else {
    definirServidor(servidorDireto)
  }
  definirFonteImagens(imagensLocais)
  definirControleJobs({
    comandos: COMANDOS,
    estado: estadoJob,
    iniciar: iniciarJob,
    parar: pararJob,
    retomar: retomarJob,
    personaDaUltima: personaDaRetomada,
  })
}

export { montarSoApi } from '../servidor/montarApi'
