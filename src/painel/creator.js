// Abas do creator (Pauta, Creator, Sementes). Carregado pelo index.html;
// o index chama window.Creator.render(aba) quando uma destas abas abre.
(() => {
  const TABS = ['pauta', 'creator', 'sementes'];
  const FORMATOS = { reels_fala: 'Reels falando', reels_bastidor: 'Reels bastidor', carrossel: 'Carrossel', foto_legenda: 'Foto + legenda', stories: 'Stories' };
  const PAPEL = { consumido: 'Consumido', par: 'Par (público)', fora: 'Fora', candidata: 'A avaliar' };
  const ENC = { dentro: 'Dentro', radar: 'Radar', fora: 'Fora' };

  let D = null;
  let tab = 'pauta';
  let personaId = null;
  let semana = null;
  let dia = null;
  // por dia ou por semana: lembrado neste navegador
  let visao = (() => { try { return localStorage.getItem('cx-visao') || 'dia'; } catch { return 'dia'; } })();
  let JOB = null;
  let jobTimer = null;
  let manual = { tipo: 'territorio', prompt: '', info: '' };
  const abertos = new Set(); // ids de ideias com o painel de recusa aberto

  const root = document.getElementById('view-creator');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
  const quando = (ts) => (ts ? df.format(new Date(ts * 1000)) : '—');
  const ig = (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`;
  const igp = (sc) => `https://www.instagram.com/p/${encodeURIComponent(sc)}/`;

  async function getJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || `o servidor respondeu ${r.status}`);
    return j;
  }
  async function postJson(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || `o servidor respondeu ${r.status}`);
    return j;
  }
  async function acao(nome, dados = {}) {
    try {
      const r = await postJson('/api/creator/acao', { acao: nome, persona: D?.persona?.id, ...dados });
      await carregar();
      draw();
      return r;
    } catch (e) {
      aviso(e.message, true);
      return null;
    }
  }
  function aviso(msg, ruim) {
    let el = document.getElementById('cx-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cx-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = ruim ? 'bad show' : 'show';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = ''), ruim ? 7000 : 3000);
  }

  async function carregar() {
    const q = new URLSearchParams();
    if (personaId) q.set('persona', personaId);
    q.set('visao', visao);
    if (visao === 'dia' && dia) q.set('dia', dia);
    if (visao === 'semana' && semana) q.set('semana', semana);
    D = await getJson('/api/creator?' + q);
    if (D.persona) personaId = D.persona.id;
    if (visao === 'dia') dia = D.dia || dia;
    else semana = D.semana || semana;
    const n = document.getElementById('n-pauta');
    if (n) n.textContent = (D.ideias || []).filter((i) => i.tipo === 'pauta' && i.status === 'nova').length || '';
  }

  /* ---------------------------------------------------------------- execucao */

  async function pollJob() {
    try {
      const r = await getJson('/api/creator/job');
      const antes = JOB?.rodando;
      JOB = r.job;
      desenharJob();
      if (JOB?.rodando) {
        clearTimeout(jobTimer);
        jobTimer = setTimeout(pollJob, 1500);
      } else if (antes) {
        await carregar();
        draw();
        aviso(JOB.codigo === 0 ? `${JOB.rotulo}: pronto` : `${JOB.rotulo}: terminou com erro (veja o log)`, JOB.codigo !== 0);
      }
    } catch { /* servidor fora do ar */ }
  }
  async function rodar(cmd, conta) {
    try {
      await postJson('/api/creator/job', { cmd, conta });
      JOB = { rodando: true, rotulo: conta ? `${cmd.replace('conta-', '')} @${conta}` : cmd, saida: [], inicio: Date.now() };
      desenharJob();
      setTimeout(pollJob, 600);
    } catch (e) {
      aviso(e.message, true);
    }
  }
  function desenharJob() {
    for (const b of root.querySelectorAll('[data-run], [data-cacao]')) b.disabled = Boolean(JOB?.rodando) || !D?.persona?.ativa;
    const st = document.getElementById('cx-jobst');
    const log = document.getElementById('cx-log');
    if (!st || !log) return;
    if (!JOB) {
      st.innerHTML = '';
      log.hidden = true;
      return;
    }
    const dur = Math.round(((JOB.fim || Date.now()) - (JOB.inicio || Date.now())) / 1000);
    st.innerHTML = JOB.rodando
      ? `<span class="pill p-run">rodando</span> <b>${esc(JOB.rotulo)}</b> <span class="motivos">${dur}s</span> <button class="cx-lnk" type="button" id="cx-parar">parar</button>`
      : `<span class="pill ${JOB.codigo === 0 ? 'p-ok' : 'p-bad'}">${JOB.codigo === 0 ? 'ok' : 'erro'}</span> <b>${esc(JOB.rotulo)}</b> <span class="motivos">${dur}s</span>`;
    log.hidden = false;
    const fim = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.textContent = (JOB.saida || []).join('\n');
    if (fim) log.scrollTop = log.scrollHeight;
    document.getElementById('cx-parar')?.addEventListener('click', () => postJson('/api/creator/job', { parar: true }).then(pollJob));
  }
  function caixaExecucao(cmds, titulo, texto) {
    const ativa = D.persona?.ativa;
    const btn = (c, pri) => `<button type="button" class="${pri ? 'btn-pri' : 'reload'}" data-run="${c[0]}">${esc(c[1])}</button>`;
    return `<div class="iabox cx-run">
      <h2 class="h2">${titulo}</h2>
      <p>${texto}${ativa ? '' : ' <b>Torne esta persona ativa para rodar.</b>'}</p>
      <div class="iarow">${cmds.map((c, i) => btn(c, i === 0)).join('')}</div>
      <div id="cx-jobst"></div><pre id="cx-log" hidden></pre>
    </div>`;
  }

  /* ---------------------------------------------------------------- IA manual */

  function caixaManual(tipos) {
    if (D.api.chave && !manual.forcar) {
      return `<p class="motivos cx-mt">As tarefas de IA rodam pela API (${esc(D.api.modelo)}). <button type="button" class="cx-lnk" id="cx-manual-on">Fazer à mão (copiar o prompt)</button></p>`;
    }
    if (!tipos.includes(manual.tipo)) manual = { ...manual, tipo: tipos[0], prompt: '', info: '' };
    const nomes = { territorio: 'Território', contas: 'Contas', encaixe: 'Encaixe', pauta: 'Pauta' };
    return `<div class="iabox">
      <h2 class="h2">IA à mão</h2>
      <p>${D.api.chave ? '' : 'Sem <code>ANTHROPIC_API_KEY</code> no .env. '}Gere o prompt, cole numa conversa com a LLM e traga a resposta de volta. O resultado é o mesmo da API.</p>
      <div class="iarow">
        <div class="seg" id="cx-mtipo">${tipos.map((t) => `<button type="button" data-t="${t}" aria-pressed="${manual.tipo === t}">${nomes[t]}</button>`).join('')}</div>
        <button type="button" class="btn-pri" id="cx-mgerar">Gerar prompt</button>
        <button type="button" class="reload" id="cx-mcopiar" ${manual.prompt ? '' : 'disabled'}>Copiar</button>
        <span class="motivos">${esc(manual.info)}</span>
      </div>
      <textarea id="cx-mprompt" readonly placeholder="O prompt aparece aqui.">${esc(manual.prompt)}</textarea>
      <textarea id="cx-mresp" placeholder="Cole aqui a resposta inteira da LLM, com o bloco json" style="margin-top:10px;min-height:140px"></textarea>
      <div class="iarow" style="margin-top:10px"><button type="button" class="btn-pri" id="cx-mimportar">Importar</button><span class="iares" id="cx-mres"></span>
      ${D.api.chave ? '<button type="button" class="cx-lnk" id="cx-manual-off">voltar para a API</button>' : ''}</div>
    </div>`;
  }
  function ligarManual() {
    document.getElementById('cx-manual-on')?.addEventListener('click', () => { manual.forcar = true; draw(); });
    document.getElementById('cx-manual-off')?.addEventListener('click', () => { manual.forcar = false; draw(); });
    document.getElementById('cx-mtipo')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      manual = { ...manual, tipo: b.dataset.t, prompt: '', info: '' };
      draw();
    });
    document.getElementById('cx-mgerar')?.addEventListener('click', async () => {
      try {
        const r = await getJson(`/api/creator/tarefa?tipo=${manual.tipo}&persona=${encodeURIComponent(D.persona.id)}`);
        manual.prompt = r.prompt || '';
        manual.info = r.itens ? `${r.itens} itens · ~${nf.format(r.tokens)} tokens` : r.motivo || 'nada a fazer';
      } catch (e) { manual.info = e.message; }
      draw();
    });
    document.getElementById('cx-mcopiar')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(manual.prompt); aviso('Prompt copiado'); } catch { document.getElementById('cx-mprompt').select(); }
    });
    document.getElementById('cx-mimportar')?.addEventListener('click', async () => {
      const texto = document.getElementById('cx-mresp').value;
      const out = document.getElementById('cx-mres');
      try {
        const r = await postJson('/api/creator/tarefa', { tipo: manual.tipo, texto, persona: D.persona.id, modelo: 'manual' });
        const extra = [r.invalidos?.length ? `${r.invalidos.length} fora do formato` : '', r.desconhecidos?.length ? `ids desconhecidos: ${r.desconhecidos.join(', ')}` : ''].filter(Boolean).join(' · ');
        manual.prompt = '';
        manual.info = `${r.gravados} gravados${extra ? ' · ' + extra : ''}`;
        await carregar();
        draw();
      } catch (e) {
        out.className = 'iares bad';
        out.textContent = e.message;
      }
    });
  }

  /* ---------------------------------------------------------------- topo comum */

  function topo() {
    const ps = D.personas || [];
    const f = D.funil;
    return `<div class="cx-bar">
      <label class="motivos" for="cx-persona">Creator</label>
      <select id="cx-persona">${ps.map((p) => `<option value="${p.id}" ${p.id === D.persona?.id ? 'selected' : ''}>${esc(p.nome)}${p.ativa ? ' (ativa)' : ''}</option>`).join('')}</select>
      ${D.persona && !D.persona.ativa ? '<button type="button" class="reload" id="cx-ativar">Tornar ativa</button>' : ''}
      ${f ? `<span class="cx-funil" title="Onde o ciclo da semana está">${[
        [f.sementes, 'sementes'], [f.referencias ?? 0, 'referências'], [f.comLista, 'com lista'], [f.contasGrafo, 'no grafo'], [f.consumidas, 'consumidas'], [f.postsJanela, `posts em ${f.janelaDias}d`], [f.dentro, 'dentro'], [f.radar, 'radar'],
      ].map(([n, t]) => `<span><b>${n}</b> ${t}</span>`).join('<i>›</i>')}</span>` : ''}
    </div>`;
  }
  function ligarTopo() {
    document.getElementById('cx-persona')?.addEventListener('change', async (e) => {
      personaId = e.target.value;
      semana = null;
      manual.prompt = '';
      await carregar();
      draw();
    });
    document.getElementById('cx-ativar')?.addEventListener('click', () => acao('persona.ativar'));
    for (const b of root.querySelectorAll('[data-run]')) b.addEventListener('click', () => rodar(b.dataset.run));
  }

  /* ---------------------------------------------------------------- virar semente */

  const ehSemente = (u) => (D.sementes || []).some((s) => s.username === u && s.status !== 'rejeitada');
  function virarSemente(u) {
    if (!u) return '';
    if (ehSemente(u)) return '<span class="chip">semente</span>';
    return `<button type="button" class="wbtn cx-virar" data-virar="${esc(u)}" title="Adicionar @${esc(u)} como semente">+ semente</button>`;
  }
  function ligarVirar() {
    root.querySelectorAll('[data-virar]').forEach((b) => b.addEventListener('click', async () => {
      const r = await acao('sementes.add', { texto: b.dataset.virar });
      if (r) aviso(r.adicionadas.length ? `@${b.dataset.virar} agora é semente. Rode a coleta de "seguindo" para ela entrar no grafo.` : `@${b.dataset.virar} já era semente`);
    }));
  }

  /* ---------------------------------------------------------------- pauta */

  function thumb(p, grande) {
    if (!p) return `<div class="cx-thumb vazio">sem post</div>`;
    return `<a class="cx-thumb${grande ? '' : ' mini'}" href="${igp(p.shortcode)}" target="_blank" rel="noopener" title="Abrir no Instagram">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy">` : `<span>${esc((p.legenda || '').slice(0, 90))}</span>`}</a>`;
  }
  function cardIdeia(i) {
    const p = i.posts[0];
    let acts;
    if (i.status === 'nova') {
      acts = abertos.has(i.id)
        ? `<div class="cx-recusa">
            <div class="cx-motivos">${Object.entries(D.motivosRecusa).map(([k, v]) => `<button type="button" class="wbtn" data-recusar="${i.id}" data-m="${k}">${esc(v)}</button>`).join('')}</div>
            <input type="text" class="cx-in" id="nota-${i.id}" placeholder="Nota (opcional): o que não serviu" maxlength="600">
            <button type="button" class="cx-lnk" data-cancelar="${i.id}">cancelar</button>
          </div>`
        : `<button type="button" class="btn-pri" data-aceitar="${i.id}">Vou postar</button><button type="button" class="reload" data-abrir="${i.id}">Recusar</button>`;
    } else {
      const rot = i.status === 'aceita' ? '<span class="pill p-ok">aceita</span>' : `<span class="pill p-bad">recusada</span> <span class="motivos">${esc(D.motivosRecusa[i.motivo] || '')}${i.nota ? ` — ${esc(i.nota)}` : ''}</span>`;
      acts = `${rot} <button type="button" class="cx-lnk" data-desfazer="${i.id}">desfazer</button>`;
    }
    return `<article class="cx-ideia st-${i.status}" data-ideia="${i.id}" tabindex="0" title="Ver detalhes">
      ${thumb(p, true)}
      <div class="cx-corpo">
        <div class="cx-meta">${i.createdAt ? `<span class="motivos" title="quando a ideia foi sugerida">${D.visao === 'dia' ? esc(horaDe(i.createdAt)) : `${esc(nomeDia(new Date(i.createdAt * 1000).toLocaleDateString('sv-SE')))} ${esc(horaDe(i.createdAt))}`}</span>` : ''}${i.formato && FORMATOS[i.formato] ? `<span class="chip">${esc(FORMATOS[i.formato])}</span>` : ''}${p ? `<a class="motivos" href="${ig(p.autor)}" target="_blank" rel="noopener">ref. @${esc(p.autor)}</a>${virarSemente(p.autor)}` : ''}</div>
        <h3>${esc(i.titulo)}</h3>
        ${i.hook ? `<blockquote>“${esc(i.hook)}”</blockquote>` : ''}
        ${i.angulo ? `<p><b>Seu ângulo.</b> ${esc(i.angulo)}</p>` : ''}
        ${i.formato && !FORMATOS[i.formato] ? `<p><b>Formato.</b> ${esc(i.formato)}</p>` : ''}
        ${i.porQue ? `<p class="motivos"><b>Por que o público assiste.</b> ${esc(i.porQue)}</p>` : ''}
        ${i.posts[1] ? `<div class="cx-fmtref">${thumb(i.posts[1], false)}<span class="motivos"><b>Formato sugerido de</b> <a href="${ig(i.posts[1].autor)}" target="_blank" rel="noopener">@${esc(i.posts[1].autor)}</a>: o assunto é bom, mas o post de referência não engajou. Use esta forma, não este assunto.</span></div>` : ''}
        <div class="cx-acts">${acts}${i.tipo === 'pauta' && i.status !== 'recusada' ? `<button type="button" class="cx-lnk" data-roteiro="${i.id}">${i.roteiros ? `Ver roteiro (v${i.roteiros})` : 'Roteiro'}</button>` : ''}</div>
      </div>
    </article>`;
  }
  function cardRadar(r) {
    let acts;
    if (r.status === 'nova') {
      acts = `<input type="text" class="cx-in" id="det-${r.id}" placeholder="O que você tem a ver com isso? (opcional)" maxlength="400">
        <div class="cx-acts"><button type="button" class="btn-pri" data-adotar="${r.id}" data-como="pessoal">Adotar (pessoal)</button><button type="button" class="reload" data-adotar="${r.id}" data-como="temas">Adotar (profissional)</button><button type="button" class="cx-lnk" data-dispensar="${r.id}">não é pra mim</button></div>`;
    } else acts = `<span class="pill ${r.status === 'adotado' ? 'p-ok' : 'k-fora'}">${r.status === 'adotado' ? 'adotado no território' : 'dispensado'}</span>`;
    return `<article class="cx-radar" data-ideia="${r.id}" tabindex="0" title="Ver detalhes">
      <h3>${esc(r.titulo)}</h3>
      <p class="motivos">${esc(r.porQue || '')}</p>
      <div class="cx-thumbs">${r.posts.map((p) => thumb(p, false)).join('')}</div>
      <div class="cx-meta">${[...new Set(r.posts.map((p) => p.autor))].map((u) => `<a class="motivos" href="${ig(u)}" target="_blank" rel="noopener">@${esc(u)}</a>${virarSemente(u)}`).join(' ')}</div>
      ${acts}
    </article>`;
  }
  function listaMelhores(xs, tipo) {
    if (!xs.length) return `<p class="motivos">Nenhum post ${tipo === 'dentro' ? 'dentro do território' : 'no radar'} ainda.</p>`;
    return `<div class="tablewrap"><table class="t"><thead><tr><th></th><th>Post</th><th>${tipo === 'dentro' ? 'Tema do território / ângulo' : 'Tema do radar'}</th><th>Sinal</th><th>Encaixe</th></tr></thead><tbody>
      ${xs.map((x) => `<tr>
        <td style="width:64px">${thumb({ shortcode: x.shortcode, thumb: x.thumb, legenda: x.legenda }, false)}</td>
        <td><a href="${ig(x.autor)}" target="_blank" rel="noopener">@${esc(x.autor)}</a> ${virarSemente(x.autor)}<div class="motivos cx-cap">${esc(x.legenda)}</div></td>
        <td>${tipo === 'dentro' ? `<b>${esc(x.temaTerritorio || x.tema || '')}</b><div class="motivos">${esc(x.angulo || '')}</div>` : esc(x.radarTema || '')}</td>
        <td class="motivos">${esc(x.porQue)}</td>
        <td><select class="fix" data-enc="${x.shortcode}"><option value="">(IA) ${ENC[tipo]}</option>${Object.entries(ENC).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }
  /** "Hoje", "Ontem" ou "seg, 06 out" a partir de AAAA-MM-DD (data local) */
  function nomeDia(d) {
    if (!d) return '';
    if (d === D.hoje) return 'Hoje';
    const ontem = new Date(`${D.hoje}T12:00:00`); ontem.setDate(ontem.getDate() - 1);
    const dt = new Date(`${d}T12:00:00`);
    if (dt.toDateString() === ontem.toDateString()) return 'Ontem';
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(dt).replace('.', '');
  }
  const horaDe = (ts) => (ts ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts * 1000)) : '');
  function drawPauta() {
    const ideias = D.ideias.filter((i) => i.tipo === 'pauta');
    const radar = D.ideias.filter((i) => i.tipo === 'radar');
    const semTerr = !D.persona.temTerritorio;
    const porDia = D.visao === 'dia';
    const nd = nomeDia(D.dia);
    const titulo = !porDia ? 'Pauta da semana' : nd === 'Hoje' || nd === 'Ontem' ? `Sugeridas ${nd.toLowerCase()}` : `Sugeridas em ${nd}`;
    return `${topo()}
      <div class="cx-head">
        <h2 class="h2">${esc(titulo)}</h2>
        <div class="cx-vis-sel">
          <div class="cx-seg" role="group" aria-label="Ver por"><button type="button" data-visao="dia" class="${porDia ? 'on' : ''}">Por dia</button><button type="button" data-visao="semana" class="${porDia ? '' : 'on'}">Por semana</button></div>
          ${porDia
            ? `<select id="cx-dia" aria-label="Dia">${D.dias.map((d) => `<option value="${d}" ${d === D.dia ? 'selected' : ''}>${esc(nomeDia(d))}</option>`).join('')}</select>`
            : `<select id="cx-semana" aria-label="Semana">${D.semanas.map((s) => `<option ${s === D.semana ? 'selected' : ''}>${s}</option>`).join('')}</select>`}
        </div>
      </div>
      ${semTerr ? `<div class="empty-state"><b>Falta o território</b>Responda a entrevista na aba Creator e gere o território antes da primeira pauta.</div>` : ''}
      ${ideias.length ? `<div class="cx-ideias">${ideias.map(cardIdeia).join('')}</div>` : semTerr ? '' : `<div class="empty-state"><b>${porDia ? `Nenhuma ideia ${nd === 'Hoje' || nd === 'Ontem' ? nd.toLowerCase() : 'em ' + esc(nd)}` : `Sem pauta para ${esc(D.semana)}`}</b>Rode o ciclo abaixo ou “Gerar mais ideias”. Se já rodou, o funil no topo mostra em que etapa parou.</div>`}
      ${radar.length ? `<h2 class="h2">Radar${porDia ? ` da semana ${esc(D.semana)}` : ''} <span class="motivos">— o público consome, mas não está no seu território. É só dica.</span></h2><div class="cx-radares">${radar.map(cardRadar).join('')}</div>` : ''}
      ${caixaExecucao([
        ['semana', 'Rodar o ciclo'], ['semana-analise', 'Só a análise (sem navegador)'], ['whisper', 'Transcrever reels'], ['encaixe', 'Avaliar posts'], ['pauta', 'Gerar mais ideias'],
      ], 'Ciclo diário', 'Pode rodar todo dia: visita as contas (só as que não foram vistas nas últimas 20h), coleta o “seguindo” de sementes novas, avalia os posts novos e <b>acrescenta</b> ideias à pauta da semana a partir de posts que ainda não viraram ideia. Nada do que já está na pauta é apagado. As etapas com navegador abrem o Chrome nesta máquina.')}
      ${caixaManual(['encaixe', 'pauta'])}
      <details class="cx-det"><summary>Posts que o sinal apontou (${D.melhores.dentro.length} dentro, ${D.melhores.radar.length} radar) — revise o encaixe da IA</summary>
        <h3 class="cx-h3">Dentro do território</h3>${listaMelhores(D.melhores.dentro, 'dentro')}
        <h3 class="cx-h3">Radar</h3>${listaMelhores(D.melhores.radar, 'radar')}
      </details>
      <p class="foot">Cada ideia parte de um post que o seu público consome: “por que” mostra quantas sementes seguem o autor e quanto o post rendeu acima do normal dele. Recusar com motivo ensina o sistema: “não é meu tema” afina o território, os outros motivos afinam a pauta.</p>`;
  }
  function ligarPauta() {
    document.getElementById('cx-semana')?.addEventListener('change', async (e) => { semana = e.target.value; await carregar(); draw(); });
    document.getElementById('cx-dia')?.addEventListener('change', async (e) => { dia = e.target.value; await carregar(); draw(); });
    root.querySelectorAll('[data-visao]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.visao === visao) return;
      visao = b.dataset.visao;
      try { localStorage.setItem('cx-visao', visao); } catch { /* sem storage */ }
      await carregar(); draw();
    }));
    root.querySelectorAll('[data-aceitar]').forEach((b) => b.addEventListener('click', () => acao('ideia.responder', { id: b.dataset.aceitar, status: 'aceita' })));
    root.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => { abertos.add(b.dataset.abrir); draw(); }));
    root.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => { abertos.delete(b.dataset.cancelar); draw(); }));
    root.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.recusar;
      const nota = document.getElementById('nota-' + id)?.value || '';
      abertos.delete(id);
      acao('ideia.responder', { id, status: 'recusada', motivo: b.dataset.m, nota });
    }));
    root.querySelectorAll('[data-desfazer]').forEach((b) => b.addEventListener('click', () => acao('ideia.responder', { id: b.dataset.desfazer, status: 'nova' })));
    root.querySelectorAll('[data-adotar]').forEach((b) => b.addEventListener('click', () => acao('radar.adotar', { id: b.dataset.adotar, como: b.dataset.como, detalhe: document.getElementById('det-' + b.dataset.adotar)?.value || '' })));
    root.querySelectorAll('[data-dispensar]').forEach((b) => b.addEventListener('click', () => acao('radar.dispensar', { id: b.dataset.dispensar })));
    root.querySelectorAll('[data-enc]').forEach((s) => s.addEventListener('change', () => {
      const valor = s.value;
      let radarTema = null;
      if (valor === 'radar') {
        radarTema = window.prompt('Qual o tema do radar? (ex.: corrida)');
        if (!radarTema) { s.value = ''; return; }
      }
      acao('encaixe.corrigir', { shortcode: s.dataset.enc, valor, radarTema });
    }));
  }

  /* ---------------------------------------------------------------- detalhe da ideia */

  const nfFull = new Intl.NumberFormat('pt-BR');
  const dfLongo = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  let detalheId = null;

  function dialogo() {
    let d = document.getElementById('cx-dlg');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'cx-dlg';
      d.setAttribute('aria-label', 'Detalhe da ideia');
      document.body.appendChild(d);
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      d.addEventListener('close', () => { detalheId = null; d.querySelectorAll('video').forEach((v) => v.pause()); });
    }
    return d;
  }

  const TIPO_POST = { image: 'Foto', carousel: 'Carrossel', video: 'Vídeo', reel: 'Reels' };
  const GANCHO = { pergunta: 'pergunta', numero: 'número', citacao: 'citação', grito: 'grito (caixa alta)', contraste: 'contraste', negacao: 'negação', condicional: 'condicional', pessoal: 'pessoal', imperativo: 'imperativo', declaracao: 'declaração' };
  const vezesTxt = (d) => `${d.toFixed(1).replace('.', ',')}x`;

  /** visor de midia com navegacao entre slides, como no Instagram */
  function visor(p, chave) {
    if (!p.midias.length) return `<div class="cx-vis vazio">mídia não baixada</div>`;
    const itens = p.midias.map((m, n) => `<div class="cx-vslide" data-n="${n}" ${n ? 'hidden' : ''}>${m.video
      ? `<video src="${m.video}" ${m.imagem ? `poster="${m.imagem}"` : ''} controls preload="metadata"></video>`
      : `<img src="${m.imagem}" alt="" loading="lazy">`}</div>`).join('');
    const nav = p.midias.length > 1
      ? `<button type="button" class="cx-vnav prev" data-vis="${chave}" data-d="-1" aria-label="Anterior">‹</button><button type="button" class="cx-vnav next" data-vis="${chave}" data-d="1" aria-label="Próximo">›</button><span class="cx-vcont" id="vc-${chave}">1/${p.midias.length}</span>`
      : '';
    return `<div class="cx-vis" id="vis-${chave}" data-i="0" data-n="${p.midias.length}">${itens}${nav}</div>`;
  }
  function blocoPost(p, rotulo, chave) {
    if (!p) return '';
    const e = p.encaixe;
    const f = p.features;
    const met = [
      p.likes !== null ? `<span><b>${nfFull.format(p.likes)}</b> curtidas</span>` : '<span>curtidas ocultas</span>',
      p.comments !== null ? `<span><b>${nfFull.format(p.comments)}</b> comentários</span>` : '',
      p.plays ? `<span><b>${nfFull.format(p.plays)}</b> views</span>` : '',
    ].filter(Boolean).join('');
    const info = [
      p.tipo ? (TIPO_POST[p.tipo] || p.tipo) : null,
      p.duracao ? `${Math.round(p.duracao)}s` : null,
      p.slides > 1 ? `${p.slides} slides` : null,
      p.takenAt ? `${dfLongo.format(new Date(p.takenAt * 1000))}${f?.diaSemana ? ` (${f.diaSemana}${f.hora !== null ? `, ${f.hora}h` : ''})` : ''}` : null,
      f?.publi ? 'publicidade declarada' : null,
    ].filter(Boolean).join(' · ');
    const sinal = [
      p.totalSementes ? `${p.sementes} de ${p.totalSementes} sementes seguem @${esc(p.autor)}` : null,
      p.desempenho !== null ? `${vezesTxt(p.desempenho)} o normal do autor (${p.postsDoAutor} posts dele no banco)` : null,
    ].filter(Boolean).join(' · ');
    return `<section class="cx-dsec">
      <h3 class="cx-h3">${rotulo}</h3>
      <div class="cx-ig">
        <div class="cx-igmid">${visor(p, chave)}</div>
        <div class="cx-igtxt">
          <div class="cx-igcab">
            <a href="${ig(p.autor)}" target="_blank" rel="noopener"><b>@${esc(p.autor)}</b></a>${p.verificado ? ' <span title="verificado" class="cx-verif">✓</span>' : ''}
            ${virarSemente(p.autor)}
            <div class="motivos">${[p.autorNome ? esc(p.autorNome) : null, p.seguidores ? `${nf.format(p.seguidores)} seguidores` : null, p.autorCategoria ? esc(p.autorCategoria) : null].filter(Boolean).join(' · ')}</div>
            ${p.autorBio ? `<details class="cx-bio"><summary>bio</summary><p>${esc(p.autorBio)}</p></details>` : ''}
          </div>
          <div class="cx-igmet">${met}</div>
          <p class="motivos">${info}</p>
          ${sinal ? `<p class="motivos"><b>Sinal:</b> ${sinal}</p>` : ''}
          ${p.audio || p.local ? `<p class="motivos">${p.audio ? `<b>Áudio:</b> ${esc(p.audio)}` : ''}${p.audio && p.local ? ' · ' : ''}${p.local ? `<b>Local:</b> ${esc(p.local)}` : ''}</p>` : ''}
          ${e ? `<div class="cx-denc"><b>Avaliação da IA:</b> ${esc(ENC[e.encaixe] || e.encaixe)}${e.tema ? ` · ${esc(e.tema)}` : ''}${e.temaTerritorio ? ` → ${esc(e.temaTerritorio)}` : ''}${e.confianca !== null ? ` · ${Math.round(e.confianca * 100)}%` : ''}${e.motivo ? `<br><span class="motivos">${esc(e.motivo)}</span>` : ''}</div>` : ''}
          <h4 class="cx-h4">Legenda</h4>
          ${p.legenda ? `<p class="cx-dleg">${esc(p.legenda)}</p>` : '<p class="motivos">Sem legenda.</p>'}
          ${p.hashtags.length ? `<div class="chips" style="margin:6px 0 10px">${p.hashtags.slice(0, 20).map((h) => `<span class="chip">#${esc(h)}</span>`).join('')}</div>` : ''}
          ${p.transcricoes.length
            ? p.transcricoes.map((t) => `<h4 class="cx-h4">O que é falado · <span class="motivos">${esc(t.fonte)}</span></h4><p class="cx-dleg cx-fala">${esc(t.texto)}</p>`).join('')
            : (p.tipo === 'reel' || p.tipo === 'video' || p.midias.some((m) => m.video))
              ? `<p class="motivos">${p.semFala ? 'Vídeo transcrito: não tem fala (música ou silêncio).' : 'Vídeo ainda sem transcrição. Ela é feita pela etapa whisper do ciclo (precisa de ffmpeg e whisper instalados: npm run whisper -- --check).'}</p>`
              : ''}
          ${p.alt ? `<h4 class="cx-h4">Descrição automática da imagem</h4><p class="cx-dleg">${esc(p.alt)}</p>` : ''}
          ${f && (f.gancho || f.cta) ? `<p class="motivos"><b>Estrutura:</b> ${[f.gancho ? `gancho de ${esc(GANCHO[f.gancho] || f.gancho)}` : null, f.cta && f.cta !== 'nenhum' ? `chamada final: ${esc(f.cta)}` : null].filter(Boolean).join(' · ')}</p>` : ''}
          <p><a class="cx-lnk" href="${igp(p.shortcode)}" target="_blank" rel="noopener">Abrir no Instagram ↗</a></p>
        </div>
      </div>
    </section>`;
  }
  function acoesDetalhe(i) {
    if (i.tipo === 'radar') {
      return i.status === 'nova'
        ? `<div class="cx-acts"><button type="button" class="btn-pri" data-adotar="${i.id}" data-como="pessoal">Adotar (pessoal)</button><button type="button" class="reload" data-adotar="${i.id}" data-como="temas">Adotar (profissional)</button><button type="button" class="cx-lnk" data-dispensar="${i.id}">não é pra mim</button></div>`
        : `<span class="pill ${i.status === 'adotado' ? 'p-ok' : 'k-fora'}">${i.status === 'adotado' ? 'adotado no território' : 'dispensado'}</span>`;
    }
    if (i.status !== 'nova') {
      return `<div class="cx-acts">${i.status === 'aceita' ? '<span class="pill p-ok">aceita</span>' : `<span class="pill p-bad">recusada</span> <span class="motivos">${esc(D.motivosRecusa[i.motivo] || '')}${i.nota ? ` — ${esc(i.nota)}` : ''}</span>`} <button type="button" class="cx-lnk" data-desfazer="${i.id}">desfazer</button></div>`;
    }
    return `<div class="cx-acts"><button type="button" class="btn-pri" data-aceitar="${i.id}">Vou postar</button></div>
      <div class="cx-recusa" style="margin-top:8px"><span class="motivos">Recusar:</span>
        <div class="cx-motivos">${Object.entries(D.motivosRecusa).map(([k, v]) => `<button type="button" class="wbtn" data-recusar="${i.id}" data-m="${k}">${esc(v)}</button>`).join('')}</div>
        <input type="text" class="cx-in" id="nota-${i.id}" placeholder="Nota (opcional): o que não serviu" maxlength="600"></div>`;
  }
  /* ---------------------------------------------------------------- roteiro */

  let rotVer = null; // { ideia, versao } escolhida no seletor
  let rotOcupado = null; // ideia com geracao em andamento
  const rotRascunho = {}; // resposta digitada e ainda nao usada, por ideia
  const rotErro = {}; // ultimo erro de geracao, por ideia: fica na tela ate a proxima tentativa
  const marcar = (t) => esc(t).replace(/\[PREENCHER[^\]]*\]/gi, (m) => `<mark class="cx-preencher">${m}</mark>`);
  /** fala para ler: *palavra* vira enfase e " / " vira marca de pausa */
  // roteiros antigos tinham " / " para pausa e *palavra* para enfase: some, fica so o texto
  const marcarFala = (t) => marcar(String(t || '').replace(/\*([^*\n]+)\*/g, '$1').replace(/\s\/\s/g, ' '));
  const gancho = (g) => (g && typeof g === 'object' ? { texto: g.texto || '', entonacao: g.entonacao || '' } : { texto: g || '', entonacao: '' });

  function viewRoteiro(r) {
    if (r.texto) return `<p class="motivos">Editado por você.</p><div class="cx-rtxt">${marcar(r.texto)}</div>`;
    const c = r.conteudo;
    const au = c.audio || {};
    const audio = au.nome || au.tipo || au.nota
      ? `<p class="cx-audio"><b>Áudio</b> ${au.tipo === 'voz' || (!au.nome && !au.tipo) ? 'sua voz' : esc(au.tipo || 'música')}${au.nome ? ` · <span class="cx-som">${esc(au.nome)}</span>` : ''}${au.nota ? `<br><span class="motivos">${esc(au.nota)}</span>` : ''}</p>`
      : '';
    const ganchos = c.ganchos.map(gancho);
    return `
      ${c.molde ? `<details class="cx-molde"><summary><b>Formato${c.formato_de ? ` copiado de @${esc(c.formato_de)}` : ''}</b> <span class="motivos">— o esqueleto da fala do post de referência</span></summary><p>${esc(c.molde)}</p></details>` : ''}
      ${c.gravacao ? `<p class="cx-audio"><b>Como gravar</b> <span class="motivos">(sugestão)</span><br>${esc(c.gravacao)}</p>` : ''}
      ${audio}
      <div class="cx-falacab"><h4 class="cx-h4">Roteiro${c.formato ? ` · ${esc(c.formato)}` : ''}${c.duracao_s ? ` · ~${Math.round(c.duracao_s)}s` : ''}</h4><button type="button" class="cx-lnk" id="rot-tp">Letra grande</button></div>
      ${c.tom ? `<p class="cx-dir">${esc(c.tom)}</p>` : ''}
      <div class="cx-fala" id="rot-falas">${(c.fala || '').split(/\n\s*\n|\n/).map((par) => par.trim()).filter(Boolean).map((par) => `<p>${marcarFala(par)}</p>`).join('')}</div>
      ${c.tela && c.tela.length ? `<h4 class="cx-h4">Texto na tela</h4><div class="chips">${c.tela.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      ${ganchos.length > 1 ? `<h4 class="cx-h4">Outras opções de abertura</h4><ul class="cx-outras">${ganchos.slice(1).map((g) => `<li>“${marcarFala(g.texto)}”</li>`).join('')}</ul>` : ''}
      <h4 class="cx-h4">Legenda</h4><div class="cx-rtxt">${marcar(c.legenda || '—')}</div>
      ${c.lembretes.length ? `<div class="cx-lembretes"><b>Dicas para gravar</b><ul>${c.lembretes.map((l) => `<li>${marcar(l)}</li>`).join('')}</ul></div>` : ''}`;
  }

  /* editor do roteiro: os mesmos campos da visualizacao, editaveis no lugar */
  const campo = (cls, valor, ph, rows = 1) => `<textarea class="cx-ed ${cls}" rows="${rows}" placeholder="${esc(ph)}">${esc(valor || '')}</textarea>`;
  function blocoEditavel(b) {
    return `<div class="cx-bloco cx-ebloco">
      <div class="cx-btempo">
        ${campo('ed-tempo', b.tempo, 'tempo (0–3s)')}
        ${campo('ed-parte', b.parte, 'nome da cena (Abertura, Item 1…)')}
        <div class="cx-emove"><button type="button" class="wbtn" data-mv="-1" title="Subir">↑</button><button type="button" class="wbtn" data-mv="1" title="Descer">↓</button><button type="button" class="wbtn" data-rm title="Remover cena">✕</button></div>
      </div>
      <div class="cx-bcorpo">
        <label class="cx-elbl">Direção (como falar) ${campo('ed-entonacao', b.entonacao, 'firme, mais rápido, baixa o tom…')}</label>
        <label class="cx-elbl">Fala ${campo('ed-fala cx-bfala', b.fala, 'o que ele fala', 2)}</label>
        <label class="cx-elbl">Texto na tela ${campo('ed-tela', b.tela, 'opcional')}</label>
        <label class="cx-elbl">Ação ${campo('ed-acao', b.acao || b.visual, 'só se o formato exigir: andar, gesto da trend… (opcional)')}</label>
      </div>
    </div>`;
  }
  const ganchoEditavel = (g) => `<div class="cx-egancho"><div class="cx-egcorpo">${campo('ed-gancho', g.texto, 'abertura')}${campo('ed-gtom', g.entonacao, 'direção (opcional)')}</div><button type="button" class="wbtn" data-rmg title="Remover">✕</button></div>`;
  function editorRoteiro(sel) {
    const c = sel.conteudo;
    const outras = c.ganchos.map(gancho).slice(1);
    return `<div class="cx-editor">
      <label class="cx-elbl">Como gravar (sugestão) ${campo('ed-gravacao', c.gravacao, 'enquadramento, câmera, olhar, cortes')}</label>
      <div class="cx-erow3"><label class="cx-elbl">Áudio <select class="cx-in ed-atipo">${['voz', 'musica', 'voz+musica'].map((t) => `<option value="${t}" ${(c.audio?.tipo || 'voz') === t ? 'selected' : ''}>${t === 'voz' ? 'sua voz' : t === 'musica' ? 'música/trend' : 'voz + música'}</option>`).join('')}</select></label>
        <label class="cx-elbl">Nome do áudio ${campo('ed-anome', c.audio?.nome, 'se for música/trend')}</label></div>
      <label class="cx-elbl">Tom ${campo('ed-tom', c.tom, 'como falar o vídeo inteiro')}</label>
      <h4 class="cx-h4">Roteiro <span class="motivos">— a fala inteira, um parágrafo por ideia</span></h4>
      ${campo('ed-fala cx-efala', c.fala, 'o que ele fala, do começo ao fim', 10)}
      <div class="cx-erow"><label class="cx-elbl">Formato ${campo('ed-formato', c.formato, 'ex.: reels falado')}</label><label class="cx-elbl cx-edur">Duração (s) <input type="number" min="0" max="3600" class="cx-in ed-dur" value="${c.duracao_s ?? ''}"></label></div>
      <label class="cx-elbl">Texto na tela <span class="motivos">— um por linha</span> ${campo('ed-tela', (c.tela || []).join('\n'), 'opcional', 2)}</label>
      <label class="cx-elbl">Outras opções de abertura <span class="motivos">— uma por linha</span> ${campo('ed-outras', outras.map((g) => g.texto).join('\n'), 'opcional', 2)}</label>
      <h4 class="cx-h4">Legenda</h4>${campo('ed-legenda', c.legenda, 'legenda do post', 4)}
      <h4 class="cx-h4">Dicas para gravar <span class="motivos">— uma por linha</span></h4>${campo('ed-lembretes', c.lembretes.join('\n'), 'opcional', 2)}
    </div>`;
  }
  function lerEditor(el) {
    const v = (sel) => el.querySelector(sel)?.value.trim() ?? '';
    const linhasDe = (sel) => v(sel).split('\n').map((l) => l.trim()).filter(Boolean);
    const fala = v('.ed-fala');
    // a abertura usada e a primeira frase da fala; as outras sao alternativas
    const primeira = (fala.match(/^[^\n.!?]*[.!?]?/) || [''])[0].trim();
    return {
      gravacao: v('.ed-gravacao'),
      audio: { tipo: el.querySelector('.ed-atipo')?.value || 'voz', nome: v('.ed-anome'), nota: '' },
      tom: v('.ed-tom'),
      fala,
      formato: v('.ed-formato'),
      duracao_s: v('.ed-dur') ? Number(v('.ed-dur')) : null,
      tela: linhasDe('.ed-tela'),
      ganchos: [primeira, ...linhasDe('.ed-outras')].filter(Boolean).map((t) => ({ texto: t, entonacao: '' })),
      legenda: v('.ed-legenda'),
      lembretes: linhasDe('.ed-lembretes'),
    };
  }
  const crescer = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
  function ligarEditor(el) {
    const ajustar = () => el.querySelectorAll('textarea.cx-ed').forEach(crescer);
    el.addEventListener('input', (e) => { if (e.target.matches('textarea.cx-ed')) crescer(e.target); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const bloco = b.closest('.cx-ebloco');
      if (b.dataset.mv && bloco) {
        const alvo = b.dataset.mv === '-1' ? bloco.previousElementSibling : bloco.nextElementSibling;
        if (alvo) b.dataset.mv === '-1' ? alvo.before(bloco) : alvo.after(bloco);
      } else if (b.hasAttribute('data-rm') && bloco) {
        if (el.querySelectorAll('.cx-ebloco').length > 1) bloco.remove();
      } else if (b.hasAttribute('data-rmg')) {
        if (el.querySelectorAll('.cx-egancho').length > 1) b.closest('.cx-egancho').remove();
      } else if (b.id === 'ed-addb') {
        el.querySelector('#ed-blocos').insertAdjacentHTML('beforeend', blocoEditavel({}));
        ajustar();
        el.querySelector('#ed-blocos .cx-ebloco:last-child .ed-fala')?.focus();
      } else if (b.id === 'ed-addg') {
        el.querySelector('#ed-ganchos').insertAdjacentHTML('beforeend', ganchoEditavel({ texto: '', entonacao: '' }));
        el.querySelector('#ed-ganchos .cx-egancho:last-child textarea')?.focus();
      }
    });
    return ajustar;
  }

  function secaoRoteiro(i) {
    const rs = i.roteiros || [];
    const sel = rs.find((r) => rotVer && rotVer.ideia === i.id && r.versao === rotVer.versao) || rs[0] || null;
    const ocupado = rotOcupado === i.id;
    const ultimaResp = rotRascunho[i.id] ?? (rs[0]?.resposta || '');
    const entrada = i.pergunta
      ? `<label class="cx-lbl" for="rot-resp">Pergunta para ${esc(D.persona?.nome || 'o creator')}</label>
         <p class="cx-rperg">${esc(i.pergunta)}</p>
         <textarea id="rot-resp" class="cx-rta" rows="3" placeholder="Opcional. Se você responder, o roteiro conta a sua história; se deixar em branco, ele sai pronto com um exemplo típico do assunto.">${esc(ultimaResp)}</textarea>`
      : `<label class="cx-lbl" for="rot-resp">Algo seu para entrar nesse post (opcional)</label>
         <textarea id="rot-resp" class="cx-rta" rows="2" placeholder="Uma história, um cliente, um número que você quer usar.">${esc(ultimaResp)}</textarea>`;
    const gerar = i.roteiroApi
      ? `<button type="button" class="btn-pri" id="rot-gerar" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Escrevendo… (uns 20 a 40s)' : rs.length ? 'Gerar nova versão' : 'Gerar roteiro'}</button>`
      : `<button type="button" class="reload" id="rot-prompt">Copiar prompt</button>`;
    const manual = i.roteiroApi ? '' : `<details class="cx-mt"><summary class="motivos">Sem chave de API: cole aqui a resposta da IA</summary>
        <textarea id="rot-colar" class="cx-rta" rows="5" placeholder="Cole o bloco json que a IA devolveu"></textarea>
        <div class="cx-acts"><button type="button" class="btn-pri" id="rot-salvar">Salvar roteiro</button></div></details>`;
    const dataV = (r) => (r.createdAt ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(r.createdAt * 1000)) : '');
    const versoes = rs.length
      ? `<div class="cx-versoes"><span class="motivos">${rs.length === 1 ? '1 versão' : `${rs.length} versões`}:</span>${rs.map((r) => `<button type="button" class="wbtn ${sel && r.versao === sel.versao ? 'on' : ''}" data-rotv="${r.versao}" title="${esc([dataV(r), r.pedido ? 'ajuste: ' + r.pedido : null, r.modelo].filter(Boolean).join(' · '))}">v${r.versao}${r.status === 'gravado' ? ' ✓' : ''}</button>`).join('')}</div>`
      : '';
    const atual = sel
      ? `<div class="cx-rcab">${versoes}<span class="motivos">mostrando v${sel.versao}${dataV(sel) ? ` · ${dataV(sel)}` : ''}${sel.pedido ? ` · ajuste: ${esc(sel.pedido)}` : ''}${sel.modelo ? ` · ${esc(sel.modelo)}` : ''}</span></div>
         <div id="rot-view">${viewRoteiro(sel)}</div>
         <div id="rot-edit" hidden>${editorRoteiro(sel)}
           <div class="cx-acts cx-edacts"><button type="button" class="btn-pri" id="rot-salvar-ed">Salvar como v${rs[0] ? rs[0].versao + 1 : 1}</button><button type="button" class="cx-lnk" id="rot-cancelar-ed">cancelar</button><span class="motivos">A versão da IA continua no histórico.</span></div></div>
         <div class="cx-acts" id="rot-acoes">
           <button type="button" class="reload" id="rot-copiar">Copiar</button>
           <button type="button" class="reload" id="rot-editar">Editar</button>
           ${sel.status === 'gravado' ? '<span class="pill p-ok">gravado</span><button type="button" class="cx-lnk" id="rot-desgravar">desfazer</button>' : '<button type="button" class="reload" id="rot-gravado">Marcar como gravado</button>'}
           <button type="button" class="cx-lnk cx-perigo" id="rot-apagar">Começar do zero</button>
         </div>
         ${i.roteiroApi ? `<div class="cx-rajuste" id="rot-ajuste"><input type="text" class="cx-in" id="rot-pedido" maxlength="300" placeholder="Pedir ajuste: mais curto, menos formal, outro gancho, virar carrossel…"><button type="button" class="reload" id="rot-ajustar" ${ocupado ? 'disabled' : ''}>Ajustar</button></div>` : ''}`
      : '';
    return `<section class="cx-dsec" id="cx-rot">
      <h3 class="cx-h3">Roteiro</h3>
      ${rotErro[i.id] ? `<div class="cx-rerro"><b>A última geração falhou.</b> ${esc(rotErro[i.id])}</div>` : ''}
      ${atual}
      <div class="cx-rnovo ${sel ? 'cx-mt' : ''}">${entrada}<div class="cx-acts">${gerar}</div>${manual}</div>
    </section>`;
  }

  function ligarRoteiro(d, i, reabrir) {
    const sec = d.querySelector('#cx-rot');
    if (!sec) return;
    const q = (s) => sec.querySelector(s);
    const resp = () => q('#rot-resp')?.value || '';
    const rs = i.roteiros || [];
    const sel = rs.find((r) => rotVer && rotVer.ideia === i.id && r.versao === rotVer.versao) || rs[0] || null;
    q('#rot-resp')?.addEventListener('input', (e) => { rotRascunho[i.id] = e.target.value; });
    const gerar = async (pedido) => {
      const resposta = resp();
      rotOcupado = i.id;
      await reabrir(true);
      try {
        const r = await postJson('/api/creator/acao', { acao: 'roteiro.gerar', persona: D?.persona?.id, id: i.id, resposta, pedido });
        rotVer = { ideia: i.id, versao: r.versao };
        delete rotRascunho[i.id];
        delete rotErro[i.id];
        aviso(`Roteiro v${r.versao} pronto.`);
      } catch (e) {
        rotErro[i.id] = e.message;
        aviso(e.message, true);
      } finally {
        rotOcupado = null;
        await carregar(); draw();
        await reabrir(true);
      }
    };
    q('#rot-gerar')?.addEventListener('click', () => gerar(''));
    q('#rot-ajustar')?.addEventListener('click', () => {
      const p = q('#rot-pedido').value.trim();
      if (!p) { aviso('Escreva o ajuste que você quer.', true); return; }
      gerar(p);
    });
    q('#rot-prompt')?.addEventListener('click', async () => {
      try {
        const r = await postJson('/api/creator/acao', { acao: 'roteiro.prompt', persona: D?.persona?.id, id: i.id, resposta: resp() });
        await navigator.clipboard.writeText(r.prompt);
        aviso(`Prompt copiado (~${r.tokens} tokens). Cole numa conversa e traga a resposta.`);
      } catch (e) { aviso(e.message, true); }
    });
    q('#rot-salvar')?.addEventListener('click', async () => {
      try {
        const r = await postJson('/api/creator/acao', { acao: 'roteiro.colar', persona: D?.persona?.id, id: i.id, resposta: resp(), texto: q('#rot-colar').value });
        rotVer = { ideia: i.id, versao: r.versao };
        await carregar(); draw(); await reabrir(true);
      } catch (e) { aviso(e.message, true); }
    });
    sec.querySelectorAll('[data-rotv]').forEach((b) => b.addEventListener('click', () => { rotVer = { ideia: i.id, versao: Number(b.dataset.rotv) }; reabrir(true); }));
    if (!sel) return;
    const salvar = async (acaoNome, dados) => {
      try { await postJson('/api/creator/acao', { acao: acaoNome, persona: D?.persona?.id, roteiro: sel.id, ...dados }); await carregar(); draw(); await reabrir(true); } catch (e) { aviso(e.message, true); }
    };
    q('#rot-apagar')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      // dois cliques: o primeiro so pergunta
      if (!b.dataset.confirma) {
        b.dataset.confirma = '1';
        b.textContent = `Apagar ${rs.length === 1 ? 'a versão' : `as ${rs.length} versões`}? Clique de novo`;
        setTimeout(() => { if (b.isConnected) { delete b.dataset.confirma; b.textContent = 'Começar do zero'; } }, 5000);
        return;
      }
      try {
        const r = await postJson('/api/creator/acao', { acao: 'roteiro.apagar', persona: D?.persona?.id, id: i.id });
        rotVer = null;
        delete rotRascunho[i.id];
        delete rotErro[i.id];
        aviso(`${r.apagados} ${r.apagados === 1 ? 'versão apagada' : 'versões apagadas'}. A resposta à pergunta também foi limpa.`);
        await carregar(); draw(); await reabrir(true);
      } catch (err) { aviso(err.message, true); }
    });
    q('#rot-copiar')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(sel.texto || sel.textoPadrao); aviso('Roteiro copiado.'); } catch { aviso('Não deu para copiar: use Editar e copie do campo.', true); }
    });
    q('#rot-tp')?.addEventListener('click', (e) => {
      const f = q('#rot-falas');
      f.classList.toggle('tp');
      e.currentTarget.textContent = f.classList.contains('tp') ? 'Letra normal' : 'Letra grande';
    });
    const editor = q('#rot-edit');
    const ajustarEditor = editor ? ligarEditor(editor) : () => {};
    const modoEdicao = (on) => {
      q('#rot-view').hidden = on;
      editor.hidden = !on;
      for (const id of ['#rot-acoes', '#rot-ajuste']) { const el = q(id); if (el) el.hidden = on; }
    };
    q('#rot-editar')?.addEventListener('click', () => { modoEdicao(true); ajustarEditor(); editor.querySelector('.ed-fala')?.focus(); });
    q('#rot-cancelar-ed')?.addEventListener('click', () => modoEdicao(false));
    q('#rot-salvar-ed')?.addEventListener('click', async () => {
      try {
        const r = await postJson('/api/creator/acao', { acao: 'roteiro.salvar', persona: D?.persona?.id, id: i.id, roteiro: sel.id, conteudo: lerEditor(editor) });
        rotVer = { ideia: i.id, versao: r.versao };
        aviso(`Salvo como v${r.versao}.`);
        await carregar(); draw(); await reabrir(true);
      } catch (e) { aviso(e.message, true); }
    });
    q('#rot-gravado')?.addEventListener('click', () => salvar('roteiro.status', { status: 'gravado' }));
    q('#rot-desgravar')?.addEventListener('click', () => salvar('roteiro.status', { status: 'rascunho' }));
  }

  async function abrirDetalhe(id, irRoteiro, manterScroll) {
    const d = dialogo();
    detalheId = id;
    d.innerHTML = '<div class="cx-dcorpo"><p class="motivos">Carregando…</p></div>';
    if (!d.open) d.showModal();
    let i;
    try { i = await getJson('/api/creator/ideia?id=' + encodeURIComponent(id)); } catch (e) { d.innerHTML = `<div class="cx-dcorpo"><p>${esc(e.message)}</p></div>`; return; }
    if (detalheId !== id) return;
    const scroll = manterScroll ? d.scrollTop : 0;
    const topo = `<button class="close" type="button" id="cx-dfechar" aria-label="Fechar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    const corpo = i.tipo === 'radar'
      ? `<p class="eyebrow">Radar · ${esc(i.semana)}</p><h2 class="cx-dtit">${esc(i.titulo)}</h2>
         <p>${esc(i.porQue || '')}</p>${acoesDetalhe(i)}
         ${i.exemplos.map((p, n) => blocoPost(p, `Exemplo ${n + 1}`, 'ex' + n)).join('')}`
      : `<p class="eyebrow">Pauta · ${esc(i.semana)}${i.modelo ? ` · ${esc(i.modelo)}` : ''}</p>
         <h2 class="cx-dtit">${esc(i.titulo)}</h2>
         ${i.hook ? `<blockquote class="cx-dhook">“${esc(i.hook)}”</blockquote>` : ''}
         <dl class="cx-dl">
           ${i.angulo ? `<dt>Seu ângulo</dt><dd>${esc(i.angulo)}</dd>` : ''}
           ${i.formato ? `<dt>Formato</dt><dd>${esc(FORMATOS[i.formato] || i.formato)}</dd>` : ''}
           ${i.porQue ? `<dt>Por que o público assiste</dt><dd>${esc(i.porQue)}</dd>` : ''}
         </dl>
         ${acoesDetalhe(i)}
         ${secaoRoteiro(i)}
         ${blocoPost(i.assunto, i.formatoRef ? 'De onde veio o assunto' : 'Referência (assunto e formato)', 'as')}
         ${i.formatoRef ? blocoPost(i.formatoRef, 'Formato sugerido (o post do assunto não engajou: use esta forma, não este assunto)', 'fm') : ''}`;
    d.innerHTML = `${topo}<div class="cx-dcorpo">${corpo}</div>`;
    d.querySelector('#cx-dfechar').addEventListener('click', () => d.close());
    if (i.tipo === 'pauta') ligarRoteiro(d, i, (manter) => abrirDetalhe(id, false, manter));
    if (irRoteiro) d.querySelector('#cx-rot')?.scrollIntoView({ block: 'start' });
    else if (scroll) d.scrollTop = scroll;
    d.querySelectorAll('[data-vis]').forEach((b) => b.addEventListener('click', () => {
      const v = d.querySelector('#vis-' + b.dataset.vis);
      const n = Number(v.dataset.n);
      const atual = Number(v.dataset.i);
      const prox = (atual + Number(b.dataset.d) + n) % n;
      v.querySelectorAll('.cx-vslide').forEach((sl) => { sl.hidden = Number(sl.dataset.n) !== prox; sl.querySelector('video')?.pause(); });
      v.dataset.i = String(prox);
      const c = d.querySelector('#vc-' + b.dataset.vis);
      if (c) c.textContent = `${prox + 1}/${n}`;
    }));
    const depois = async (fn) => { await fn(); if (d.open) abrirDetalhe(id); };
    d.querySelectorAll('[data-aceitar]').forEach((b) => b.addEventListener('click', () => depois(() => acao('ideia.responder', { id, status: 'aceita' }))));
    d.querySelectorAll('[data-desfazer]').forEach((b) => b.addEventListener('click', () => depois(() => acao('ideia.responder', { id, status: 'nova' }))));
    d.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', () => depois(() => acao('ideia.responder', { id, status: 'recusada', motivo: b.dataset.m, nota: d.querySelector('#nota-' + id)?.value || '' }))));
    d.querySelectorAll('[data-adotar]').forEach((b) => b.addEventListener('click', () => depois(() => acao('radar.adotar', { id, como: b.dataset.como, detalhe: '' }))));
    d.querySelectorAll('[data-dispensar]').forEach((b) => b.addEventListener('click', () => depois(() => acao('radar.dispensar', { id }))));
    d.querySelectorAll('[data-virar]').forEach((b) => b.addEventListener('click', () => depois(() => acao('sementes.add', { texto: b.dataset.virar }))));
  }
  function ligarDetalhe() {
    root.querySelectorAll('[data-roteiro]').forEach((b) => b.addEventListener('click', () => abrirDetalhe(b.dataset.roteiro, true)));
    root.querySelectorAll('[data-ideia]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select, textarea, video, details')) return;
        abrirDetalhe(card.dataset.ideia);
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) abrirDetalhe(card.dataset.ideia); });
    });
  }

  /* ---------------------------------------------------------------- creator */

  const linhasTema = (xs) => (xs || []).map((x) => (x.detalhe ? `${x.tema}: ${x.detalhe}` : x.tema)).join('\n');
  const lerTemas = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? { tema: l.slice(0, i).trim().slice(0, 80), detalhe: l.slice(i + 1).trim().slice(0, 400) } : { tema: l.slice(0, 80), detalhe: '' };
  });
  const linhas = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean);

  function drawCreator() {
    const p = D.persona;
    const novo = `<div class="iabox"><h2 class="h2">Novo creator</h2><p>Cada creator que usa o sistema é uma persona, com entrevista, território, sementes e pauta próprios. Só uma fica ativa por vez: é ela que a coleta e a pauta atendem.</p>
      <div class="iarow"><input type="text" id="cx-nnome" placeholder="Nome (ex.: Lucas)" maxlength="60"><input type="text" id="cx-nhandle" placeholder="@ do Instagram (opcional)" maxlength="40"><button type="button" class="btn-pri" id="cx-criar">Criar</button></div></div>`;
    if (!p) return `<div class="empty-state"><b>Nenhum creator ainda</b>Crie o primeiro abaixo.</div>${novo}`;
    const t = p.territorio;
    const ent = p.entrevista || {};
    return `${topo()}
      <div class="iabox">
        <h2 class="h2">1. Entrevista</h2>
        <p>Cinco perguntas, respostas curtas. Só as duas primeiras são obrigatórias; dá para completar depois. O que fica fora vale direto no território, sem passar pela IA.</p>
        <div class="iarow"><input type="text" id="cx-nome" value="${esc(p.nome)}" maxlength="60" aria-label="Nome"><input type="text" id="cx-handle" value="${esc(p.handle ? '@' + p.handle : '')}" placeholder="@ do Instagram" maxlength="40" aria-label="@ do Instagram"></div>
        <div class="cx-perguntas">${D.perguntas.map((q, n) => `<label class="cx-q"><span><b>${n + 1}.</b> ${esc(q.pergunta)}</span><textarea data-q="${q.chave}" rows="3">${esc(ent[q.chave] || '')}</textarea></label>`).join('')}</div>
        <div class="iarow"><button type="button" class="btn-pri" id="cx-salvar-ent">Salvar respostas</button>
          ${D.api.chave ? `<button type="button" class="reload" data-run="territorio">Gerar território com a IA</button>` : '<span class="motivos">Sem chave de API: gere o território pela caixa “IA à mão” abaixo.</span>'}
          <span class="motivos">Salve as respostas antes de gerar.${p.ativa ? '' : ' Para gerar pela API, torne esta persona ativa.'}</span></div>
        <div id="cx-jobst"></div><pre id="cx-log" hidden></pre>
      </div>
      ${caixaManual(['territorio'])}
      <div class="iabox">
        <h2 class="h2">2. Território ${t ? `<span class="motivos">versão ${p.territorioVersao}</span>` : ''}</h2>
        <p>${t ? 'Revise e ajuste. Um item por linha; nos temas, use “tema: o que você tem a dizer”. Mudar o território refaz a avaliação dos posts na próxima rodada.' : 'Ainda não gerado. Responda a entrevista e gere com a IA, ou preencha à mão.'}</p>
        <div class="cx-terr">
          <label>Resumo<textarea id="t-resumo" rows="3">${esc(t?.resumo)}</textarea></label>
          <label>Quem quer atrair<textarea id="t-publico" rows="3">${esc(t?.publico || p.publico)}</textarea></label>
          <label>Temas profissionais<textarea id="t-temas" rows="7">${esc(linhasTema(t?.temas))}</textarea></label>
          <label>Lado pessoal<textarea id="t-pessoal" rows="7">${esc(linhasTema(t?.pessoal))}</textarea></label>
          <label>Opiniões fortes<textarea id="t-opinioes" rows="4">${esc((t?.opinioes || []).join('\n'))}</textarea></label>
          <label>Histórias<textarea id="t-historias" rows="4">${esc((t?.historias || []).join('\n'))}</textarea></label>
          <label>Tom<textarea id="t-tom" rows="2">${esc(t?.tom)}</textarea></label>
          <div><span class="cx-lbl">Formatos</span><div class="cx-fmts">${Object.entries(FORMATOS).map(([k, v]) => `<label class="check"><input type="checkbox" data-fmt="${k}" ${t?.formatos?.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>
            <span class="cx-lbl" style="margin-top:14px">Fora (vem da entrevista)</span><div class="chips">${(t?.fora || []).map((f) => `<span class="chip">${esc(f)}</span>`).join('') || '<span class="motivos">nada</span>'}</div></div>
        </div>
        <div class="iarow" style="margin-top:12px"><button type="button" class="btn-pri" id="cx-salvar-terr">Salvar território</button></div>
      </div>
      ${novo}`;
  }
  function ligarCreator() {
    document.getElementById('cx-criar')?.addEventListener('click', async () => {
      const nome = document.getElementById('cx-nnome').value.trim();
      if (!nome) return aviso('Dê um nome para o creator', true);
      const r = await acao('persona.criar', { nome, handle: document.getElementById('cx-nhandle').value });
      if (r?.id) { personaId = r.id; await carregar(); draw(); }
    });
    document.getElementById('cx-salvar-ent')?.addEventListener('click', async () => {
      const entrevista = {};
      root.querySelectorAll('textarea[data-q]').forEach((t) => (entrevista[t.dataset.q] = t.value));
      const r = await acao('persona.salvar', { entrevista, nome: document.getElementById('cx-nome').value, handle: document.getElementById('cx-handle').value || null });
      if (r) aviso('Respostas salvas');
    });
    document.getElementById('cx-salvar-terr')?.addEventListener('click', async () => {
      const v = (id) => document.getElementById(id).value;
      const territorio = {
        resumo: v('t-resumo').trim(),
        publico: v('t-publico').trim(),
        temas: lerTemas(v('t-temas')),
        pessoal: lerTemas(v('t-pessoal')),
        opinioes: linhas(v('t-opinioes')),
        historias: linhas(v('t-historias')),
        tom: v('t-tom').trim(),
        formatos: [...root.querySelectorAll('input[data-fmt]:checked')].map((c) => c.dataset.fmt),
        fora: D.persona.territorio?.fora || [],
      };
      const r = await acao('territorio.salvar', { territorio });
      if (r) aviso('Território salvo');
    });
  }

  /* ---------------------------------------------------------------- sementes */

  const ACAO_CONTA = {
    visitar: ['Visitar agora', 'abre o Chrome'],
    transcrever: ['Transcrever reels', ''],
    classificar: ['Classificar a conta', 'IA: consumido, par ou fora'],
    avaliar: ['Avaliar os posts da conta', 'IA: dentro, radar ou fora do território'],
    seguindo: ['Coletar “seguindo” agora', 'abre o Chrome'],
    atualizar: ['Atualizar tudo', 'visitar → transcrever → classificar → avaliar'],
  };
  /** menu de acoes de uma conta so: roda a etapa sem passar pela lista inteira */
  function menuConta(u, acoes) {
    const dica = (a) => (a === 'atualizar' && !acoes.includes('classificar') ? 'visitar → transcrever → avaliar' : ACAO_CONTA[a][1]);
    return `<details class="cx-menu"><summary class="wbtn" title="Ações só para @${esc(u)}" aria-label="Ações só para @${esc(u)}">⋯</summary>
      <div class="cx-menu-l" role="menu"><div class="motivos">Só para @${esc(u)}</div>${acoes.map((a) => `<button type="button" role="menuitem" data-cacao="${a}" data-conta="${esc(u)}" ${JOB?.rodando || !D?.persona?.ativa ? 'disabled' : ''}>${esc(ACAO_CONTA[a][0])}${dica(a) ? `<span>${esc(dica(a))}</span>` : ''}</button>`).join('')}</div></details>`;
  }
  function drawSementes() {
    if (!D.persona) return `<div class="empty-state"><b>Crie um creator primeiro</b>Na aba Creator.</div>`;
    const todas = D.sementes || [];
    const sug = todas.filter((s) => s.status === 'sugerida');
    const lista = todas.filter((s) => s.status !== 'sugerida');
    const total = D.funil.comLista;
    const papelSel = (c) => `<select class="fix" data-papel="${c.username}"><option value="">${c.source === 'humano' ? 'voltar para a IA' : `(${c.source === 'llm' ? 'IA' : 'sem avaliação'}) ${PAPEL[c.papel]}`}</option>${['consumido', 'par', 'fora'].map((k) => `<option value="${k}" ${c.source === 'humano' && c.papel === k ? 'selected' : ''}>${PAPEL[k]}</option>`).join('')}</select>`;
    return `${topo()}
      <div class="iabox">
        <h2 class="h2">Sementes</h2>
        <p>Perfis reais de pessoas que são exatamente o público que ${esc(D.persona.nome)} quer atrair. Do que elas seguem em comum sai o que o público consome. Comece com 10; perfis privados não servem. Aceita @, nome ou link, um por linha.</p>
        <textarea id="cx-sem" rows="4" placeholder="@fulano&#10;@ciclana&#10;https://instagram.com/beltrano"></textarea>
        <div class="iarow" style="margin-top:10px"><button type="button" class="btn-pri" id="cx-addsem">Adicionar</button></div>
      </div>
      ${sug.length ? `<h2 class="h2">Sugeridas pelo grafo <span class="motivos">— a IA achou pares do público entre quem as sementes seguem</span></h2>
        <div class="tablewrap"><table class="t"><tbody>${sug.map((s) => `<tr><td><a href="${ig(s.username)}" target="_blank" rel="noopener">@${esc(s.username)}</a></td><td class="motivos">${esc(s.motivo || '')}</td>
          <td style="white-space:nowrap"><button type="button" class="wbtn" data-sem="${s.username}" data-st="confirmada">Confirmar</button> <button type="button" class="wbtn" data-sem="${s.username}" data-st="rejeitada">Rejeitar</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2 class="h2">Sementes (${lista.filter((s) => s.status === 'confirmada').length})</h2>
      ${lista.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Conta</th><th>Status</th><th>Lista coletada</th><th>Quando</th><th></th></tr></thead><tbody>
        ${lista.map((s) => `<tr>
          <td><a href="${ig(s.username)}" target="_blank" rel="noopener">@${esc(s.username)}</a>${s.fullName ? `<div class="motivos">${esc(s.fullName)}</div>` : ''}</td>
          <td><span class="pill ${s.status === 'confirmada' ? 'p-ok' : 'k-fora'}">${s.status}</span>${s.origem === 'grafo' ? ' <span class="motivos">via grafo</span>' : ''}</td>
          <td>${s.contas ? `${s.contas}${s.followingCount ? ` de ${s.followingCount}` : ''}` : '—'}${s.erro ? `<div class="motivos" style="color:var(--t-reel-ink)">${esc(s.erro)}</div>` : ''}</td>
          <td class="motivos">${quando(s.coletadaEm)}</td>
          <td style="white-space:nowrap">${s.status === 'confirmada' ? `${menuConta(s.username, ['seguindo'])} <button type="button" class="wbtn" data-sem="${s.username}" data-st="rejeitada">Desativar</button>` : `<button type="button" class="wbtn" data-sem="${s.username}" data-st="confirmada">Reativar</button>`} <button type="button" class="wbtn" data-sem="${s.username}" data-st="remover">Remover</button></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="motivos">Nenhuma semente ainda.</p>'}
      ${secaoReferencias()}
      ${caixaExecucao([
        ['seguindo', 'Coletar “seguindo”'], ['grafo', 'Recalcular grafo'], ['acompanhar', 'Visitar contas'], ['contas', 'Classificar contas'],
      ], 'Grafo', `Uma conta entra no grafo quando pelo menos <b>${D.minimo}</b> das ${total} sementes com lista a seguem. As mais citadas são visitadas (bio e posts), e a IA diz se são conteúdo que o público consome, um par do público (vira semente sugerida) ou nada.`)}
      ${caixaManual(['contas'])}
      <h2 class="h2">Grafo (${D.grafo.length})</h2>
      ${D.grafo.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Conta</th><th>Sementes</th><th>Papel</th><th>Do que fala / por quê</th><th>Seguidores</th><th>Visitada</th><th></th></tr></thead><tbody>
        ${D.grafo.map((c) => `<tr>
          <td><a href="${ig(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a> ${virarSemente(c.username)}${c.fullName ? `<div class="motivos">${esc(c.fullName)}</div>` : ''}${c.candidataSemente ? '<div><span class="chip">par do público</span></div>' : ''}</td>
          <td><b>${c.sementes}</b><span class="motivos"> de ${total}</span></td>
          <td>${papelSel(c)}${c.confianca !== null && c.source === 'llm' ? `<div class="motivos">${Math.round(c.confianca * 100)}% de confiança</div>` : ''}</td>
          <td>${c.tema ? `<b>${esc(c.tema)}</b>` : ''}<div class="motivos">${esc(c.motivo || (c.bio || '').slice(0, 160))}</div></td>
          <td class="motivos">${c.followers !== null ? nf.format(c.followers) : '—'}</td>
          <td class="motivos">${c.lastWatchedAt ? `${quando(c.lastWatchedAt)} · ${c.posts} posts` : 'ainda não'}</td>
          <td>${menuConta(c.username, ['visitar', 'transcrever', 'classificar', 'avaliar', 'atualizar'])}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="motivos">Vazio. Colete o “seguindo” das sementes e recalcule o grafo.</p>'}`;
  }
  function secaoReferencias() {
    const refs = D.referencias || [];
    const sug = refs.filter((r) => r.status === 'sugerida');
    const lista = refs.filter((r) => r.status !== 'sugerida');
    const linha = (r) => `<tr>
      <td><a href="${ig(r.username)}" target="_blank" rel="noopener">@${esc(r.username)}</a>${r.fullName ? `<div class="motivos">${esc(r.fullName)}</div>` : ''}${r.motivo ? `<div class="motivos">${esc(r.motivo)}</div>` : ''}</td>
      <td><span class="pill ${r.status === 'ativa' ? 'p-ok' : 'k-fora'}">${r.status}</span></td>
      <td class="motivos">${r.lastWatchedAt ? `${quando(r.lastWatchedAt)} · ${r.posts} posts · ${r.dentro} dentro` : 'ainda não visitada'}</td>
      <td style="white-space:nowrap">${r.status === 'ativa' ? `${menuConta(r.username, ['visitar', 'transcrever', 'avaliar', 'atualizar'])} <button type="button" class="wbtn" data-ref="${r.username}" data-st="pausada">Pausar</button>` : `<button type="button" class="wbtn" data-ref="${r.username}" data-st="ativa">Ativar</button>`} <button type="button" class="wbtn" data-ref="${r.username}" data-st="remover">Remover</button></td>
    </tr>`;
    return `<div class="iabox">
        <h2 class="h2">Referências de conteúdo</h2>
        <p>Pessoas que falam do que ${esc(D.persona.nome)} fala: CEOs e founders de software house ou de produto que postam conteúdo próprio. Delas sai o <b>assunto</b> da pauta; das contas do grafo sai o <b>formato</b> que o público consome. Perfil de empresa não serve (só posta anúncio). Elas são visitadas junto com as contas do grafo.</p>
        <textarea id="cx-ref" rows="3" placeholder="@fulano_ceo&#10;https://instagram.com/ciclana.founder"></textarea>
        <div class="iarow" style="margin-top:10px"><button type="button" class="btn-pri" id="cx-addref">Adicionar referências</button></div>
      </div>
      ${sug.length ? `<h2 class="h2">Referências sugeridas <span class="motivos">— confira o perfil antes de ativar</span></h2><div class="tablewrap"><table class="t"><tbody>${sug.map(linha).join('')}</tbody></table></div>` : ''}
      ${lista.length ? `<h2 class="h2">Referências (${lista.filter((r) => r.status === 'ativa').length})</h2><div class="tablewrap"><table class="t"><thead><tr><th>Conta</th><th>Status</th><th>Visita</th><th></th></tr></thead><tbody>${lista.map(linha).join('')}</tbody></table></div>` : ''}`;
  }
  function ligarSementes() {
    document.getElementById('cx-addref')?.addEventListener('click', async () => {
      const r = await acao('referencias.add', { texto: document.getElementById('cx-ref').value });
      if (r) aviso(`${r.adicionadas.length} referências adicionadas${r.invalidas.length ? `, inválidas: ${r.invalidas.join(', ')}` : ''}. Clique em “Visitar contas” para trazer os posts.`, r.invalidas.length > 0);
    });
    root.querySelectorAll('[data-ref]').forEach((b) => b.addEventListener('click', () => acao('referencia.status', { username: b.dataset.ref, status: b.dataset.st })));
    document.getElementById('cx-addsem')?.addEventListener('click', async () => {
      const r = await acao('sementes.add', { texto: document.getElementById('cx-sem').value });
      if (r) aviso(`${r.adicionadas.length} adicionadas${r.jaExistiam.length ? `, ${r.jaExistiam.length} já existiam` : ''}${r.invalidas.length ? `, inválidas: ${r.invalidas.join(', ')}` : ''}`, r.invalidas.length > 0);
    });
    root.querySelectorAll('[data-sem]').forEach((b) => b.addEventListener('click', () => acao('semente.status', { username: b.dataset.sem, status: b.dataset.st })));
    root.querySelectorAll('[data-papel]').forEach((s) => s.addEventListener('change', () => acao('conta.papel', { username: s.dataset.papel, papel: s.value || null })));
    root.querySelectorAll('[data-cacao]').forEach((b) => b.addEventListener('click', () => {
      b.closest('details')?.removeAttribute('open');
      rodar('conta-' + b.dataset.cacao, b.dataset.conta);
      document.getElementById('cx-jobst')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
    // um menu aberto por vez; clicar fora fecha
    root.querySelectorAll('.cx-menu').forEach((d) => d.addEventListener('toggle', () => {
      if (!d.open) return;
      root.querySelectorAll('.cx-menu[open]').forEach((o) => { if (o !== d) o.removeAttribute('open'); });
      // a tabela rola na horizontal e cortaria o menu: ele flutua sobre a pagina, junto do botao
      const l = d.querySelector('.cx-menu-l');
      const r = d.querySelector('summary').getBoundingClientRect();
      const w = Math.max(230, l.offsetWidth);
      const h = l.offsetHeight;
      l.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
      l.style.top = `${r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    }));
  }
  window.addEventListener('scroll', () => document.querySelectorAll('#view-creator .cx-menu[open]').forEach((o) => o.removeAttribute('open')), true);
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.cx-menu')) document.querySelectorAll('#view-creator .cx-menu[open]').forEach((o) => o.removeAttribute('open'));
  });

  /* ---------------------------------------------------------------- desenho */

  function draw() {
    if (!D || root.hidden) return;
    if (tab === 'pauta' && D.persona) {
      root.innerHTML = drawPauta();
      ligarPauta();
      ligarDetalhe();
    } else if (tab === 'sementes') {
      root.innerHTML = drawSementes();
      ligarSementes();
    } else {
      root.innerHTML = drawCreator();
      ligarCreator();
    }
    ligarTopo();
    ligarManual();
    ligarVirar();
    desenharJob();
  }

  async function render(t) {
    tab = t;
    try {
      if (!D) root.innerHTML = '<div class="empty-state"><b>Carregando…</b></div>';
      await carregar();
      draw();
      pollJob();
    } catch (e) {
      root.innerHTML = `<div class="empty-state"><b>Não consegui carregar</b>${esc(e.message)}. Se o painel foi iniciado antes da atualização, pare com Ctrl+C e rode <code>npm run painel</code> de novo.</div>`;
    }
  }

  const css = document.createElement('style');
  css.textContent = `
  .cx-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; margin-top: 24px; }
  .cx-funil { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13px; color: var(--muted); margin-left: auto; }
  .cx-funil b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .cx-funil i { color: var(--faint); font-style: normal; }
  .cx-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .cx-head .h2 { margin-right: auto; }
  .cx-ideias { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 16px; align-items: start; }
  .cx-ideia { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
  .cx-ideia.st-aceita { border-color: var(--t-car-bar); }
  .cx-ideia.st-recusada { opacity: .62; }
  .cx-ideia h3, .cx-radar h3 { font-family: var(--display); font-size: 19px; line-height: 1.2; margin: 4px 0 8px; letter-spacing: -.01em; }
  .cx-ideia p { margin: 0 0 8px; font-size: 14px; line-height: 1.55; }
  .cx-ideia blockquote { margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 8px 8px 0; font-size: 14.5px; }
  .cx-meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .cx-meta a { text-decoration: none; }
  .cx-meta { min-width: 0; }
  .cx-meta .chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .cx-virar { padding: 2px 8px; font-size: 11.5px; margin-left: 4px; }
  .cx-fmtref { display: flex; gap: 10px; align-items: center; margin: 4px 0 6px; padding: 8px; border: 1px dashed var(--line); border-radius: 10px; }
  .cx-thumb { display: block; aspect-ratio: 4 / 5; border-radius: 10px; overflow: hidden; background: var(--surface-2); color: var(--muted); font-size: 11px; text-decoration: none; }
  .cx-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cx-thumb span { display: block; padding: 8px; }
  .cx-thumb.mini { width: 64px; flex: 0 0 64px; }
  .cx-thumb.vazio { display: grid; place-items: center; }
  .cx-acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  .cx-recusa { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; }
  .cx-motivos { display: flex; flex-wrap: wrap; gap: 6px; }
  .cx-in, .cx-bar input, .iabox .iarow input[type=text] { height: 36px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); font: inherit; font-size: 14px; padding: 0 10px; }
  .cx-in { width: 100%; }
  .cx-lnk { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; padding: 0 4px; }
  .cx-radares { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 14px; }
  .cx-radar { background: var(--surface); border: 1px dashed var(--line); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .cx-radar p { margin: 0; }
  .cx-thumbs { display: flex; gap: 6px; overflow-x: auto; }
  #cx-log { max-height: 300px; overflow: auto; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin: 10px 0 0; font: 12px/1.5 var(--mono); color: var(--ink); white-space: pre-wrap; }
  #cx-jobst { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 14px; margin-top: 4px; }
  .cx-det { margin-top: 26px; }
  .cx-det summary { cursor: pointer; font-weight: 600; color: var(--accent); }
  .cx-h3 { font-family: var(--mono); font-size: 11.5px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 18px 0 8px; }
  .cx-cap { max-width: 46ch; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .cx-perguntas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 12px 18px; margin: 6px 0 14px; }
  .cx-q { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
  .iabox .cx-q textarea, .iabox .cx-terr textarea, .iabox #cx-sem { min-height: 0; font: 14px/1.5 var(--body); }
  .cx-terr { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 12px 18px; }
  .cx-terr label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .cx-terr label.check { flex-direction: row; font-weight: 500; font-size: 14px; color: var(--ink); }
  .cx-lbl { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
  .cx-fmts { display: flex; flex-wrap: wrap; gap: 8px 14px; }
  .cx-mt { margin-top: 14px; }
  #cx-dlg { border: 0; padding: 0; border-radius: 18px; background: var(--surface); color: var(--ink); width: min(980px, calc(100vw - 32px)); max-height: min(90vh, 940px); overflow: auto; box-shadow: 0 30px 90px -24px rgba(0,0,0,.5); }
  #cx-dlg::backdrop { background: var(--scrim); }
  #cx-dlg .close { position: sticky; top: 12px; float: right; margin: 12px 12px 0 0; z-index: 2; }
  .cx-dcorpo { padding: 26px 28px 30px; }
  .cx-dtit { font-family: var(--display); font-size: 26px; line-height: 1.15; letter-spacing: -.015em; margin: 6px 40px 12px 0; }
  .cx-dhook { margin: 0 0 14px; padding: 10px 14px; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 10px 10px 0; font-size: 16px; }
  .cx-dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 18px; margin: 0 0 14px; font-size: 14.5px; line-height: 1.55; }
  .cx-dl dt { color: var(--muted); font-weight: 600; }
  .cx-dl dd { margin: 0; }
  .cx-dsec { margin-top: 22px; padding-top: 6px; border-top: 1px solid var(--line); }
  .cx-dpost { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 18px; }
  .cx-dpost.peq { grid-template-columns: 140px minmax(0, 1fr); }
  .cx-dmid { width: 100%; border-radius: 12px; background: #0B0C16; display: block; max-height: 520px; object-fit: contain; }
  .cx-dmid.vazio { aspect-ratio: 4 / 5; display: grid; place-items: center; color: var(--muted); font-size: 12px; background: var(--surface-2); }
  .cx-dslides { display: flex; gap: 6px; overflow-x: auto; scroll-snap-type: x mandatory; }
  .cx-dslides img { width: 100%; flex: 0 0 100%; border-radius: 12px; scroll-snap-align: start; }
  .cx-dpost.peq .cx-dslides img { flex-basis: 100%; }
  .cx-dtxt p { margin: 0 0 8px; }
  .cx-dleg { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.6; max-height: 320px; overflow: auto; }
  .cx-denc { font-size: 13.5px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin: 0 0 10px; }
  .cx-ideia[data-ideia], .cx-radar[data-ideia] { cursor: pointer; }
  .cx-ideia[data-ideia]:hover, .cx-radar[data-ideia]:hover { box-shadow: var(--shadow); }
  @media (max-width: 640px) { .cx-dpost, .cx-dpost.peq { grid-template-columns: 1fr; } .cx-dl { grid-template-columns: 1fr; } .cx-dcorpo { padding: 18px; } }
  .cx-ig { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 20px; align-items: start; }
  .cx-vis { position: relative; background: #0B0C16; border-radius: 12px; overflow: hidden; }
  .cx-vis.vazio { aspect-ratio: 4 / 5; display: grid; place-items: center; color: var(--muted); font-size: 12px; background: var(--surface-2); }
  .cx-vslide img, .cx-vslide video { width: 100%; display: block; max-height: 600px; object-fit: contain; background: #0B0C16; }
  .cx-vnav { position: absolute; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(10,12,24,.6); color: #fff; font-size: 20px; line-height: 1; cursor: pointer; }
  .cx-vnav.prev { left: 8px; } .cx-vnav.next { right: 8px; }
  .cx-vcont { position: absolute; top: 8px; right: 10px; background: rgba(10,12,24,.65); color: #fff; font: 11px var(--mono); padding: 2px 7px; border-radius: 999px; }
  .cx-igcab { margin-bottom: 8px; }
  .cx-verif { color: var(--accent); font-weight: 700; }
  .cx-bio summary { cursor: pointer; font-size: 12.5px; color: var(--muted); }
  .cx-bio p { white-space: pre-wrap; font-size: 13px; margin: 4px 0 0; }
  .cx-igmet { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 14px; margin-bottom: 4px; }
  .cx-h4 { font-size: 12.5px; font-weight: 600; color: var(--muted); margin: 12px 0 4px; }
  .cx-fala { background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
  @media (max-width: 640px) { .cx-ig { grid-template-columns: 1fr; } }
  .cx-molde { margin: 0 0 10px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); font-size: 13.5px; }
  .cx-molde summary { cursor: pointer; }
  .cx-molde p { margin: 6px 0 0; white-space: pre-wrap; line-height: 1.55; }
  .cx-versoes { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .cx-rerro { margin: 0 0 10px; padding: 8px 12px; border: 1px solid var(--t-reel-ink, #c33); border-radius: 10px; font-size: 13.5px; overflow-wrap: anywhere; }
  .cx-menu { position: relative; display: inline-block; }
  .cx-menu > summary { list-style: none; cursor: pointer; padding: 2px 10px; font-weight: 700; letter-spacing: .05em; }
  .cx-menu > summary::-webkit-details-marker { display: none; }
  .cx-menu-l { position: fixed; z-index: 60; min-width: 230px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow, 0 12px 30px -12px rgba(0,0,0,.35)); padding: 6px; display: flex; flex-direction: column; white-space: normal; }
  .cx-menu-l > .motivos { padding: 4px 8px 6px; font-size: 12px; }
  .cx-menu-l button { text-align: left; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 14px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
  .cx-menu-l button:hover:not(:disabled) { background: var(--surface-2); }
  .cx-menu-l button:disabled { opacity: .45; cursor: default; }
  .cx-menu-l button span { display: block; font-size: 12px; color: var(--muted); }
  .cx-vis-sel { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .cx-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .cx-seg button { border: 0; background: var(--surface); color: var(--muted); font: inherit; font-size: 13.5px; font-weight: 600; padding: 7px 12px; cursor: pointer; }
  .cx-seg button + button { border-left: 1px solid var(--line); }
  .cx-seg button.on { background: var(--accent-soft); color: var(--accent); }
  .cx-perigo { color: var(--t-reel-ink, #c33); margin-left: auto; }
  .cx-ed { width: 100%; box-sizing: border-box; border: 1px solid transparent; border-radius: 8px; background: var(--surface-2); color: var(--ink); font: inherit; font-size: 14px; line-height: 1.5; padding: 5px 8px; resize: none; overflow: hidden; }
  .cx-ed:hover { border-color: var(--line); }
  .cx-ed:focus { outline: none; border-color: var(--accent); background: var(--surface); }
  .cx-ed.cx-bfala { font-size: 15px; }
  .cx-btempo .cx-ed { font: 12px/1.4 var(--mono); padding: 4px 6px; margin-bottom: 4px; }
  .cx-elbl { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-top: 6px; }
  .cx-elbl .cx-ed { margin-top: 3px; font-weight: 400; }
  .cx-emove { display: flex; gap: 4px; margin-top: 4px; }
  .cx-emove .wbtn { padding: 1px 7px; font-size: 12px; }
  .cx-egancho { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 6px; }
  .cx-egancho:first-child .cx-ed { font-weight: 600; }
  .cx-erow { display: grid; grid-template-columns: minmax(0, 1fr) 140px; gap: 12px; margin: 6px 0; }
  .cx-edacts { position: sticky; bottom: 0; background: var(--surface); padding: 10px 0; border-top: 1px solid var(--line); }
  .cx-audio { margin: 0 0 8px; font-size: 14px; }
  .cx-som { font-weight: 600; }
  .cx-tom { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; vertical-align: middle; }
  .cx-falacab { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .cx-falas { display: flex; flex-direction: column; gap: 2px; border-left: 3px solid var(--accent-soft); padding-left: 14px; }
  .cx-batida { padding: 8px 0; }
  .cx-bcab { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 3px; }
  .cx-btmp { font: 12px/1.4 var(--mono); color: var(--muted); }
  .cx-bparte { font-size: 12px; color: var(--muted); text-transform: lowercase; }
  .cx-bcab .cx-tom { margin-left: 0; }
  .cx-falas .cx-bfala { font-size: 17px; line-height: 1.6; margin: 0 0 4px; }
  .cx-enf { color: var(--accent); }
  .cx-pausa { color: var(--muted); font-weight: 700; padding: 0 2px; }
  .cx-falas.tp .cx-bcab, .cx-falas.tp .cx-bmeta { display: none; }
  .cx-falas.tp .cx-bfala { font-size: 24px; line-height: 1.55; }
  .cx-falas.tp .cx-batida { padding: 10px 0; }
  .cx-egcorpo { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .cx-egcorpo .ed-gtom { font-size: 12.5px; padding: 3px 8px; }
  .cx-erow3 { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 12px; }
  .cx-erow3 select { width: 100%; margin-top: 3px; }
  .cx-script { display: flex; flex-direction: column; gap: 4px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; padding: 6px 18px; }
  .cx-cena { padding: 12px 0; border-top: 1px dashed var(--line); }
  .cx-cena:first-child { border-top: 0; }
  .cx-cenacab { font: 600 11.5px/1.4 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .cx-dir { font-style: italic; color: var(--muted); font-size: 14px; margin-bottom: 2px; }
  .cx-dialogo { font-size: 17px; line-height: 1.6; margin: 0 0 4px; }
  .cx-nota { font-size: 13px; color: var(--muted); }
  .cx-script.tp .cx-cenacab, .cx-script.tp .cx-dir, .cx-script.tp .cx-nota { display: none; }
  .cx-script.tp .cx-dialogo { font-size: 24px; line-height: 1.55; }
  .cx-script.tp .cx-cena { border-top: 0; padding: 8px 0; }
  .cx-outras { margin: 0 0 6px; padding-left: 20px; font-size: 14.5px; line-height: 1.6; }
  .cx-fala { background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; }
  .cx-fala p { font-size: 17px; line-height: 1.65; margin: 0 0 12px; }
  .cx-fala p:last-child { margin-bottom: 0; }
  .cx-fala.tp p { font-size: 24px; line-height: 1.55; }
  .cx-ed.cx-efala { font-size: 16px; line-height: 1.65; background: var(--surface-2); }
  .cx-rta { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); font: 14px/1.55 var(--body); padding: 8px 10px; resize: vertical; }
  .cx-rperg { margin: 0 0 8px; padding: 8px 12px; background: var(--accent-soft); border-radius: 10px; font-size: 14.5px; }
  .cx-rcab { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 6px; }
  .cx-rcab .wbtn.on { border-color: var(--accent); color: var(--accent); }
  .cx-ganchos { margin: 0 0 6px; padding-left: 22px; font-size: 15px; line-height: 1.5; }
  .cx-ganchos li:first-child { font-weight: 600; }
  .cx-blocos { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .cx-bloco { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; padding: 10px 12px; border-top: 1px solid var(--line); }
  .cx-bloco:first-child { border-top: 0; }
  .cx-btempo { font: 12px/1.4 var(--mono); color: var(--muted); }
  .cx-btempo span { display: block; font-family: var(--body); font-size: 12px; margin-top: 2px; }
  .cx-bcorpo p { margin: 0 0 4px; }
  .cx-bfala { font-size: 15px; line-height: 1.55; }
  .cx-bmeta { font-size: 13px; color: var(--muted); }
  .cx-bmeta b { color: var(--ink); font-weight: 600; margin-right: 4px; }
  .cx-rtxt { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.6; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .cx-lembretes { margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 10px; font-size: 14px; }
  .cx-lembretes ul { margin: 6px 0 0; padding-left: 20px; }
  .cx-preencher { background: var(--accent-soft); color: var(--accent); border-radius: 4px; padding: 0 3px; font-weight: 600; }
  .cx-rajuste { display: flex; gap: 8px; margin-top: 10px; }
  .cx-rajuste .cx-in { flex: 1; }
  @media (max-width: 560px) { .cx-bloco { grid-template-columns: 1fr; gap: 4px; } .cx-rajuste { flex-direction: column; } }
  #cx-toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); background: var(--ink); color: var(--bg); padding: 10px 16px; border-radius: 10px; font-size: 14px; opacity: 0; pointer-events: none; transition: .2s; z-index: 50; max-width: min(92vw, 560px); }
  #cx-toast.show { opacity: 1; transform: translate(-50%, 0); }
  #cx-toast.bad { background: var(--t-reel-ink); color: #fff; }
  @media (max-width: 560px) { .cx-ideia { grid-template-columns: 1fr; } .cx-ideia .cx-thumb { max-width: 180px; } .cx-funil { margin-left: 0; } }
  `;
  document.head.appendChild(css);

  window.Creator = { tabs: TABS, render, isTab: (t) => TABS.includes(t) };
})();
