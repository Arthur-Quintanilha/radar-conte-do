import { Injectable, computed, signal } from '@angular/core'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { environment } from '../../environments/environment'

/** Mensagens do Supabase Auth em portugues. */
function traduzir(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/email not confirmed/i.test(msg)) return 'Confirme o e-mail antes de entrar.'
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Espere um pouco e tente de novo.'
  if (/fetch|network/i.test(msg)) return 'Sem conexão com o servidor de login.'
  return msg
}

/**
 * Login pelo Supabase Auth. Nao ha cadastro aberto: os usuarios sao criados no
 * painel administrativo (ou, por enquanto, em Supabase > Authentication > Users).
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly cliente: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseChave, {
    auth: { persistSession: true, autoRefreshToken: true },
  })

  readonly sessao = signal<Session | null>(null)
  readonly usuario = computed(() => this.sessao()?.user ?? null)
  /** resolve quando a sessao salva no navegador ja foi lida */
  readonly pronto: Promise<void>

  constructor() {
    this.pronto = this.cliente.auth.getSession().then(({ data }) => this.sessao.set(data.session))
    this.cliente.auth.onAuthStateChange((_evento, s) => this.sessao.set(s))
  }

  /** Devolve null quando deu certo, ou a mensagem de erro. */
  async entrar(email: string, senha: string): Promise<string | null> {
    const { error } = await this.cliente.auth.signInWithPassword({ email: email.trim(), password: senha })
    return error ? traduzir(error.message) : null
  }

  async esqueciSenha(email: string): Promise<string | null> {
    const { error } = await this.cliente.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/entrar` })
    return error ? traduzir(error.message) : null
  }

  async sair(): Promise<void> {
    await this.cliente.auth.signOut()
  }

  token(): string | null {
    return this.sessao()?.access_token ?? null
  }
}
