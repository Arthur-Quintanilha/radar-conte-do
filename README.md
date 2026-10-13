# Radar de conteúdo

Ideias e roteiros de conteúdo para creators. Para cada creator (persona), o
radar descobre o que o público que ele quer atrair consome no Instagram e
transforma isso em ideias de post dentro do território dele, com roteiro
pronto para gravar. O fluxo completo está em **[docs/creator.md](docs/creator.md)**.

```bash
npm run painel     # abas Pauta, Creator e Sementes
npm run semana     # o ciclo inteiro da persona ativa
```

## Como funciona, em uma frase por etapa

1. **Creator**: o creator responde uma entrevista curta; a IA monta o território (temas, histórias, opiniões, tom).
2. **Sementes**: perfis reais de pessoas do público. O radar coleta quem elas seguem e acha as contas em comum (o grafo).
3. **Referências**: pessoas que falam do que o creator fala. Delas vem o assunto; do grafo vem o formato que o público consome.
4. **Ciclo diário**: visita as contas, transcreve os reels, a IA avalia cada post contra o território e gera ideias novas, sem apagar as antigas.
5. **Pauta e roteiro**: cada ideia vira um roteiro de fala corrida, copiando o formato do post de referência que funcionou.

## Aviso

Automatizar navegação logada viola os Termos de Uso do Instagram. Use uma conta
dedicada, nunca a pessoal ou a da empresa. O coletor é só leitura: navega e lê,
nunca curte, comenta ou segue.

## Pré-requisitos

- Node 22 LTS
- Google Chrome instalado
- Chave da API da Anthropic no `.env` (`ANTHROPIC_API_KEY`) para as etapas de IA
- Opcional, para transcrever os reels: `ffmpeg` e um whisper no PATH (ex.: `whisper-ctranslate2`)

O banco é Postgres (Supabase), na `DATABASE_URL` do `.env`.

## Setup

```bash
copy .env.example .env      # DATABASE_URL e o resto
npm install
npm run db:migrate          # cria as tabelas (drizzle/*.sql)
npm run migrar              # só uma vez: copia o SQLite antigo (data/ig-insights.db) para o Postgres
npm run login               # abre o Chrome, você loga na mão, a sessão fica salva
npm run painel              # e o resto é pelo painel
```

## Comandos

Tudo o que o painel faz também roda pelo terminal:

```bash
npm run painel                         # painel local em http://localhost:4321
npm run semana                         # ciclo completo; --sem-coleta pula o navegador
npm run persona -- criar "Lucas"       # personas (também pela aba Creator)
npm run sementes -- @a @b @c           # sementes (também pela aba Sementes)
npm run referencias -- @x @y           # referências de conteúdo
npm run seguindo                       # coleta o "seguindo" das sementes
npm run grafo                          # recalcula quem as sementes seguem em comum
npm run ia -- territorio|contas|encaixe|pauta
npm run conta -- @usuario atualizar    # uma conta só: visitar|transcrever|classificar|avaliar|seguindo|atualizar
npm run roteiro -- <id-da-ideia>       # gera o roteiro de uma ideia
npm run whisper -- --check             # confere ffmpeg e whisper
npm run health                         # confere se a sessão do Instagram está viva
npm run status                         # orçamento, circuit breaker e totais
npm run models                         # modelos disponíveis na sua conta Anthropic
npm run arquivar                       # guarda o banco atual em data/archive e começa do zero
```

Para abortar qualquer coleta em andamento, crie um arquivo `STOP` na raiz
(`echo . > STOP`) ou use o botão "parar" do painel.

## Versão web (login)

O app novo fica em `web/` (Angular). O login é pelo Supabase Auth e não tem cadastro aberto: quem entra é cadastrado por um admin.

1. No `.env`, preencha `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (Supabase > Project Settings > API, chave secret). Essa chave só fica no servidor.
2. `npm run db:migrate` cria as tabelas `usuario` e `acesso`.
3. `npm run usuario -- admin voce@email.com` torna você admin (o e-mail precisa existir em Authentication > Users, ou passe `--senha`).
4. `npm run painel` e, em outro terminal, `cd web && npm start`. Abra http://localhost:4200.

Admin vê todos os creators e cadastra gente; membro vê só os creators liberados para ele. Com `PAINEL_SEM_LOGIN=1` o painel antigo (localhost:4321, sem login) continua funcionando como admin local; em produção use `0`.

## Transcrição dos reels

Duas fontes convivem: a legenda automática que o próprio Instagram às vezes
entrega e o whisper local, que roda em todos os reels das contas da persona
ativa dentro da janela de 30 dias. Vários vídeos são transcritos ao mesmo
tempo (`WHISPER_PARALELO`, 0 = automático pelos núcleos da CPU). O
`WHISPER_CMD` no `.env` é um template, então serve tanto para o
whisper-ctranslate2 quanto para o whisper.cpp.

## Onde estão as coisas

```
src/creator/     personas, sementes, referências, grafo, encaixe, pauta, roteiro e o ciclo diário
src/painel/      painel local (127.0.0.1): servidor, API do creator e a interface
src/collector/   navegação: perfis, "seguindo", interceptor de rede, circuit breaker
src/parser/      payload bruto -> post, autor, métricas, mídia
src/enricher/    download de mídia, transcrição (whisper) e quadros dos vídeos
src/llm/         leitura das respostas da IA
src/session/     Chrome persistente, login manual, health check
src/shared/      config, logger, orçamento de ações, kill switch
src/db/          schema Drizzle e cliente Postgres (Supabase ou pglite)
drizzle/         migracoes SQL geradas pelo drizzle-kit
src/cli/         comandos
data/            banco, payloads brutos, mídia e perfil do Chrome (nunca versionar)
```

O painel antigo (Explorar, Busca, Autores, IA e Sessões) foi removido desta
branch e está guardado em `legado/painel-antigo`.

## Princípios que o código segue

1. O coletor nunca monta requisição própria. Ele navega e escuta.
2. O payload bruto é imutável e fica separado do parser.
3. Métrica é série temporal, nunca coluna sobrescrita.
4. Todo sinal negativo soma pontos no circuit breaker.
