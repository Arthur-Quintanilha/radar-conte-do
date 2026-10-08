import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  DB_FILE: z.string().default('./data/ig-insights.db'),

  CHROME_PATH: z.string().optional(),
  PROFILE_DIR: z.string().default('./data/profile'),
  WINDOW_WIDTH: z.coerce.number().int().default(1366),
  WINDOW_HEIGHT: z.coerce.number().int().default(820),
  LOCALE: z.string().default('pt-BR'),
  TZ_NAME: z.string().default('America/Sao_Paulo'),

  RAW_DIR: z.string().default('./data/raw'),
  MEDIA_DIR: z.string().default('./data/media'),

  COLLECT_WINDOW_START: z.coerce.number().int().min(0).max(23).default(0),
  COLLECT_WINDOW_END: z.coerce.number().int().min(1).max(24).default(24),
  MAX_SESSIONS_PER_DAY: z.coerce.number().int().min(1).default(3),
  REST_DAYS_PER_WEEK: z.coerce.number().int().min(0).max(6).default(0),
  MAX_SCROLLS: z.coerce.number().int().min(1).default(10),
  SESSION_MAX_MINUTES: z.coerce.number().int().min(1).default(15),
  MAX_AUTHOR_SESSIONS_PER_DAY: z.coerce.number().int().min(1).default(2),
  MAX_AUTHORS_PER_SESSION: z.coerce.number().int().min(1).default(15),
  MAX_SEARCH_SESSIONS_PER_DAY: z.coerce.number().int().min(1).default(6),
  SEARCH_SCROLLS: z.coerce.number().int().min(1).default(6),
  SEARCH_TERMS_FILE: z.string().default('./termos.txt'),
  /** perfis visitados por execucao do `npm run acompanhar` */
  WATCH_PER_SESSION: z.coerce.number().int().min(1).default(8),
  /** nao revisita o mesmo perfil antes de tantas horas */
  WATCH_MIN_HOURS: z.coerce.number().min(0).default(20),
  AUTHOR_STALE_DAYS: z.coerce.number().int().min(1).default(30),

  /** creator: lista de "seguindo" das sementes (npm run seguindo) */
  /** 0 = sem teto diario (so o circuit breaker freia) */
  MAX_FOLLOWING_SESSIONS_PER_DAY: z.coerce.number().int().min(0).default(0),
  SEGUINDO_POR_SESSAO: z.coerce.number().int().min(1).default(5),
  SEGUINDO_MAX_POR_SEMENTE: z.coerce.number().int().min(12).default(500),
  /** nao recoleta a mesma semente antes de tantos dias */
  SEGUINDO_MIN_DIAS: z.coerce.number().min(0).default(7),
  /** conta entra no grafo quando tantas sementes a seguem. 0 = automatico (30% das sementes, minimo 2) */
  GRAFO_MIN_SEMENTES: z.coerce.number().int().min(0).default(0),
  /** teto de contas do grafo acompanhadas ao mesmo tempo */
  GRAFO_MAX_CONTAS: z.coerce.number().int().min(1).default(40),
  /** so posts publicados nos ultimos N dias entram na pauta */
  JANELA_DIAS: z.coerce.number().int().min(1).default(30),
  PAUTA_IDEIAS: z.coerce.number().int().min(1).max(15).default(5),
  RADAR_TEMAS: z.coerce.number().int().min(0).max(10).default(3),
  /** rodadas do acompanhar dentro do npm run semana (cada uma visita WATCH_PER_SESSION perfis) */
  SEMANA_RODADAS_ACOMPANHAR: z.coerce.number().int().min(0).default(4),
  /** modelo das tarefas do creator; vazio = ANTHROPIC_MODEL */
  CREATOR_MODEL: z.string().optional(),
  /** modelo so da geracao da pauta (texto mais fino); vazio = CREATOR_MODEL */
  PAUTA_MODEL: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),
  ENRICH_TARGET_WIDTH: z.coerce.number().int().min(240).default(720),
  ENRICH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),

  FFMPEG_BIN: z.string().default('ffmpeg'),
  WHISPER_MODEL: z.string().default('small'),
  /** reels transcritos por ciclo (so os da janela da persona); 0 = todos */
  WHISPER_POR_CICLO: z.coerce.number().int().min(0).default(0),
  /** quantos whisper rodam ao mesmo tempo; 0 = automatico pelos nucleos da CPU */
  WHISPER_PARALELO: z.coerce.number().int().min(0).max(16).default(0),
  WHISPER_LANG: z.string().default('pt'),
  /** {input} = wav de entrada, {outdir} = pasta de saida, {model} = modelo */
  WHISPER_CMD: z
    .string()
    .default(
      'whisper-ctranslate2 "{input}" --model {model} --language {lang} --vad_filter True --output_format txt --output_dir "{outdir}"',
    ),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Configuracao invalida no .env (compare com o .env.example, sem copiar por cima):')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
