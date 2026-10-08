# Creator: pauta semanal a partir do que o público consome

O sistema serve a um **creator** (o Lucas é o cliente zero), não à marca. A
pergunta deixou de ser "a KXP tiraria daqui um post para quem compra software?"
e virou: **o que o público que ele quer atrair já assiste, e o que disso cabe no
território dele?**

## Peças

| peça | o que é | onde fica |
|---|---|---|
| **Persona** | um creator. Várias podem existir; só uma fica ativa | aba Creator · tabela `persona` |
| **Entrevista** | 5 perguntas curtas (só as 2 primeiras obrigatórias), respondidas pelo próprio creator | aba Creator · `src/creator/tipos.ts` |
| **Território** | temas profissionais, lado pessoal, opiniões, histórias, tom, formatos e o que fica **fora**. Gerado pela IA a partir da entrevista e editável. "Fora" só o creator escreve | `persona.territorio` |
| **Sementes** | perfis reais do público que o creator quer atrair | aba Sementes · `semente` |
| **Grafo** | quem as sementes seguem em comum | `seguindo`, `persona_conta` |
| **Encaixe** | cada post das contas consumidas: dentro, radar ou fora do território | `encaixe` |
| **Pauta** | 5 ideias por semana + até 3 temas de radar, com feedback | aba Pauta · `ideia` |

## Ciclo diário (`npm run semana`, ou "Rodar o ciclo" no painel)

Pode rodar todo dia: cada etapa só faz o que falta (seguindo a cada 7 dias por semente, visita a cada 20h por conta, encaixe só de posts novos) e a pauta **acrescenta** ideias à semana a partir de posts que ainda não viraram ideia. Nada é apagado. `npm run ia -- pauta --refazer` (só no terminal) troca as ideias ainda sem resposta.


1. **seguindo** — abre o perfil de cada semente vencida (`SEGUINDO_MIN_DIAS`), clica em "seguindo" e rola o modal até `SEGUINDO_MAX_POR_SEMENTE`. Só escuta as respostas (`friendships/<id>/following`), nunca monta requisição. Privada fica marcada e sai da fila.
2. **grafo** — conta entra quando é seguida por pelo menos 30% das sementes com lista (mínimo 2; `GRAFO_MIN_SEMENTES` fixa outro valor). As `GRAFO_MAX_CONTAS` mais citadas viram "acompanhar" (`watch_source = grafo`). Marcação sua nunca é alterada.
3. **acompanhar** — visita essas contas (bio + posts), `SEMANA_RODADAS_ACOMPANHAR` rodadas.
4. **whisper** — transcreve os reels das contas desta persona dentro da janela, do mais novo para o mais velho, todos de uma vez (`WHISPER_POR_CICLO` limita, se precisar; 0 = todos). Se ffmpeg e whisper não estiverem instalados, pula. Reel que já tinha passado pelo encaixe só com a legenda é reavaliado quando a transcrição chega.
5. **contas** — a IA diz o que cada conta visitada é: **consumido** (produz o que o público assiste), **par** (é o próprio público: vira semente *sugerida*) ou **fora**. Par e fora saem do acompanhamento.
6. **encaixe** — a IA lê os posts das contas consumidas dos últimos `JANELA_DIAS` dias com o território: **dentro** (vira pauta), **radar** (o público consome, mas o creator não declarou o tema) ou **fora**. Mudou o território, o encaixe é refeito.
7. **pauta** — os posts "dentro" são pontuados e os melhores vão para a IA, que devolve `PAUTA_IDEIAS` ideias: referência, por que o público assiste, ângulo do creator, hook e formato. Sem roteiro, de propósito. O radar é agrupado por tema, sem IA.

Uma etapa que falha não derruba as seguintes. `npm run semana -- --sem-coleta` pula as que abrem o navegador; `--etapas grafo,contas` roda só essas.

## Roteiro

No detalhe de uma ideia da pauta (clique no card, ou no link "Roteiro"), a seção Roteiro gera o texto que o creator fala, bloco a bloco: duas ou três opções de gancho, cada trecho com tempo, fala, texto na tela e visual (slide a slide no carrossel, story a story nos stories), chamada final, legenda e uma lista "antes de gravar". A IA (modelo da pauta) recebe a ideia, o post do assunto com legenda e transcrição, o post de formato quando houver, o território e a entrevista como amostra de como ele fala.

Quando o ângulo termina com "Pergunta para...", o painel mostra a pergunta com um campo para a resposta. Responder é opcional: com resposta, o roteiro conta a história dele; sem resposta, sai pronto para gravar, apoiado em exemplos típicos do assunto contados como observação ou opinião (nunca um acontecimento inventado da vida dele), e as dicas dizem onde trocar por um caso real. Cada geração é uma versão (v1, v2...): dá para pedir ajuste ("mais curto", "outro gancho"), editar o texto à mão, copiar e marcar como gravado (o que também marca a ideia como "vou postar"). Ideia com roteiro não é apagada pelo refazer da pauta. Sem chave de API, "Copiar prompt" e colar a resposta faz o mesmo. Pelo terminal: `npm run roteiro -- <id-da-ideia> [--resposta "..."] [--pedido "..."] [--prompt]`.

## Assunto e formato: dois eixos

- **Referências de conteúdo** (aba Sementes) são pessoas como o creator: CEOs e founders de software house ou de produto que postam conteúdo próprio. Elas são visitadas como as contas do grafo, e os posts delas passam pelo encaixe. Daqui vem o **assunto** da pauta.
- **O grafo das sementes** mostra o **formato** que o público consome: tipo de post, duração, gancho, primeira linha. Quando o post do assunto rendeu no nível normal do autor ou acima, o formato dele mesmo basta. Só quando o assunto é bom mas o post não engajou a ideia ganha um formato sugerido, tirado dos posts do grafo que mais renderam (F1, F2...); aí o card mostra os dois posts.
- Post de referência não precisa ser seguido pelas sementes: entra com alcance fixo de 0,5 e disputa pelo desempenho e pela confiança.
- `npm run referencias -- --sugestoes` importa `docs/referencias-sugeridas.txt` como sugeridas, para conferir e ativar.

## A régua

```
score = alcance × desempenho × (0,5 + 0,5 × confiança)
alcance    = sementes que seguem o autor / sementes com lista
desempenho = (curtidas + comentários) / mediana do próprio autor, entre 0,2 e 5
             (neutro = 1 com menos de 3 posts do autor no banco)
```

Engajamento absoluto e tamanho do autor quase não pesam: uma conta pequena que
5 das 10 sementes seguem vale mais que um perfil gigante que só uma segue. No
máximo 3 posts por autor chegam à IA da pauta, e post que já virou ideia em
outra semana não volta.

## Feedback

- **Vou postar / Recusar.** Recusa exige motivo: *não é meu tema*, *não é meu tom*, *já falei disso*, *ideia fraca*. "Não é meu tema" entra no prompt do encaixe; todos entram no prompt da pauta.
- **Radar: adotar.** O tema entra no território (pessoal ou profissional) e passa a gerar pauta. "Não é pra mim" tira o tema do radar para sempre.
- **Correções.** No grafo dá para trocar o papel de uma conta; na lista "Posts que o sinal apontou" (aba Pauta), o encaixe de um post. A sua correção vale sobre a IA.

## IA

Com `ANTHROPIC_API_KEY` no `.env`, tudo roda pela API (`CREATOR_MODEL`, e
`PAUTA_MODEL` só para a pauta, que merece um modelo melhor que o haiku). Sem
chave, cada tarefa tem o fluxo manual no painel ("IA à mão") ou no terminal:

```bash
npm run ia -- encaixe --prompt p.txt      # grava o prompt
npm run ia -- encaixe --resposta r.txt    # aplica a resposta colada
```

## Começar do zero

```bash
npm run arquivar     # move banco, brutos e mídias para data/archive/<data> (feche o painel antes)
npm run db:push      # cria as tabelas novas (também funciona sem arquivar)
npm run painel       # aba Creator: crie o creator, responda a entrevista, gere o território
                     # aba Sementes: cadastre ~10 perfis do público
npm run semana       # ou "Rodar a semana inteira" na aba Pauta
```

## O que ficou da tese antiga

Explorar, busca por termos, a aba IA e o `docs/criterios.md` continuam no
código, mas como fonte secundária. Não alimentam a pauta.

## Riscos conhecidos

- A lista de "seguindo" é a ação mais visível do coletor. Tem orçamento próprio (`MAX_FOLLOWING_SESSIONS_PER_DAY`), conta no circuit breaker e respeita o `STOP`.
- O seletor do link "seguindo" (`a[href="/<semente>/following/"]`) e o formato de `friendships/<id>/following` vêm do web atual do Instagram. Se a coleta devolver "nenhuma conta capturada", rode `npm run sonda` numa página de perfil e confira o bruto.
