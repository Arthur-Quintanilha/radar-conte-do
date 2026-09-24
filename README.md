# instagram-insights

Coletor do Explorar do Instagram e base para o bot de recomendacao de ideias de conteudo.
Fase 0 e Fase 1 do plano tecnico.

## Aviso

Automatizar navegacao logada viola os Termos de Uso do Instagram. Use uma conta
dedicada, nunca a pessoal ou a da empresa. O coletor e read-only: navega e le,
nunca curte, comenta ou segue.

## Pre-requisitos

- Node 22 LTS (o `better-sqlite3` tem binario pronto para essa versao; em Node
  muito novo ele pode tentar compilar e falhar no Windows)
- Google Chrome instalado (nao o Chromium do Playwright)

Nada de Docker: o banco e um arquivo SQLite em `data/ig-insights.db`.

## Setup

```bash
copy .env.example .env      # ajuste o que precisar
npm install
npm run db:push             # cria as tabelas no arquivo SQLite
```

O `npm install` baixa o Chromium do patchright (~150 MB). Isso e esperado.

## Uso

```bash
npm run login      # abre o Chrome, voce loga na mao, a sessao fica salva
npm run health     # confere se a sessao esta viva
npm run collect    # roda uma sessao de coleta no Explorar
npm run parse      # processa os payloads brutos e materializa as entidades
npm run authors    # visita perfis para preencher o numero de seguidores
npm run media      # baixa imagens, videos e legendas; converte os .srt
npm run whisper    # transcreve os videos com whisper local (opcional)
npm run enrich     # OPCIONAL: analise com o Claude (imagem + legenda -> JSON)
npm run models     # lista os ids de modelo validos na sua conta Anthropic
npm run painel     # abre no navegador o painel com os dados do banco
npm run purge      # remove o que nao veio do Explorar e fecha sessoes penduradas
npm run status     # orcamento, circuit breaker e totais
npm run plan       # decide se esta hora vira sessao (para o cron horario)
```

Para abortar qualquer coleta em andamento, crie um arquivo `STOP` na raiz:

```bash
echo . > STOP
```

## Agendamento

Nao use horario fixo. Agende `npm run plan` de hora em hora; ele sorteia se
aquela hora vira sessao, respeitando o teto diario.

Por padrao nao ha janela horaria nem dias de folga: `COLLECT_WINDOW_START=0`,
`COLLECT_WINDOW_END=24` e `REST_DAYS_PER_WEEK=0`. O unico freio automatico que
continua valendo e `MAX_SESSIONS_PER_DAY`, mais o circuit breaker. Para religar
as pausas, e so mudar esses tres valores no `.env`.

## Onde estao as coisas

```
src/shared/      config, logger, orcamento de acoes, pausas humanas, kill switch
src/db/          schema Drizzle e cliente Postgres
src/session/     contexto persistente, login manual, health check
src/collector/   interceptor de rede, raw store, extracao tolerante, circuit breaker
src/parser/      payload bruto -> post, author, post_metric, hashtag, media_asset
src/enricher/    download de midia e extracao estruturada com o Claude (opcional)
src/inspect/     inspecao do banco pelo terminal
src/painel/      painel local: servidor em 127.0.0.1 e a interface
src/maintenance/ limpeza do banco
src/cli/         comandos
data/raw/        payloads brutos em JSONL, um arquivo por run
data/profile/    perfil do Chrome (sessao) — nunca versionar
data/ig-insights.db  banco SQLite
```

## Principios que o codigo segue

1. O coletor nunca monta requisicao propria. Ele navega e escuta.
2. O payload bruto e imutavel e fica separado do parser.
3. Metrica e serie temporal, nunca coluna sobrescrita.
4. Todo sinal negativo soma pontos no circuit breaker.

## O que os payloads reais mostraram

O grid do Explorar ja traz `like_count`, `comment_count`, caption completa,
`taken_at` e o autor. Nao e preciso abrir post para ter quase tudo.

Abrir `/p/<shortcode>/` nao rende nada: a pagina e renderizada no servidor e
nao dispara XHR. O mesmo vale para a pagina de perfil — por isso o comando
`authors` extrai os dados dos blobs JSON do HTML, com fallback para regex e,
por ultimo, para a meta description (numero arredondado).

`follower_count` nao aparece em nenhum payload do Explorar. Sem ele nao ha
normalizacao de engajamento, e e para isso que existe o `npm run authors`.

## O que da para extrair sem IA

Tudo isto sai do payload ou da legenda, sem nenhuma chamada de modelo, e e
gravado como `enrichment` de tipo `features`:

| Grupo | Campos |
| --- | --- |
| Legenda | tamanho, linhas, primeira linha (o hook literal), hashtags, mencoes, emojis, proporcao de caixa alta, tem pergunta |
| Classificacao | tipo de hook (pergunta, numero, citacao, grito, contraste, negacao, condicional, pessoal, imperativo, declaracao) e tipo de CTA (salvar, comentar, compartilhar, marcar, seguir, link) |
| Midia | proporcao da imagem, numero de slides do carrossel, tem audio, duracao do video, publicidade declarada, reposts, pessoas marcadas, tem local |
| Tempo | dia da semana e hora da publicacao, no fuso configurado |
| Engajamento | curtidas, comentarios, views — serie temporal em `post_metric` |
| De brinde | o texto alternativo que o proprio Instagram gera para cada imagem |

## Transcricao de reels

Duas fontes, que convivem na tabela `enrichment` com `model` diferente:

**`instagram`** — o proprio Instagram transcreve parte dos reels e entrega o
link de um `.srt` no campo `video_subtitles_uri`, dentro do payload do
Explorar. Custo zero e chega junto com a coleta. A cobertura e o que e: em
uma amostra de 30 reels do grid, 18 tinham `video_subtitles_locale` (idioma
detectado) e apenas 5 tinham o arquivo. Comparando o conjunto completo de
campos dos dois grupos, a unica diferenca e a presenca do proprio campo — nao
ha gatilho do lado do cliente. A URL e assinada e expira, entao `media` tem
que rodar logo depois de `parse`.

**`whisper:<modelo>`** — transcricao local dos videos baixados, para cobrir o
resto. Roda em todos os reels, inclusive nos que ja tem legenda do Instagram,
o que permite comparar as duas.

Precisa de `ffmpeg` e de um whisper no PATH:

```bash
npm run whisper -- --check      # diz o que falta
npm run whisper -- --limit 3    # transcreve 3 videos
```

O `WHISPER_CMD` no `.env` e um template, entao serve tanto para o whisper de
referencia quanto para o whisper.cpp, que tem outra linha de comando. O audio
e extraido em 16 kHz mono antes de chamar o modelo.

O que continua faltando sem modelo: leitura do texto dentro das imagens
estaticas — embora o `alt_text` do Instagram transcreva parte dele.

## Ordem do enriquecimento

```bash
npm run collect    # captura
npm run parse      # materializa entidades, features e URLs de midia
npm run media      # baixa as imagens ANTES das URLs expirarem
npm run enrich     # opcional, custa creditos da API
```

## So o Explorar vira post

O mesmo endpoint graphql serve o Explorar, o feed da home e a pagina de
perfil. Se o parser confiasse no endpoint, o banco encheria de posts das
contas visitadas pelo `authors` — o que e um censo de perfis, nao descoberta.

Por isso cada resposta bruta guarda a pagina que estava aberta no momento da
captura (`raw_response.page_url`), e so vira post o que foi capturado em
`/explore`. Tudo o mais continua guardado no bruto, mas nao entra no dataset.

Quando o parser muda, o que ja foi processado nao e reprocessado sozinho:

```bash
npm run parse -- --reset
```

As URLs do CDN sao assinadas e expiram em poucas horas. Rodar `media` logo
depois de `parse` e o que decide se a analise visual vai existir ou nao.

## Proximas fases

- Fase 3, o que falta: transcricao de reels (whisper + ffmpeg). Hoje a analise
  cobre imagem e legenda, que e o grosso do Explorar.
- Fase 4: clusters, score de oportunidade e geracao de ideias. Atencao: a
  Anthropic nao tem API de embeddings — vai precisar de outro provedor
  (Voyage AI, OpenAI ou um modelo local) so para essa etapa.
- Fase 4: clusters, score de oportunidade e geracao de ideias

## Nota sobre o banco

SQLite cobre bem as Fases 1 a 3. O unico ponto em aberto e a busca por
similaridade da Fase 4: sem pgvector, os embeddings ficam em JSON e a
comparacao e feita em memoria — suficiente ate uns poucos milhares de posts,
que e a ordem de grandeza do PoC. Se o volume crescer, a migracao para
Postgres + pgvector mexe so em `src/db/`.
