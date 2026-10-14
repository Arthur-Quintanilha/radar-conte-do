import type { ZodType, ZodTypeDef } from 'zod'

/** Valida o corpo (ou query) com zod; erro vira 422 no middleware de erro. */
export function validar<T>(schema: ZodType<T, ZodTypeDef, unknown>, dados: unknown): T {
  return schema.parse(dados ?? {})
}
