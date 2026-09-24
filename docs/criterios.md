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

## Relevância do post

O post é julgado sozinho, independente de quem publicou. Um concorrente posta
foto de confraternização; um perfil qualquer pode viralizar falando de MVP.

| nível | temas |
|---|---|
| **alta** | construir ou validar MVP; terceirizar vs. montar time próprio; squads e alocação; custo, prazo e escopo de software; modernização de sistema legado; IA aplicada a negócio; cases e bastidores de projeto |
| **média** | startup e produto digital em geral; liderança técnica; gestão de time de tecnologia; transformação digital; dados para decisão |
| **baixa** | tutorial ou dica técnica para dev; carreira em programação; tech de consumo; motivacional genérico; institucional sem conteúdo (aniversário, confraternização) |

## Como vira número

- **Post:** relevância × engajamento normalizado (curtidas + comentários,
  divididos pelos seguidores). O melhor sinal de ideia de conteúdo é o post de
  relevância alta que performou **acima da média do próprio autor**.
- **Autor:** % de posts com relevância alta ou média × taxa mediana de
  engajamento. Um perfil que viralizou uma vez por acaso não sobe na lista.

## Saída esperada do LLM

Por autor, em JSON fixo:

```json
{
  "classe": "concorrente | referencia_lideranca | referencia_produto | publico | fora",
  "confianca": 0.0,
  "justificativa": "uma frase",
  "posts": [
    { "shortcode": "...", "relevancia": "alta | media | baixa", "tema": "..." }
  ]
}
```

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
