import type { IncomingMessage, ServerResponse } from 'node:http'

export const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export async function lerJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  let corpo = ''
  for await (const parte of req) {
    corpo += String(parte)
    if (corpo.length > max) throw new Error(`corpo maior que ${max} caracteres`)
  }
  return JSON.parse(corpo || '{}') as Record<string, unknown>
}
