# instagram-insights

Radar de conteúdo para creators. Para cada creator (persona), acha o que o
público que ele quer atrair consome no Instagram e transforma isso numa pauta
semanal dentro do território dele. O fluxo completo está em
**[docs/creator.md](docs/creator.md)**.

```bash
npm run painel     # abas Pauta, Creator e Sementes
npm run semana     # o ciclo inteiro da persona ativa
```

A parte de Explorar e busca por termos (abaixo) continua funcionando como
fonte secundária.

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
npm run busca      # pesquisa o proximo termo de termos.txt e rola os resultados
npm run termos     # fila de termos: quantas vezes e quando cada um foi pesquisado
npm run ranking    # posts e autores achados nas buscas, por engajamento
npm run acompanhar # visita os perfis marcados como "acompanhar" e grava os posts novos
npm run marcar -- @conta acompanhar   # (ou ignorar / limpar) o mesmo que os botoes do painel
npm run acompanhando                 # lista as contas marcadas
npm run prompt -- contas --saida p.txt   # prompt de classificacao para levar a uma LLM (o mesmo da aba IA)
npm run importar -- resposta.txt         # grava a resposta da LLM no banco
npm run prompt -- selecao --vagas 15     # rodada "quem acompanhar": a LLM escolhe N contas
npm run parse      # processa os payloads brutos e materializa as entidades
npm run authors    # visita perfis para preencher o numero de seguidores
npm run media      # baixa imagens, videos e legendas; converte os .srt
npm run whisper    # transcreve os videos com whisper local (opcional)
npm run enrich     # OPCIONAL: analise com o Claude (imagem + legenda -> JSON)
npm run models     # lista os ids de modelo validos na sua conta Anthropic
npm run painel     # painel local: Explorar, Busca, Autores e Sessões do dia
npm run purge      # remove o que nao veio do Explorar nem da busca e fecha sessoes penduradas
npm run status     # orcamento, circuit breaker e totais
npm run plan       # decide se esta hora vira sessao (para o cron horario)

# creator (docs/creator.md)
npm run persona -- criar "Lucas"      # ou pela aba Creator
npm run sementes -- @a @b @c          # ou pela aba Sementes
npm run seguindo   # coleta a lista de "seguindo" das sementes
npm run grafo      # quem as sementes seguem em comum
npm run ia -- territorio|contas|encaixe|pauta
npm run semana     # tudo isso em ordem; --sem-coleta pula o navegador
npm run arquivar   # guarda o banco atual em data/archive e comeca do zero
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

## Explorar e busca: de onde vem cada post

O mesmo endpoint graphql serve o Explorar, a busca, o feed da home e a pagina
de perfil. Se o parser confiasse no endpoint, o banco encheria de posts das
contas visitadas pelo `authors` e de quem voce segue.

Por isso cada resposta bruta guarda a pagina aberta no momento da captura
(`raw_response.page_url`), e so viram post duas fontes:

- **Explorar**: so o grid (`discover/web/explore_grid`) com `/explore/` aberto.
  O graphql que chega junto e o feed da home carregando por baixo, e fica de fora.
- **Busca**: a resposta `xdt_fbsearch__top_serp_graphql` com
  `/explore/search/keyword/?q=...` aberto. O termo sai da URL.

Cada aparicao vira uma linha em `discovery` (post, origem, termo, posicao,
sessao). O post e um so; `post.discovery_source` guarda a origem principal
(Explorar ganha da busca). O painel mostra so o Explorar; a busca aparece no
`npm run ranking`.

Os termos ficam em `termos.txt`, um por linha. `npm run busca` sem argumento
pega o que esta ha mais tempo sem ser pesquisado; `npm run busca -- "mvp"`
pesquisa um termo avulso. Teto diario em `MAX_SEARCH_SESSIONS_PER_DAY`
(padrao 6) e rolagens em `SEARCH_SCROLLS` (padrao 6).

Quando o parser muda, o que ja foi processado nao e reprocessado sozinho:

```bash
npm run parse -- --reset
```

O `--reset` tambem reclassifica o endpoint de cada resposta com a regra atual.

As URLs do CDN sao assinadas e expiram em poucas horas. Rodar `media` logo
depois de `parse` e o que decide se a analise visual vai existir ou nao.

## Acompanhamento de autores

1. **Decisao (sua).** Na aba Autores, **Acompanhar** ou **Ignorar**. Fica salvo
   em `author.watch`.
2. **Visita.** `npm run acompanhar` abre o perfil de quem esta marcado (os que
   foram visitados ha mais tempo primeiro, no maximo `WATCH_PER_SESSION` por vez
   e nunca antes de `WATCH_MIN_HOURS`), rola um pouco e grava os posts. So os
   posts do proprio dono entram, com origem `profile`; perfis abertos por
   outros motivos (o `authors`) continuam sem virar post.
3. **Leitura.** A aba Acompanhando mostra os posts dessas contas, do mais novo
   para o mais antigo.

A avaliacao de relevancia e o tipo de cada conta (concorrente, referencia,
publico, fora) vao ser feitos por LLM, seguindo docs/criterios.md. A primeira
versao, por palavras-chave, foi removida: sem entender contexto ela escondia e
promovia coisa errada.

## Classificacao por LLM (aba IA)

1. Na aba **IA**, escolha Contas ou Posts e o tamanho do lote e clique em
   **Gerar prompt**. O prompt leva os criterios de `docs/criterios.md`, suas
   correcoes (como exemplo) e os itens ainda nao avaliados: primeiro os que voce
   acompanha, depois os que mais aparecem nas buscas.
2. **Copiar** e colar numa conversa nova com a LLM.
3. Colar a resposta inteira (com o bloco ```json) em **Colar a resposta** e
   **Importar**. O painel reconhece o tipo, valida cada item e grava na tabela
   `classification`. Ids desconhecidos e itens fora do formato sao listados.
4. A classificacao aparece em Autores (coluna e filtro "Classe (IA)", "para
   revisar" quando a confianca e baixa) e nos posts (filtro "Relevancia (IA)",
   angulo no detalhe). No detalhe de uma conta ou post da para **Corrigir**; a
   correcao vale sobre a LLM e vira exemplo nos proximos prompts.

### Quem acompanhar (rodada de selecao)

Na avaliacao de contas a LLM tambem responde `acompanhar: true/false`, um
filtro inicial largo. Como nao da para acompanhar todas, a opcao **Quem
acompanhar** na aba IA junta todas as sugeridas (menos as que voce ignorou ou
que a IA chamou de "fora") e pede para a LLM escolher so N (10, 15, 20 ou 30
vagas). As que voce marcou a mao entram como fixas e ocupam vaga.

Ao importar, as escolhidas viram "acompanhar" com origem IA (botao "★ IA #n");
as que a IA tinha escolhido antes e agora ficaram de fora perdem a marcacao.
O que voce marcou ou ignorou nunca e alterado pela IA.

O formato e o mesmo que a API da Anthropic vai usar quando houver creditos: so
muda quem responde.

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
