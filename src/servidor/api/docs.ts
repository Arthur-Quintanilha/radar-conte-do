import { ROTAS } from './rotas'

/** OpenAPI montado da tabela de rotas, para o Swagger em /docs. */
export function documentacao(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of ROTAS) {
    const caminho = '/api' + r.caminho.replace(/:(\w+)/g, '{$1}')
    const params = [...r.caminho.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
    paths[caminho] = {
      ...paths[caminho],
      [r.metodo]: {
        tags: [r.grupo],
        summary: r.descricao,
        parameters: params,
        ...(r.metodo === 'get' || r.metodo === 'delete' ? {} : { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } }),
        responses: { '200': { description: 'ok' }, '401': { description: 'sem login' }, '403': { description: 'sem acesso' }, '422': { description: 'dados inválidos' } },
        security: [{ bearer: [] }],
      },
    }
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Radar de conteúdo', version: '1.0.0', description: 'API do Radar. Todo pedido leva o token do Supabase (Authorization: Bearer) e, se mudar algo, o cabeçalho x-painel: 1.' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths,
  }
}
