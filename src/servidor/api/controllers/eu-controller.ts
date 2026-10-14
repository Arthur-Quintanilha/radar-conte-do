import type { Request, Response } from 'express'
import { quem } from '../middlewares/autenticar'
import { personasDe } from '../acesso'

/** GET /api/eu: quem está logado, papel e creators liberados (null = todos). */
export async function eu(req: Request, res: Response): Promise<void> {
  const q = quem(req)
  res.json({ id: q.id, email: q.email, papel: q.papel, local: Boolean(q.local), personas: await personasDe(q) })
}
