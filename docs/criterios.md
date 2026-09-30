# Critérios de relevância

Este arquivo define o que o sistema considera relevante. É a base do prompt que
classifica autores e posts, então mudar aqui muda o comportamento do bot.
Rascunho v1 — revisar com o time.

## A KXP

- **Perfil:** @kxptech — Belo Horizonte, MG
- **O que vende:** desenvolvimento de software sob medida, em dois formatos:
  - **alocação dinâmica de squads** para grandes empresas
  - **MVP** para quem tem uma ideia e quer testar antes de investir pesado
  - além de soluções de tecnologia, dados e IA aplicada a negócio
- **Quem compra:** o diretor ou gestor (de TI ou de negócio) de uma empresa
  grande, e o founder com uma ideia.
- **Quem não compra:** desenvolvedor. O Instagram da KXP **não** é voltado
  para devs — conteúdo técnico para programador fica fora do alvo, por mais que
  engaje.

## Classes de autor

| classe | quem é | sinais |
|---|---|---|
| **concorrente** | outra software house, consultoria, fábrica de software ou product studio que vende o mesmo que a KXP | bio com "software house", "desenvolvimento sob medida", "squads", "outsourcing", "alocação", "MVP", "product studio"; posts de case de cliente; chamada para contato comercial |
| **referência: liderança** | CTO, CPO, COO, CEO de empresa de tecnologia, head de engenharia ou de produto | cargo na bio; posts sobre decisões de tecnologia, gestão de times, produto |
| **referência: produto** | startup, SaaS, aceleradora, fundo, empresa de produto digital | posts sobre validação, tração, lançamento, crescimento |
| **público** | founder ou gestor falando das próprias dores | "estou construindo", "meu time de TI", "preciso de um dev", dúvidas sobre contratar |
| **fora** | tudo que não é nenhum dos acima | conteúdo para dev (tutorial, carreira, curso), tech de consumo, motivacional genérico |

### Casos de dúvida

- **Agência de marketing que faz site** → fora. A KXP não vende site institucional.
- **Agência no-code / low-code que faz MVP** → concorrente. Disputa o mesmo founder.
- **Consultoria de IA ou dados** → concorrente. Disputa o mesmo cliente que a frente de IA da KXP.
- **Dev freelancer que posta sobre trabalhos** → fora, a não ser que venda para empresas com cara de consultoria.
- **Consultoria gigante (CI&T, Stefanini, Accenture)** → concorrente, mas de outro porte. Serve mais de referência de posicionamento do que de comparação direta.
- **Criador de conteúdo sobre startups** → referência: produto.
- **Quem vende sistema pronto** (ERP, CRM, SaaS de nicho, "demos prontas") → fora, a não ser que o foco seja personalizar ou desenvolver sob medida.
- **Consultoria contábil, jurídica, de RH ou de marketing** que cita "outsourcing" → fora. Concorrente vende desenvolvimento de software.
- **Coach ou mentor de vendas / negócios** → fora, a não ser que fale de tecnologia na empresa.

## Relevância do post

O post é julgado sozinho, independente de quem publicou. Um concorrente posta
foto de confraternização; um perfil qualquer pode viralizar falando de MVP.

A pergunta é: **a KXP tiraria daqui uma ideia de conteúdo para quem compra
software?** Falar do assunto certo não basta; o post precisa ter substância
(um argumento, um dado, um case, uma opinião, um erro comum explicado).

| nível | quando |
|---|---|
| **alta** | tema da lista abaixo **e** conteúdo com substância que a KXP poderia transformar em post próprio |
| **média** | tema da lista abaixo tratado de forma rasa; ou tema de média com substância; ou anúncio de concorrente que mostra um posicionamento claro (útil para comparar, não para copiar) |
| **baixa** | todo o resto: tema fora da lista, conteúdo para dev, institucional, anúncio genérico |

Temas de **alta:** construir ou validar MVP; terceirizar vs. montar time
próprio; squads e alocação; custo, prazo e escopo de software; modernização de
sistema legado; IA aplicada a negócio (em empresa, não produtividade pessoal);
cases e bastidores de projeto de software.

Temas de **média:** startup e produto digital em geral; liderança técnica;
gestão de time de tecnologia; transformação digital; dados para decisão.

Sempre **baixa:** tutorial ou dica técnica para dev; carreira em programação;
meme; tech de consumo; ferramenta de IA para produtividade pessoal; motivacional
genérico; institucional sem conteúdo (aniversário, confraternização, "bem-vindo
à empresa X").

### Formato do post

| formato | o que é |
|---|---|
| **anuncio** | chamada comercial: "precisa de um sistema? nós fazemos", lista de serviços, "fale conosco" |
| **educativo** | explica um conceito, um processo, um erro comum |
| **opiniao** | defende uma posição, provoca, compara caminhos |
| **case** | projeto ou cliente real, com contexto e resultado |
| **bastidor** | rotina do time, processo interno, como a empresa trabalha |
| **noticia** | fato do mercado, lançamento, número novo |
| **meme** | humor |
| **outro** | nenhum dos acima |

### Casos de dúvida (posts)

- **Anúncio de software house** ("transformamos ideias em sistemas sob medida",
  "sua empresa precisa de um app?") → no máximo **média**, mesmo que o tema seja
  de alta. Só vira alta se trouxer um argumento concreto que vale discutir.
- **Vendas, marketing, atendimento ou CRM para pequeno negócio** → baixa, a não
  ser que o ponto central seja construir ou escolher software.
- **Automação para loja, e-commerce ou vendedor de marketplace** → baixa.
- **"IA vai substituir programador", "criança fez app com IA"** → média no
  máximo; é assunto de dev, a não ser que fale da decisão da empresa.
- **História de empresa famosa usada como metáfora** (ex.: Apple não tem fábrica)
  → alta só se a conclusão for sobre terceirizar ou construir software.

### Confiança

Use a escala inteira. 0.9 ou mais só quando a legenda ou a fala deixam o caso
óbvio. Legenda curta, só hashtags, sem fala do vídeo, ou caso de dúvida acima →
0.6 ou menos.

## Quem acompanhar

Acompanhar = um robô visita o perfil de tempos em tempos. As vagas são poucas.

- **Sim:** concorrente (qualquer porte, principalmente os do Brasil) e
  referência de liderança ou de produto que posta sobre temas de relevância
  alta ou média.
- **Sim, se ativo:** público (founder ou gestor falando das próprias dores)
  que posta com frequência — mostra as dores de quem compra.
- **Não:** fora do tema; perfil parado; conta que só apareceu por um post
  isolado sem relação com o resto do que publica.

## Como vira número

- **Post:** relevância × engajamento normalizado (curtidas + comentários,
  divididos pelos seguidores). O melhor sinal de ideia de conteúdo é o post de
  relevância alta que performou **acima da média do próprio autor**.
- **Autor:** % de posts com relevância alta ou média × taxa mediana de
  engajamento. Um perfil que viralizou uma vez por acaso não sobe na lista.

## Saída esperada do LLM

O prompt é montado pelo painel (aba IA) ou por `npm run prompt -- contas|posts`
e usa as seções deste arquivo de "A KXP" até "Relevância do post". A resposta
volta como uma lista JSON, um objeto por item, e é colada de volta na aba IA
(ou importada com `npm run importar -- arquivo.txt`).

Contas:

```json
[{ "id": "@usuario", "classe": "concorrente | referencia_lideranca | referencia_produto | publico | fora",
   "confianca": 0.0, "motivo": "uma frase com a evidência", "sinais": ["..."] }]
```

Posts:

```json
[{ "id": "SHORTCODE", "relevancia": "alta | media | baixa", "publico": "comprador | dev | geral",
   "formato": "anuncio | educativo | opiniao | case | bastidor | noticia | meme | outro", "tema": "...", "angulo": "o que a KXP pode aproveitar", "confianca": 0.0, "motivo": "..." }]
```

Confiança abaixo de 0.6 aparece como "para revisar". Sua correção no painel vale
sobre a da LLM e entra como exemplo nos próximos prompts.

## Palavras de busca

A lista em uso fica em `termos.txt`, na raiz do projeto, em quatro grupos:
concorrentes, founders, grandes empresas e referências. Os termos seguem
como o comprador ou a software house escreve, e não como o dev escreve. A
primeira busca, "desenvolvimento de software", trouxe quase só conteúdo
para dev e saiu da lista.

## Lista semente de concorrentes

Levantada em rankings e diretórios de software houses (set/2026). Serve de
ponto de partida e de exemplo no prompt; a busca completa o resto.
**Instagram** marcado com ✓ foi confirmado; o resto precisa ser verificado.

### Porte e oferta parecidos com os da KXP

| empresa | cidade | por que | instagram |
|---|---|---|---|
| Codeminer42 | — | software boutique, desenvolvimento sob medida | @codeminer42 ✓ |
| Cheesecake Labs | Florianópolis, SC | desenvolvimento de produto e IA | @cheesecakelabs ✓ |
| Jera | — | product studio, apps e MVP | @jera_labs ✓ |
| ioasys | Belo Horizonte, MG | produto digital, dados e IA — **mesma cidade** | @ioasys ✓ |
| Ateliware | Curitiba, PR | sob medida, squads, discovery com IA | @ateliware ✓ |
| dti digital | Minas Gerais | squads ágeis — **mesmo estado** | a confirmar |
| Squadra Digital | Belo Horizonte, MG | aplicações, automação, IA — **mesma cidade** | a confirmar |
| Kunumi | Belo Horizonte, MG | IA aplicada a negócio — **mesma cidade** | a confirmar |
| App Masters | Juiz de Fora, MG | apps, agentes de IA, integrações | a confirmar |
| Mind Group | Sorocaba, SP | sob medida, squads, IA | a confirmar |
| Espresso Labs | São Paulo, SP | plataformas digitais, squads | a confirmar |
| UDS Tecnologia | São Paulo, SP | sob medida, MVP, alocação | a confirmar |
| Luby | São Paulo, SP | outsourcing e squads | a confirmar |
| NextAge | Curitiba, PR | outsourcing e squads | a confirmar |
| Supero | Joinville, SC | outsourcing e squads | a confirmar |
| DBServer | Porto Alegre, RS | squads especialistas, discovery ao delivery | a confirmar |
| Zallpy | Porto Alegre, RS | sob medida, modernização de legado | a confirmar |
| Pitang | Recife, PE | sob medida, coprodução de startups | a confirmar |
| Vizir Software Studio | São Paulo, SP | sob medida, sistemas corporativos | a confirmar |
| Labcodes | Recife, PE | product studio, design + engenharia | a confirmar |

### Grandes (referência de posicionamento)

CI&T · Stefanini · BRQ · FCamara · DB1 · Thoughtworks

### Fontes

- Softdex — software houses de BH e MG: https://softdex.com.br/blog/as-melhores-software-houses-de-belo-horizonte-e-minas-gerais-em-2026
- Softdex — outsourcing de TI: https://softdex.com.br/especialidades/outsourcing-de-ti
- Softdex — maiores software houses do Brasil: https://softdex.com.br/blog/as-maiores-software-houses-do-brasil-em-2026
- Ateliware — top 10 desenvolvimento sob medida: https://ateliware.com/pt-br/business/top-10-empresas-software-houses-desenvolvimento-software-sob-medida/

## Em aberto

- Conferir os @ marcados "a confirmar" (o comando `authors` pode fazer isso visitando o perfil).
- Validar os casos de dúvida com o time.
- Decidir se a frente de dados e IA entra com palavras de busca próprias.
