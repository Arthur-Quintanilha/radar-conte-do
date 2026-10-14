import { definirServidor } from '../worker/servidor'
import { servidorDireto } from '../servidor/portaDireta'
import { definirFonteImagens } from '../servidor/ia/imagens'
import { imagensLocais } from '../worker/midia/quadros'
import { definirControleJobs } from '../servidor/painel/creatorApi'
import { COMANDOS, estadoJob, iniciarJob, pararJob, personaDaRetomada, retomarJob } from '../worker/jobs'

/**
 * Tudo no mesmo processo: o worker fala com o servidor direto (sem HTTP), a
 * IA tira as imagens da pasta local e o painel dispara as etapas aqui mesmo.
 * É como roda hoje no terminal e no painel local. O app desktop monta as
 * mesmas peças com o servidor do outro lado da rede.
 */
export function montarTudoLocal(): void {
  definirServidor(servidorDireto)
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
