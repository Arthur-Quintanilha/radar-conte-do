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
      JOB = { rodando: true, rotulo: conta ? `${cmd.replace('conta-', '')} @${conta}` : ROTULO_CMD[cmd] || cmd, saida: [], inicio: Date.now() };
      // quem acabou de mandar rodar quer ver: a caixinha abre
      logEstado = 'aberto';
      try { localStorage.setItem('cx-log', 'aberto'); } catch { /* sem storage */ }
      desenharJob();
      setTimeout(pollJob, 600);
    } catch (e) {
      aviso(e.message, true);
    }
  }
  const ROTULO_CMD = { semana: 'Ciclo completo', 'semana-analise': 'Só a análise', whisper: 'Transcrever reels', encaixe: 'Avaliar posts', pauta: 'Gerar mais ideias' };
  const ETAPAS_TOPO = [
    ['semana-analise', 'Só a análise', 'sem abrir o navegador'],
    ['whisper', 'Transcrever reels', 'os da janela deste creator'],
    ['encaixe', 'Avaliar posts', 'a IA confere o território'],
    ['pauta', 'Gerar mais ideias', 'a partir dos posts já avaliados'],
  ];
  /** botao principal no topo: roda o ciclo; a setinha abre as etapas avulsas */
  function desenharCiclo() {
    const slot = document.getElementById('cx-ciclo');
    if (!slot || !D) return;
    const rodando = Boolean(JOB?.rodando);
    const sem = !D.persona;
    slot.innerHTML = `<div class="cx-split">
        <button type="button" class="btn-pri cx-split-pri" id="cx-buscar" ${rodando || sem ? 'disabled' : ''} title="Visita as contas, transcreve, avalia os posts e acrescenta ideias à pauta. Abre o Chrome nesta máquina.">${rodando ? '<span class="cx-ponto"></span>Rodando…' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>Buscar ideias'}</button>
        <details class="cx-split-mais"><summary class="btn-pri" aria-label="Outras etapas" title="Outras etapas" ${rodando || sem ? 'aria-disabled="true"' : ''}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
          <div class="cx-conta-l" role="menu">${ETAPAS_TOPO.map(([c, t, d]) => `<button type="button" role="menuitem" data-topo="${c}" ${rodando || sem ? 'disabled' : ''}><span class="cx-cnome"><b>${esc(t)}</b><small>${esc(d)}</small></span></button>`).join('')}
            <hr><button type="button" role="menuitem" id="cx-manual"><span class="cx-cnome"><b>Fazer à mão</b><small>copiar o prompt e colar a resposta da IA</small></span></button>
            <button type="button" role="menuitem" id="cx-verlog"><span class="cx-cnome"><b>Ver o log</b><small>da última etapa</small></span></button></div>
        </details>
      </div>`;
    slot.querySelector('#cx-buscar')?.addEventListener('click', () => rodar('semana'));
    const det = slot.querySelector('details');
    slot.querySelectorAll('[data-topo]').forEach((b) => b.addEventListener('click', () => { det.removeAttribute('open'); rodar(b.dataset.topo); }));
    slot.querySelector('#cx-verlog')?.addEventListener('click', () => { det.removeAttribute('open'); abrirLog(); });
    slot.querySelector('#cx-manual')?.addEventListener('click', () => { det.removeAttribute('open'); abrirManual(); });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.cx-split-mais')) document.querySelector('.cx-split-mais[open]')?.removeAttribute('open');
  });

  /* caixinha do log no canto inferior direito, como uma janela de mensagens:
     aberta mostra o log; minimizada fica so o nome da etapa; fechada some ate a proxima etapa */
  let logEstado = (() => { try { return localStorage.getItem('cx-log') || 'min'; } catch { return 'min'; } })();
  const guardarLog = (e) => { logEstado = e; try { localStorage.setItem('cx-log', e); } catch { /* sem storage */ } desenharLog(); };
  function abrirLog() { guardarLog('aberto'); }
  let logGrande = (() => { try { return localStorage.getItem('cx-log-grande') === '1'; } catch { return false; } })();
  const alternarGrande = () => { logGrande = !logGrande; try { localStorage.setItem('cx-log-grande', logGrande ? '1' : '0'); } catch { /* sem storage */ } desenharLog(); };
  function desenharLog() {
    let el = document.getElementById('cx-logbox');
    if (!JOB || !JOB.rotulo || logEstado === 'oculto') { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cx-logbox';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    const seg = JOB ? Math.max(0, Math.round(((JOB.fim || Date.now()) - (JOB.inicio || Date.now())) / 1000)) : 0;
    const dur = seg < 60 ? `${seg}s` : `${Math.floor(seg / 60)}min ${String(seg % 60).padStart(2, '0')}s`;
    const estado = JOB.rodando ? 'rodando' : JOB.codigo === 0 ? 'ok' : 'erro';
    const txt = JOB.rodando ? `rodando · ${dur}` : `${JOB.codigo === 0 ? 'terminou' : 'falhou'} · ${dur}`;
    const icone = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    if (logEstado !== 'aberto') {
      el.className = 'min';
      el.innerHTML = `<button type="button" class="cx-lbpill" title="Ver o log"><span class="ponto ${estado}"></span><b>${esc(JOB.rotulo)}</b><span class="motivos">${esc(txt)}</span>${icone('m18 15-6-6-6 6')}</button>${JOB.rodando ? `<button type="button" class="cx-lbx cx-lbstop" title="Parar a etapa" aria-label="Parar a etapa"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>` : `<button type="button" class="cx-lbx" title="Fechar" aria-label="Fechar">${icone('M6 6l12 12M18 6 6 18')}</button>`}`;
      el.querySelector('.cx-lbpill').addEventListener('click', () => guardarLog('aberto'));
      el.querySelector('.cx-lbstop')?.addEventListener('click', () => postJson('/api/creator/job', { parar: true }).then(pollJob));
      el.querySelector('.cx-lbx:not(.cx-lbstop)')?.addEventListener('click', () => guardarLog('oculto'));
      return;
    }
    const pre = el.querySelector('pre');
    const noFim = !pre || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
    el.className = logGrande ? 'aberto grande' : 'aberto';
    el.innerHTML = `<header><span class="ponto ${estado}"></span><div><b>${esc(JOB.rotulo)}</b><span class="motivos">${esc(txt)}</span></div>
        ${JOB.rodando ? '<button type="button" class="cx-lnk" id="cx-lparar">parar</button>' : ''}
        <button type="button" class="cx-lbx" id="cx-lgrande" title="${logGrande ? 'Diminuir' : 'Expandir'}" aria-label="${logGrande ? 'Diminuir' : 'Expandir'}">${icone(logGrande ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}</button>
        <button type="button" class="cx-lbx" id="cx-lmin" title="Minimizar" aria-label="Minimizar">${icone('M5 12h14')}</button>
        ${JOB.rodando ? '' : `<button type="button" class="cx-lbx" id="cx-lfechar" title="Fechar" aria-label="Fechar">${icone('M6 6l12 12M18 6 6 18')}</button>`}</header>
      <pre>${esc((JOB.saida || []).join('\n'))}</pre>`;
    const p2 = el.querySelector('pre');
    if (noFim) p2.scrollTop = p2.scrollHeight;
    el.querySelector('#cx-lmin').addEventListener('click', () => guardarLog('min'));
    el.querySelector('#cx-lgrande').addEventListener('click', alternarGrande);
    if (!window.__cxLogFora) {
      window.__cxLogFora = true;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && logGrande && document.getElementById('cx-logbox')?.classList.contains('grande')) alternarGrande(); });
      document.addEventListener('mousedown', (e) => {
        const box = document.getElementById('cx-logbox');
        if (logGrande && box?.classList.contains('grande') && !box.contains(e.target)) alternarGrande();
      });
    }
    el.querySelector('#cx-lfechar')?.addEventListener('click', () => guardarLog('oculto'));
    el.querySelector('#cx-lparar')?.addEventListener('click', () => postJson('/api/creator/job', { parar: true }).then(pollJob));
  }

  /** resumo do job no menu lateral: o que esta rodando agora, ou como terminou a ultima etapa */
  function desenharStatus() {
    const el = document.getElementById('cx-status');
    if (!el) return;
    if (!el.dataset.ligado) {
      el.dataset.ligado = '1';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.title = 'Ver o log';
      el.addEventListener('click', abrirLog);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrirLog(); });
    }
    if (!JOB || !JOB.rotulo) { el.innerHTML = ''; return; }
    const ultima = [...(JOB.saida || [])].reverse().find((l) => l.trim() && !/^\s*[{}]/.test(l)) || '';
    const h = (ts) => (ts ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '');
    el.innerHTML = JOB.rodando
      ? `<span class="ponto rodando"></span><b>${esc(JOB.rotulo)}</b>${ultima ? `<span class="log" title="${esc(ultima)}">${esc(ultima.trim())}</span>` : ''}`
      : `<span class="ponto ${JOB.codigo === 0 ? 'ok' : 'erro'}"></span>${esc(JOB.rotulo)} <span>· ${JOB.codigo === 0 ? 'terminou' : 'falhou'}${JOB.fim ? ` às ${h(JOB.fim)}` : ''}</span>`;
  }
  function desenharJob() {
    desenharStatus();
    desenharCiclo();
    desenharLog();
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
  /* ---------------------------------------------------------------- IA manual */

  /* IA a mao: o mesmo prompt da API, para colar numa conversa com a LLM. Abre pelo menu do topo */
  const TIPOS_MANUAL = ['territorio', 'contas', 'encaixe', 'pauta'];
  const NOMES_MANUAL = { territorio: 'Território', contas: 'Classificar contas', encaixe: 'Avaliar posts', pauta: 'Gerar ideias' };
  function abrirManual(tipo) {
    if (!D?.persona) { aviso('Escolha um creator primeiro.', true); return; }
    let dl = document.getElementById('cx-manual-dlg');
    if (!dl) {
      dl = document.createElement('dialog');
      dl.id = 'cx-manual-dlg';
      document.body.appendChild(dl);
      dl.addEventListener('click', (e) => { if (e.target === dl) dl.close(); });
    }
    if (tipo || !TIPOS_MANUAL.includes(manual.tipo)) manual = { ...manual, tipo: tipo || 'encaixe', prompt: '', info: '' };
    desenharManual();
    if (!dl.open) dl.showModal();
  }
  function desenharManual() {
    const dl = document.getElementById('cx-manual-dlg');
    if (!dl) return;
    dl.innerHTML = `<div class="cx-mform">
      <button class="close" type="button" id="cx-mfechar" aria-label="Fechar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <h2 class="h2">Fazer à mão</h2>
      <p class="motivos">${D.api.chave ? '' : 'Sem <code>ANTHROPIC_API_KEY</code> no .env. '}Gere o prompt, cole numa conversa com a IA e traga a resposta de volta. O resultado é o mesmo da API.</p>
      <div class="iarow">
        <div class="seg" id="cx-mtipo">${TIPOS_MANUAL.map((t) => `<button type="button" data-t="${t}" aria-pressed="${manual.tipo === t}">${NOMES_MANUAL[t]}</button>`).join('')}</div>
      </div>
      <div class="iarow">
        <button type="button" class="btn-pri" id="cx-mgerar">Gerar prompt</button>
        <button type="button" class="reload" id="cx-mcopiar" ${manual.prompt ? '' : 'disabled'}>Copiar</button>
        <span class="motivos">${esc(manual.info)}</span>
      </div>
      <textarea id="cx-mprompt" class="cx-rta" rows="7" readonly placeholder="O prompt aparece aqui.">${esc(manual.prompt)}</textarea>
      <textarea id="cx-mresp" class="cx-rta" rows="6" placeholder="Cole aqui a resposta inteira da IA, com o bloco json"></textarea>
      <div class="iarow"><button type="button" class="btn-pri" id="cx-mimportar">Importar</button><span class="iares" id="cx-mres"></span></div>
    </div>`;
    ligarManual(dl);
  }
  function ligarManual(dl) {
    const q = (sel) => dl.querySelector(sel);
    q('#cx-mfechar').addEventListener('click', () => dl.close());
    q('#cx-mtipo').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      manual = { ...manual, tipo: b.dataset.t, prompt: '', info: '' };
      desenharManual();
    });
    q('#cx-mgerar').addEventListener('click', async () => {
      try {
        const r = await getJson(`/api/creator/tarefa?tipo=${manual.tipo}&persona=${encodeURIComponent(D.persona.id)}`);
        manual.prompt = r.prompt || '';
        manual.info = r.itens ? `${r.itens} itens · ~${nf.format(r.tokens)} tokens` : r.motivo || 'nada a fazer';
      } catch (e) { manual.info = e.message; }
      desenharManual();
    });
    q('#cx-mcopiar').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(manual.prompt); aviso('Prompt copiado'); } catch { q('#cx-mprompt').select(); }
    });
    q('#cx-mimportar').addEventListener('click', async () => {
      const texto = q('#cx-mresp').value;
      const out = q('#cx-mres');
      try {
        const r = await postJson('/api/creator/tarefa', { tipo: manual.tipo, texto, persona: D.persona.id, modelo: 'manual' });
        const extra = [r.invalidos?.length ? `${r.invalidos.length} fora do formato` : '', r.desconhecidos?.length ? `ids desconhecidos: ${r.desconhecidos.join(', ')}` : ''].filter(Boolean).join(' · ');
        manual.prompt = '';
        manual.info = `${r.gravados} gravados${extra ? ' · ' + extra : ''}`;
        await carregar();
        draw();
        desenharManual();
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
    void ps;
    return `<div class="cx-bar">
      ${f ? `<span class="cx-funil" title="Onde o ciclo da semana está">${[
        [f.sementes, 'sementes'], [f.referencias ?? 0, 'referências'], [f.comLista, 'com lista'], [f.contasGrafo, 'no grafo'], [f.consumidas, 'consumidas'], [f.postsJanela, `posts em ${f.janelaDias}d`], [f.dentro, 'dentro'], [f.radar, 'radar'],
      ].map(([n, t]) => `<span><b>${n}</b> ${t}</span>`).join('<i>›</i>')}</span>` : ''}
    </div>`;
  }
  /* seletor de creator no topo da pagina, como uma troca de conta: o creator
     escolhido vira o ativo, e todas as abas e o ciclo passam a ser dele */
  function desenharConta() {
    const slot = document.getElementById('cx-conta');
    if (!slot || !D) return;
    const ps = D.personas || [];
    const atual = D.persona;
    const ini = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
    slot.innerHTML = `<details class="cx-conta"><summary title="Trocar de creator">
        <span class="cx-av">${ini(atual?.nome)}</span>
        <span class="cx-cnome"><b>${esc(atual?.nome || 'Nenhum creator')}</b>${atual?.handle ? `<small>@${esc(atual.handle)}</small>` : '<small>creator</small>'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="cx-conta-l" role="menu">
        ${ps.map((p) => `<button type="button" role="menuitem" data-trocar="${p.id}" class="${p.id === atual?.id ? 'on' : ''}"><span class="cx-av">${ini(p.nome)}</span><span class="cx-cnome"><b>${esc(p.nome)}</b>${p.handle ? `<small>@${esc(p.handle)}</small>` : ''}</span>${p.id === atual?.id ? '<span class="cx-ok">✓</span>' : ''}</button>`).join('')}
        <hr>
        <button type="button" role="menuitem" id="cx-nova"><span class="cx-av cx-mais">+</span><span class="cx-cnome"><b>Novo creator</b></span></button>
      </div></details>`;
    const d = slot.querySelector('details');
    slot.querySelectorAll('[data-trocar]').forEach((b) => b.addEventListener('click', async () => {
      d.removeAttribute('open');
      if (b.dataset.trocar === atual?.id) return;
      if (JOB?.rodando) { aviso('Espere a etapa que está rodando terminar antes de trocar de creator.', true); return; }
      try {
        await postJson('/api/creator/acao', { acao: 'persona.ativar', persona: b.dataset.trocar });
        personaId = b.dataset.trocar;
        semana = null;
        dia = null;
        manual.prompt = '';
        await carregar();
        draw();
        aviso(`Agora você está em ${D.persona?.nome || 'outro creator'}.`);
      } catch (e) { aviso(e.message, true); }
    }));
    slot.querySelector('#cx-nova')?.addEventListener('click', () => { d.removeAttribute('open'); novoCreator(); });
  }

  /** dialogo de novo creator: so nome e @; a entrevista fica na aba Creator */
  function novoCreator() {
    if (JOB?.rodando) { aviso('Espere a etapa que está rodando terminar antes de criar outro creator.', true); return; }
    let dl = document.getElementById('cx-novo');
    if (!dl) {
      dl = document.createElement('dialog');
      dl.id = 'cx-novo';
      document.body.appendChild(dl);
      dl.addEventListener('click', (e) => { if (e.target === dl) dl.close(); });
    }
    dl.innerHTML = `<form method="dialog" class="cx-nform">
      <h2 class="h2">Novo creator</h2>
      <label class="cx-elbl">Nome <input type="text" class="cx-in" id="nv-nome" maxlength="60" required placeholder="ex.: Lucas"></label>
      <label class="cx-elbl">@ do Instagram <span class="motivos">(opcional)</span> <input type="text" class="cx-in" id="nv-handle" maxlength="40" placeholder="@usuario"></label>
      <div class="cx-acts"><button type="submit" class="btn-pri" id="nv-salvar">Criar creator</button><button type="button" class="cx-lnk" id="nv-cancelar">cancelar</button></div>
    </form>`;
    dl.querySelector('#nv-cancelar').addEventListener('click', () => dl.close());
    dl.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = dl.querySelector('#nv-nome').value.trim();
      if (!nome) { dl.querySelector('#nv-nome').focus(); return; }
      const btn = dl.querySelector('#nv-salvar');
      btn.disabled = true;
      try {
        const r = await postJson('/api/creator/acao', { acao: 'persona.criar', nome, handle: dl.querySelector('#nv-handle').value });
        await postJson('/api/creator/acao', { acao: 'persona.ativar', persona: r.id });
        personaId = r.id; semana = null; dia = null; manual.prompt = '';
        dl.close();
        await carregar();
        // o proximo passo e a entrevista e o territorio: vai direto para a aba Creator
        document.dispatchEvent(new CustomEvent('creator:aba', { detail: 'creator' }));
        draw();
        aviso(`${nome} criado e selecionado. Agora responda a entrevista e gere o território.`);
      } catch (err) {
        aviso(err.message, true);
        btn.disabled = false;
      }
    });
    dl.showModal();
    dl.querySelector('#nv-nome').focus();
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.cx-conta')) document.querySelector('.cx-conta[open]')?.removeAttribute('open');
  });

  function ligarTopo() {
    desenharConta();
    desenharCiclo();
    for (const b of root.querySelectorAll('[data-run]')) b.addEventListener('click', () => rodar(b.dataset.run));
  }

  /* ---------------------------------------------------------------- virar semente */

  const ehSemente = (u) => (D.sementes || []).some((s) => s.username === u && s.status !== 'rejeitada');
  function virarSemente(u) {
    if (!u) return '';
    if (ehSemente(u)) return '<span class="chip">semente</span>';
    return `<button type="button" class="wbtn cx-virar" data-virar="${esc(u)}" title="Adicionar @${esc(u)} como semente">+ semente</button>`;
  }
  const ehReferencia = (u) => (D.referencias || []).some((r) => r.username === u && r.status === 'ativa');
  function virarReferencia(u) {
    if (!u) return '';
    if (ehReferencia(u)) return '<span class="chip">referência</span>';
    return `<button type="button" class="wbtn cx-virar" data-virarref="${esc(u)}" title="Adicionar @${esc(u)} como referência">+ referência</button>`;
  }
  function ligarVirar() {
    root.querySelectorAll('[data-virarref]').forEach((b) => b.addEventListener('click', async () => {
      const r = await acao('referencias.add', { texto: b.dataset.virarref });
      if (r) aviso(r.adicionadas.length ? `@${b.dataset.virarref} agora é referência.` : `@${b.dataset.virarref} já era referência`);
    }));
    root.querySelectorAll('[data-virar]').forEach((b) => b.addEventListener('click', async () => {
      const r = await acao('sementes.add', { texto: b.dataset.virar });
      if (r) aviso(r.adicionadas.length ? `@${b.dataset.virar} agora é semente. Rode a coleta de "seguindo" para ela entrar no grafo.` : `@${b.dataset.virar} já era semente`);
    }));
  }

  /* ---------------------------------------------------------------- pauta */

  function thumb(p, grande) {
    if (!p) return `<div class="cx-thumb vazio">sem post</div>`;
    const video = p.tipo === 'reel' || p.tipo === 'video' || p.tipo === 2 || p.tipo === '2';
    return `<a class="cx-thumb${grande ? '' : ' mini'}" href="${igp(p.shortcode)}" target="_blank" rel="noopener" title="Abrir o post no Instagram">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy">` : `<span>${esc((p.legenda || '').slice(0, 90))}</span>`}${video ? '<b class="cx-play" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></b>' : ''}<em class="cx-abrir" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${grande ? '<span>Abrir no Instagram</span>' : ''}</em></a>`;
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
        <h3>${esc(i.titulo)}</h3>
        <div class="cx-meta cx-meta-min">${[
          i.formato ? esc(FORMATOS[i.formato] || (i.formato.split(/[,(—-]/)[0] || '').replace(/_/g, ' ').trim()) : null,
          p ? `<a class="cx-reflink" href="${ig(p.autor)}" target="_blank" rel="noopener" title="Abrir o perfil de @${esc(p.autor)} no Instagram">ref. @${esc(p.autor)}</a>` : null,
          i.createdAt ? esc(D.visao === 'dia' ? horaDe(i.createdAt) : `${nomeDia(new Date(i.createdAt * 1000).toLocaleDateString('sv-SE'))} ${horaDe(i.createdAt)}`) : null,
        ].filter(Boolean).map((x) => `<span>${x}</span>`).join('<i>·</i>')}</div>
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
      <div class="cx-radar-pe">${acts}</div>
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
      <details class="cx-det"><summary>Posts que o sinal apontou (${D.melhores.dentro.length} dentro, ${D.melhores.radar.length} radar) — revise o encaixe da IA</summary>
        <h3 class="cx-h3">Dentro do território</h3>${listaMelhores(D.melhores.dentro, 'dentro')}
        <h3 class="cx-h3">Radar</h3>${listaMelhores(D.melhores.radar, 'radar')}
      </details>`;
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
    return i > 0 ? { tema: l.slice(0, i).trim().slice(0, 80), detalhe: l.slice(i + 1).trim().slice(0, 400) } : (l.length > 80 ? { tema: l.slice(0, 80), detalhe: l.slice(0, 400) } : { tema: l, detalhe: '' });
  });
  const linhas = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean);

  /* exemplos que aparecem dentro de cada campo da entrevista */
  const DICA_PERGUNTA = {
    quem_e: 'Ex.: CEO da KXP, software house em BH com 11 pessoas. Cuido de produto e da parte comercial.',
    publico: 'Ex.: donos e diretores de empresas médias que precisam de um sistema sob medida e não sabem por onde começar.',
    assuntos: 'Ex.: como escolher um fornecedor de tecnologia, MVP enxuto, erros que já vi clientes cometerem, bastidores de projeto.',
    pessoal: 'Ex.: corrida de rua, viagens com a família, café especial.',
    fora: 'Ex.:\npolítica\nreligião',
  };
  const OBRIGATORIAS = ['quem_e', 'publico'];

  function terrForm(p, t) {
    const campo = (id, rot, val, rows, ph) => `<label class="cx-tcampo"><span>${rot}</span><textarea id="${id}" class="cx-ed" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;
    return `<div class="iabox cx-terrbox">
      <div class="cx-secab"><h2 class="h2">Território ${t ? `<span class="motivos">v${p.territorioVersao}</span>` : ''}</h2><span class="motivos">${t ? 'Revise e ajuste. Um item por linha. Mudar o território reavalia os posts na próxima rodada.' : 'Ainda não gerado. Responda a entrevista e gere com a IA, ou preencha à mão.'}</span></div>
      <div class="cx-tcol">
        ${campo('t-resumo', 'Quem é', t?.resumo, 2, '2 ou 3 frases: quem é, o que faz')}
        ${campo('t-publico', 'Quem quer atrair', t?.publico || p.publico, 2, 'O público, em uma ou duas frases')}
        ${campo('t-temas', 'Temas profissionais', linhasTema(t?.temas), 2, 'Um tema por linha. Ex.: MVP enxuto: MVP bom é MVP pequeno')}
        ${campo('t-pessoal', 'Lado pessoal', linhasTema(t?.pessoal), 2, 'Um por linha. Ex.: corrida de rua')}
        ${campo('t-opinioes', 'Opiniões fortes', (t?.opinioes || []).join('\n'), 2, 'Uma por linha')}
        ${campo('t-historias', 'Histórias', (t?.historias || []).join('\n'), 2, 'Uma por linha')}
        ${campo('t-tom', 'Tom', t?.tom, 1, 'Como quer soar')}
        <div class="cx-tcampo"><span>Formatos em que fica à vontade</span><div class="cx-fmtchips">${Object.entries(FORMATOS).map(([k, v]) => `<button type="button" class="cx-fchip" data-fmt="${k}" aria-pressed="${t?.formatos?.includes(k) ? 'true' : 'false'}">${v}</button>`).join('')}</div></div>
      </div>
      <div class="cx-acts"><button type="button" class="btn-pri" id="cx-salvar-terr">Salvar território</button></div>
    </div>`;
  }

  function drawCreator() {
    const p = D.persona;
    if (!p) return `<div class="empty-state"><b>Nenhum creator ainda</b>Crie o primeiro no botão “Novo creator”, no topo da página.</div>`;
    const t = p.territorio;
    const ent = p.entrevista || {};
    const respondidas = D.perguntas.filter((q) => (ent[q.chave] || '').trim()).length;
    const pronta = OBRIGATORIAS.every((k) => (ent[k] || '').trim());
    const ini = esc((p.nome || '?').trim().charAt(0).toUpperCase());
    return `${topo()}
      <div class="cx-perfil">
        <span class="cx-av cx-av-g">${ini}</span>
        <div class="cx-perfil-campos">
          <input type="text" id="cx-nome" class="cx-in cx-in-nome" value="${esc(p.nome)}" maxlength="60" aria-label="Nome">
          <input type="text" id="cx-handle" class="cx-in" value="${esc(p.handle ? '@' + p.handle : '')}" placeholder="@ do Instagram" maxlength="40" aria-label="@ do Instagram">
        </div>
        <div class="cx-perfil-status">
          <span class="cx-pst ${respondidas === D.perguntas.length ? 'ok' : ''}">Entrevista ${respondidas}/${D.perguntas.length}</span>
          <span class="cx-pst ${t ? 'ok' : ''}">${t ? `Território v${p.territorioVersao}` : 'Território não gerado'}</span>
        </div>
      </div>

      <div class="iabox cx-ent">
        <div class="cx-secab"><h2 class="h2">Entrevista</h2><span class="motivos">Respostas curtas. As marcadas como obrigatórias bastam para começar; o resto dá para completar depois.</span></div>
        <div class="cx-prog" aria-hidden="true"><span style="width:${Math.round((respondidas / D.perguntas.length) * 100)}%"></span></div>
        <ol class="cx-perg">${D.perguntas.map((q) => {
          const v = ent[q.chave] || '';
          if (q.chave === 'fora') {
            const itens = v.split('\n').map((x) => x.trim()).filter(Boolean);
            return `<li class="${itens.length ? 'feita' : ''}">
              <div class="cx-perg-cab"><span class="cx-perg-tit">${esc(q.pergunta.replace(/\s*Um por linha\.?/i, ''))}</span></div>
              <div class="cx-tags" id="cx-fora" data-q="fora">
                ${itens.map((x) => `<span class="cx-tag" data-v="${esc(x)}">${esc(x)}<button type="button" data-rmtag aria-label="Remover ${esc(x)}">×</button></span>`).join('')}
                <input type="text" class="cx-tag-in" placeholder="${itens.length ? 'mais um tema…' : 'ex.: política — Enter para adicionar'}" maxlength="80">
              </div>
            </li>`;
          }
          return `<li class="${v.trim() ? 'feita' : ''}">
            <div class="cx-perg-cab"><span class="cx-perg-tit">${esc(q.pergunta)}</span>${OBRIGATORIAS.includes(q.chave) ? '<span class="cx-obr">obrigatória</span>' : ''}</div>
            <textarea data-q="${q.chave}" class="cx-ed cx-perg-r" rows="2" placeholder="${esc(DICA_PERGUNTA[q.chave] || '')}">${esc(v)}</textarea>
          </li>`;
        }).join('')}</ol>
        <div class="cx-acts cx-ent-acts">
          <button type="button" class="btn-pri" id="cx-salvar-gerar" ${D.api.chave ? '' : 'disabled title="Sem chave de API: use Fazer à mão, no menu do topo"'}>${t ? 'Salvar e gerar o território de novo' : 'Salvar e gerar o território'}</button>
          <button type="button" class="reload" id="cx-salvar-ent">Só salvar</button>
          ${pronta ? '' : '<span class="motivos">Responda as obrigatórias (1 e 3) para gerar o território.</span>'}
        </div>
      </div>

      ${terrForm(p, t)}`;
  }
  function ligarCreator() {
    root.querySelectorAll('textarea.cx-ed').forEach((x) => { crescer(x); x.addEventListener('input', () => crescer(x)); });
    root.querySelectorAll('textarea[data-q]').forEach((x) => x.addEventListener('input', () => x.closest('li')?.classList.toggle('feita', Boolean(x.value.trim()))));
    const salvarEntrevista = async () => {
      const entrevista = {};
      root.querySelectorAll('textarea[data-q]').forEach((x) => (entrevista[x.dataset.q] = x.value));
      const fora = document.getElementById('cx-fora');
      if (fora) {
        const pend = fora.querySelector('.cx-tag-in').value.trim();
        entrevista.fora = [...fora.querySelectorAll('.cx-tag')].map((t) => t.dataset.v).concat(pend ? [pend] : []).join('\n');
      }
      return acao('persona.salvar', { entrevista, nome: document.getElementById('cx-nome').value, handle: document.getElementById('cx-handle').value || null });
    };
    document.getElementById('cx-salvar-ent')?.addEventListener('click', async () => { if (await salvarEntrevista()) aviso('Respostas salvas'); });
    document.getElementById('cx-salvar-gerar')?.addEventListener('click', async () => {
      const faltam = OBRIGATORIAS.filter((k) => !(root.querySelector(`textarea[data-q="${k}"]`)?.value || '').trim());
      if (faltam.length) { aviso('Responda as perguntas obrigatórias antes de gerar.', true); root.querySelector(`textarea[data-q="${faltam[0]}"]`)?.focus(); return; }
      if (await salvarEntrevista()) rodar('territorio');
    });
    // "fica de fora": um tema por vez, Enter adiciona
    const fora = document.getElementById('cx-fora');
    if (fora) {
      const inp = fora.querySelector('.cx-tag-in');
      const marcar = () => fora.closest('li')?.classList.toggle('feita', fora.querySelectorAll('.cx-tag').length > 0);
      const add = () => {
        const v = inp.value.trim().replace(/\s+/g, ' ');
        if (!v) return;
        if (![...fora.querySelectorAll('.cx-tag')].some((t) => t.dataset.v.toLowerCase() === v.toLowerCase())) {
          inp.insertAdjacentHTML('beforebegin', `<span class="cx-tag" data-v="${esc(v)}">${esc(v)}<button type="button" data-rmtag aria-label="Remover ${esc(v)}">×</button></span>`);
        }
        inp.value = '';
        inp.placeholder = 'mais um tema…';
        marcar();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        else if (e.key === 'Backspace' && !inp.value) { fora.querySelector('.cx-tag:last-of-type')?.remove(); marcar(); }
      });
      inp.addEventListener('blur', add);
      fora.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rmtag]');
        if (b) { b.closest('.cx-tag').remove(); marcar(); return; }
        inp.focus();
      });
    }
    root.querySelectorAll('.cx-fchip').forEach((f) => f.addEventListener('click', () => f.setAttribute('aria-pressed', String(f.getAttribute('aria-pressed') !== 'true'))));
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
        formatos: [...root.querySelectorAll('.cx-fchip[aria-pressed="true"]')].map((c) => c.dataset.fmt),
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
  let subSem = (() => { try { return localStorage.getItem('cx-sub') || 'sementes'; } catch { return 'sementes'; } })();
  /** cabecalho de cada parte: titulo e explicacao a esquerda, acoes a direita */
  const cabSec = (titulo, texto, acoes) => `<div class="cx-sechd">
      <div><h2 class="h2">${titulo}</h2><p class="motivos">${texto}</p></div>
      ${acoes.length ? `<div class="cx-sechd-acts">${acoes.map(([cmd, rot], i) => `<button type="button" class="${i === 0 ? 'btn-pri' : 'reload'}" data-run="${cmd}" ${JOB?.rodando || !D.persona.ativa ? 'disabled' : ''}>${esc(rot)}</button>`).join('')}</div>` : ''}
    </div>`;
  const addRow = (id, btn, ph) => `<div class="cx-addrow"><input type="text" id="${id}" class="cx-in" placeholder="${esc(ph)}" autocomplete="off"><button type="button" class="reload" id="${btn}">Adicionar</button></div>`;
  function drawSementes() {
    if (!D.persona) return `<div class="empty-state"><b>Crie um creator primeiro</b>No botão “Novo creator”, no topo da página.</div>`;
    const todas = D.sementes || [];
    const refs = D.referencias || [];
    const nSem = todas.filter((s) => s.status === 'confirmada').length;
    const nRef = refs.filter((r) => r.status === 'ativa').length;
    const subs = [
      ['sementes', 'Sementes', nSem, 'Pessoas do público. O grafo sai do que elas seguem.'],
      ['referencias', 'Referências', nRef, `Creators que falam do que ${esc(D.persona.nome)} fala. Dão o assunto.`],
      ['grafo', 'Grafo', D.grafo.length, 'Quem as sementes seguem em comum. Dá o formato.'],
    ];
    if (!subs.some((x) => x[0] === subSem)) subSem = 'sementes';
    const corpo = subSem === 'referencias' ? secaoReferencias() : subSem === 'grafo' ? secaoGrafo() : secaoSementes();
    return `${topo()}
      <div class="cx-subs" role="tablist">${subs.map(([k, t, n, d]) => `<button type="button" role="tab" class="cx-subt" data-sub="${k}" aria-selected="${subSem === k}">
        <span class="cx-subt-t">${t} <b>${n}</b></span><span class="cx-subt-d">${d}</span></button>`).join('')}</div>
      <div class="iabox cx-secbox">${corpo}</div>`;
  }
  function secaoSementes() {
    const todas = D.sementes || [];
    const sug = todas.filter((s) => s.status === 'sugerida');
    const lista = todas.filter((s) => s.status !== 'sugerida');
    return `${cabSec('Sementes', `Perfis reais de quem ${esc(D.persona.nome)} quer atrair. Comece com uns 10; perfil privado não serve.`, [['seguindo', 'Coletar “seguindo”']])}
      ${addRow('cx-sem', 'cx-addsem', '@fulano, @ciclana ou link do perfil (vários de uma vez)')}
      ${sug.length ? `<div class="cx-sugbox"><h3 class="cx-sugt">Sugeridas pelo grafo <span class="motivos">— parecem ser do público e postam pouco; confira o perfil</span></h3>
        <div class="tablewrap"><table class="t"><tbody>${sug.map((s) => `<tr><td><a href="${ig(s.username)}" target="_blank" rel="noopener">@${esc(s.username)}</a></td><td class="motivos">${esc(s.motivo || '')}</td>
          <td style="white-space:nowrap;text-align:right"><button type="button" class="wbtn" data-sem="${s.username}" data-st="confirmada">Confirmar</button> <button type="button" class="wbtn" data-sem="${s.username}" data-st="rejeitada">Rejeitar</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${lista.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Conta</th><th>Status</th><th>Lista coletada</th><th>Quando</th><th></th></tr></thead><tbody>
        ${lista.map((s) => `<tr>
          <td><a href="${ig(s.username)}" target="_blank" rel="noopener">@${esc(s.username)}</a>${s.fullName ? `<div class="motivos">${esc(s.fullName)}</div>` : ''}</td>
          <td><span class="pill ${s.status === 'confirmada' ? 'p-ok' : 'k-fora'}">${s.status}</span>${s.origem === 'grafo' ? ' <span class="motivos">via grafo</span>' : ''}</td>
          <td>${s.contas ? `${s.contas}${s.followingCount ? ` de ${s.followingCount}` : ''}` : '—'}${s.erro ? `<div class="motivos" style="color:var(--t-reel-ink)">${esc(s.erro)}</div>` : ''}</td>
          <td class="motivos">${quando(s.coletadaEm)}</td>
          <td style="white-space:nowrap;text-align:right">${s.status === 'confirmada' ? `${menuConta(s.username, ['seguindo'])} <button type="button" class="wbtn" data-sem="${s.username}" data-st="rejeitada">Desativar</button>` : `<button type="button" class="wbtn" data-sem="${s.username}" data-st="confirmada">Reativar</button>`} <button type="button" class="wbtn" data-sem="${s.username}" data-st="remover">Remover</button></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="motivos">Nenhuma semente ainda.</p>'}`;
  }
  function secaoGrafo() {
    const total = D.funil.comLista;
    const papelSel = (c) => `<select class="fix" data-papel="${c.username}"><option value="">${c.source === 'humano' ? 'voltar para a IA' : `(${c.source === 'llm' ? 'IA' : 'sem avaliação'}) ${PAPEL[c.papel]}`}</option>${['consumido', 'par', 'fora'].map((k) => `<option value="${k}" ${c.source === 'humano' && c.papel === k ? 'selected' : ''}>${PAPEL[k]}</option>`).join('')}</select>`;
    return `${cabSec('Grafo', `Entra quem é seguido por pelo menos <b>${D.minimo}</b> das ${total} sementes com lista. As contas são visitadas e a IA diz se o público consome, se é alguém do público ou nada.`, [['grafo', 'Recalcular grafo'], ['acompanhar', 'Visitar contas'], ['contas', 'Classificar contas']])}
      ${D.grafo.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Conta</th><th>Sementes</th><th>Papel</th><th>Do que fala / por quê</th><th>Seguidores</th><th>Visitada</th><th></th></tr></thead><tbody>
        ${D.grafo.map((c) => `<tr>
          <td><a href="${ig(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a> ${c.papel === 'consumido' ? virarReferencia(c.username) : virarSemente(c.username)}${c.fullName ? `<div class="motivos">${esc(c.fullName)}</div>` : ''}${c.candidataSemente ? '<div><span class="chip">par do público</span></div>' : ''}</td>
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
      <td style="white-space:nowrap;text-align:right">${r.status === 'ativa' ? `${menuConta(r.username, ['visitar', 'transcrever', 'avaliar', 'atualizar'])} <button type="button" class="wbtn" data-ref="${r.username}" data-st="pausada">Pausar</button>` : `<button type="button" class="wbtn" data-ref="${r.username}" data-st="ativa">Ativar</button>`} <button type="button" class="wbtn" data-ref="${r.username}" data-st="remover">Remover</button></td>
    </tr>`;
    return `${cabSec('Referências', 'Gente que posta conteúdo próprio sobre o mesmo assunto. Perfil de empresa não serve (só posta anúncio). São visitadas junto com o grafo.', [['acompanhar', 'Visitar contas']])}
      ${addRow('cx-ref', 'cx-addref', '@fulano_ceo ou link do perfil (vários de uma vez)')}
      ${sug.length ? `<div class="cx-sugbox"><h3 class="cx-sugt">Sugeridas pelo grafo <span class="motivos">— creators que o público segue e falam do mesmo assunto; confira antes de ativar</span></h3><div class="tablewrap"><table class="t"><tbody>${sug.map(linha).join('')}</tbody></table></div></div>` : ''}
      ${lista.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Conta</th><th>Status</th><th>Visita</th><th></th></tr></thead><tbody>${lista.map(linha).join('')}</tbody></table></div>` : '<p class="motivos">Nenhuma referência ainda.</p>'}`;
  }
  function ligarSementes() {
    root.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
      subSem = b.dataset.sub;
      try { localStorage.setItem('cx-sub', subSem); } catch { /* sem storage */ }
      draw();
    }));
    for (const [inp, btn] of [['cx-sem', 'cx-addsem'], ['cx-ref', 'cx-addref']]) {
      document.getElementById(inp)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById(btn)?.click(); } });
    }
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
  .cx-ideias { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 16px; align-items: stretch; }
  /* cards da mesma linha com a mesma altura; as acoes ficam sempre no rodape do card */
  .cx-ideia > .cx-thumb { align-self: start; }
  .cx-ideia > .cx-corpo { display: flex; flex-direction: column; min-width: 0; }
  .cx-ideia > .cx-corpo > .cx-acts { margin-top: auto; padding-top: 6px; }
  .cx-ideia h3 { margin-top: 0; }
  .cx-meta-min { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 13px; color: var(--muted); margin-bottom: 10px; }
  .cx-meta-min i { font-style: normal; opacity: .6; }
  .cx-reflink { color: inherit; text-decoration: none; border-radius: 4px; }
  .cx-reflink:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

  /* hover: botoes, links e cards respondem ao mouse */
  .btn-pri, .reload, .wbtn, .cx-lnk, .icon-btn, .cx-seg button, .cx-ideia, .cx-radar, .cx-thumb { transition: background-color .15s, border-color .15s, color .15s, box-shadow .15s, transform .15s, filter .15s; }
  .btn-pri:hover:not(:disabled) { filter: brightness(1.12); box-shadow: 0 4px 14px -6px var(--accent); }
  .btn-pri:active:not(:disabled) { transform: translateY(1px); }
  .reload:hover:not(:disabled) { background: var(--accent-soft); }
  .wbtn:hover:not(:disabled) { background: var(--accent-soft); }
  .cx-lnk:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
  .icon-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .cx-seg button:hover:not(.on) { color: var(--ink); background: var(--surface-2); }
  .btn-pri:disabled, .reload:disabled, .wbtn:disabled, .cx-lnk:disabled { cursor: not-allowed; }
  .cx-ideia[data-ideia]:hover, .cx-radar[data-ideia]:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); transform: translateY(-1px); }
  /* capa do post: leva ao Instagram; no hover aparece o aviso */
  a.cx-thumb { position: relative; }
  .cx-play { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: rgba(10,12,24,.6); color: #fff; }
  .cx-abrir { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: rgba(10,12,24,.55); color: #fff; font-style: normal; font-size: 11.5px; font-weight: 600; text-align: center; line-height: 1.2; padding: 6px; opacity: 0; transition: opacity .15s; }
  a.cx-thumb:hover .cx-abrir, a.cx-thumb:focus-visible .cx-abrir { opacity: 1; }
  a.cx-thumb:hover img { transform: scale(1.04); }
  .cx-thumb img { transition: transform .2s; }
  .cx-dsec a:hover, .cx-igcab a:hover { color: var(--accent); }
  .cx-ideia { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
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
  .cx-radares { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 14px; align-items: stretch; }
  /* rodape do card do radar: campo e botoes sempre embaixo, alinhados entre os cards */
  .cx-radar-pe { margin-top: auto; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding-top: 4px; }
  .cx-radar-pe .cx-in { width: 100%; }
  .cx-radar-pe .cx-acts { margin-top: 0; }
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
  #cx-novo { border: 0; padding: 0; border-radius: 18px; background: var(--surface); color: var(--ink); width: min(440px, calc(100vw - 32px)); box-shadow: 0 30px 90px -24px rgba(0,0,0,.5); }
  #cx-novo::backdrop { background: var(--scrim); }
  .cx-nform { padding: 24px 26px; display: flex; flex-direction: column; gap: 10px; }
  .cx-nform .h2 { margin: 0; }
  .cx-nform .cx-in { width: 100%; box-sizing: border-box; margin-top: 4px; font-weight: 400; }
  .cx-nform .cx-rta { margin-top: 4px; font-weight: 400; }
  .cx-split { display: inline-flex; align-items: stretch; }
  .cx-split-pri { display: inline-flex; align-items: center; gap: 8px; border-radius: 10px 0 0 10px; height: 38px; }
  .cx-split-mais { position: relative; }
  .cx-split-mais > summary { list-style: none; height: 38px; width: 34px; padding: 0; display: grid; place-items: center; border-radius: 0 10px 10px 0; border-left: 1px solid rgba(255,255,255,.25); cursor: pointer; box-sizing: border-box; }
  .cx-split-mais > summary::-webkit-details-marker { display: none; }
  .cx-split-mais .cx-conta-l { min-width: 250px; }
  .cx-split-mais .cx-conta-l button:disabled { opacity: .5; cursor: not-allowed; }
  .cx-ponto { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulsar 1.2s ease-in-out infinite; }
  @keyframes pulsar { 50% { opacity: .35; } }
  #cx-status[role=button] { cursor: pointer; }
  #cx-status[role=button]:hover { border-color: var(--accent); }
  #cx-logbox { position: fixed; right: 20px; bottom: 20px; z-index: 80; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 48px -18px rgba(0,0,0,.45); display: flex; color: var(--ink); max-width: calc(100vw - 32px); }
  #cx-logbox.min { align-items: center; gap: 2px; padding: 4px; border-radius: 999px; }
  #cx-logbox.aberto { width: 380px; flex-direction: column; overflow: hidden; }
  #cx-logbox .ponto { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  #cx-logbox .ponto.rodando { background: var(--accent); animation: pulsar 1.2s ease-in-out infinite; }
  #cx-logbox .ponto.ok { background: #2E9E6A; }
  #cx-logbox .ponto.erro { background: var(--t-reel-ink, #c33); }
  .cx-lbpill { display: flex; align-items: center; gap: 8px; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13.5px; padding: 6px 10px 6px 12px; border-radius: 999px; cursor: pointer; max-width: 340px; }
  .cx-lbpill b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-lbpill .motivos { white-space: nowrap; font-size: 12.5px; }
  .cx-lbpill:hover { background: var(--surface-2); }
  .cx-lbx { width: 28px; height: 28px; flex: 0 0 28px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
  .cx-lbx:hover { background: var(--surface-2); color: var(--ink); }
  .cx-lbstop:hover { color: var(--t-reel-ink, #c33); background: color-mix(in srgb, var(--t-reel-ink, #c33) 12%, transparent); }
  #cx-logbox.aberto header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--line); }
  #cx-logbox.aberto header > div { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
  #cx-logbox.aberto header b { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #cx-logbox.aberto header .motivos { font-size: 12px; }
  /* expandido: vira uma janela centralizada, com fundo escurecido */
  #cx-logbox.aberto.grande { width: min(980px, calc(100vw - 40px)); right: auto; bottom: auto; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 90; box-shadow: 0 0 0 100vmax var(--scrim), 0 30px 90px -24px rgba(0,0,0,.5); }
  #cx-logbox.grande pre { height: min(70vh, 720px); font-size: 12.5px; }
  #cx-logbox pre { margin: 0; height: 220px; overflow: auto; padding: 10px 14px; font: 11.5px/1.55 var(--mono); white-space: pre-wrap; background: var(--surface-2); color: var(--ink); }
  @media (max-width: 560px) { #cx-logbox { right: 12px; bottom: 12px; } #cx-logbox.aberto { width: calc(100vw - 24px); } }
  /* aba Creator */
  .iabox textarea.cx-ed { min-height: 0; font: 14.5px/1.55 var(--body); resize: none; width: 100%; box-sizing: border-box; color: var(--ink); border-radius: 10px; }
  .cx-perfil { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; margin-bottom: 16px; }
  .cx-av-g { width: 52px; height: 52px; flex-basis: 52px; font-size: 22px; }
  .cx-perfil-campos { display: flex; flex-direction: column; gap: 4px; min-width: 220px; flex: 1; }
  .cx-perfil-campos .cx-in { border-color: transparent; background: transparent; padding: 0 6px; height: 30px; }
  .cx-perfil-campos .cx-in:hover { border-color: var(--line); }
  .cx-perfil-campos .cx-in:focus { border-color: var(--accent); background: var(--surface); outline: none; }
  .cx-in-nome { font-size: 20px !important; font-weight: 700; }
  .cx-perfil-status { display: flex; gap: 8px; flex-wrap: wrap; }
  .cx-pst { font-size: 12.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); }
  .cx-pst.ok { background: color-mix(in srgb, #2E9E6A 14%, transparent); color: #2E9E6A; border-color: transparent; }
  .cx-secab { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cx-secab .h2 { margin: 0; }
  .cx-prog { height: 4px; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin-bottom: 8px; }
  .cx-prog span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
  .cx-perg { list-style: none; counter-reset: perg; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .cx-perg li { counter-increment: perg; display: grid; grid-template-columns: 32px minmax(0, 1fr); column-gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
  .cx-perg li:first-child { border-top: 0; }
  .cx-perg li::before { content: counter(perg); grid-row: 1 / span 2; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); }
  .cx-perg li.feita::before { background: var(--accent); color: #fff; border-color: transparent; }
  .cx-perg-cab { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .cx-perg-tit { font-weight: 600; font-size: 15px; }
  .cx-obr { font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 1px 8px; }
  .cx-perg-r { font-size: 14.5px !important; background: var(--surface-2); border: 1px solid var(--line) !important; padding: 8px 10px !important; }
  .cx-perg-r:focus { border-color: var(--accent) !important; background: var(--surface); }
  .cx-ent-acts { position: sticky; bottom: 0; background: var(--surface); padding: 12px 0 2px; border-top: 1px solid var(--line); margin-top: 6px; }
  .cx-tgrid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 14px 22px; }
  .cx-subs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 4px 0 14px; }
  .cx-subt { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; font: inherit; transition: border-color .15s, background .15s; }
  .cx-subt:hover { border-color: var(--accent); }
  .cx-subt[aria-selected="true"] { border-color: var(--accent); background: var(--accent-soft, var(--surface-2)); box-shadow: inset 0 0 0 1px var(--accent); }
  .cx-subt-t { font-weight: 700; font-size: 15px; }
  .cx-subt-t b { font-weight: 600; color: var(--muted); margin-left: 4px; }
  .cx-subt-d { font-size: 12.5px; color: var(--muted); line-height: 1.35; }
  .cx-sechd { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; margin-bottom: 12px; }
  .cx-sechd .h2 { margin: 0 0 2px; }
  .cx-sechd > div:first-child { flex: 1 1 380px; }
  .cx-sechd p { margin: 0; max-width: 620px; }
  .cx-sechd-acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .cx-addrow { display: flex; gap: 8px; margin-bottom: 14px; }
  .cx-addrow .cx-in { flex: 1; min-width: 0; }
  .cx-sugbox { border: 1px dashed var(--line); border-radius: 12px; padding: 10px 12px 4px; margin-bottom: 14px; }
  .cx-sugt { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: var(--ink); }
  @media (max-width: 720px) { .cx-subs { grid-template-columns: 1fr; } .cx-subt-d { display: none; } }
  .cx-tcol { display: flex; flex-direction: column; gap: 2px; }
  .cx-tcampo { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .cx-tcampo > span { font-size: 13px; font-weight: 600; color: var(--muted); }
  .cx-tcampo .cx-ed { background: var(--surface-2); border: 1px solid var(--line); padding: 8px 10px; }
  .cx-tsec { margin-bottom: 16px; }
  .cx-tsec-cab { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .cx-tsec-cab h3 { font-size: 14px; margin: 0; }
  .cx-lista { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
  .cx-item { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 28px; gap: 6px; align-items: center; }
  .cx-lista[data-simples="1"] .cx-item { grid-template-columns: minmax(0, 1fr) 28px; }
  .cx-item .cx-in { height: 34px; }
  .cx-fmtchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .cx-fchip { border: 1px solid var(--line); background: var(--surface); color: var(--muted); font: inherit; font-size: 13.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
  .cx-fchip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .cx-fchip[aria-pressed="true"]::before { content: '✓ '; }
  @media (max-width: 560px) { .cx-item { grid-template-columns: minmax(0, 1fr) 28px; } .cx-item .ed-det { grid-column: 1 / 2; } }
  .cx-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 42px; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); cursor: text; }
  .cx-tags:focus-within { border-color: var(--accent); background: var(--surface); }
  .cx-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 13.5px; font-weight: 600; }
  .cx-tag button { border: 0; background: transparent; color: inherit; font-size: 16px; line-height: 1; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; }
  .cx-tag button:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .cx-tag-in { flex: 1; min-width: 160px; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 14.5px; outline: none; padding: 4px; }
  .cx-secab-l { flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .cx-secab-l > div { display: flex; flex-direction: column; gap: 4px; }
  .cx-tl-rot { display: block; font-size: 12px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .cx-tl-topo { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px 28px; padding: 14px 16px; border-radius: 12px; background: var(--surface-2); margin-bottom: 18px; }
  .cx-tl-topo p { margin: 0; font-size: 15px; line-height: 1.55; }
  .cx-tl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 18px 28px; }
  .cx-tl h3 { font-size: 14px; margin: 0 0 8px; }
  .cx-tl-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .cx-tl-lista li { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
  .cx-tl-lista b { display: block; font-size: 14.5px; }
  .cx-tl-lista span { display: block; font-size: 13.5px; color: var(--muted); line-height: 1.5; margin-top: 2px; }
  .cx-tl-op { margin: 0 0 8px; padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 10px 10px 0; font-size: 14.5px; }
  .cx-tl-hist { margin: 0; padding-left: 18px; font-size: 14.5px; line-height: 1.6; }
  .cx-tl-rodape { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 14px 28px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
  .cx-tl-rodape p { margin: 0; font-size: 14.5px; }
  .cx-tcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 10px; margin-bottom: 6px; }
  .cx-tcard { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 10px 36px 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .cx-tcard:focus-within { border-color: var(--accent); }
  .cx-tcard-x { position: absolute; top: 6px; right: 6px; }
  .cx-tcard-t { border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 15px; font-weight: 700; padding: 2px 0; outline: none; }
  .iabox textarea.cx-tcard-d { border: 0; background: transparent; padding: 2px 0; font-size: 14px; color: var(--muted); outline: none; }
  .cx-tcard-s .cx-tcard-d { color: var(--ink) !important; font-size: 14.5px !important; }
  .cx-conta { position: relative; }
  .cx-conta > summary { list-style: none; display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 6px 12px 6px 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
  .cx-conta > summary::-webkit-details-marker { display: none; }
  .cx-conta > summary:hover { box-shadow: var(--shadow, 0 6px 18px -10px rgba(0,0,0,.3)); }
  .cx-av { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; font-weight: 700; font-size: 14px; }
  .cx-av.cx-mais { background: var(--surface-2); color: var(--accent); border: 1px dashed var(--accent); }
  .cx-cnome { display: flex; flex-direction: column; line-height: 1.2; text-align: left; min-width: 0; }
  .cx-cnome b { font-size: 14px; }
  .cx-cnome small { font-size: 12px; color: var(--muted); }
  .cx-conta-l { position: absolute; right: 0; top: calc(100% + 6px); z-index: 70; min-width: 240px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow, 0 18px 40px -16px rgba(0,0,0,.4)); padding: 6px; display: flex; flex-direction: column; }
  .cx-conta-l button { display: flex; align-items: center; gap: 10px; border: 0; background: transparent; color: var(--ink); font: inherit; padding: 8px; border-radius: 10px; cursor: pointer; text-align: left; }
  .cx-conta-l button:hover, .cx-conta-l button.on { background: var(--surface-2); }
  .cx-conta-l .cx-ok { margin-left: auto; color: var(--accent); font-weight: 700; }
  .cx-conta-l hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; width: auto; }
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
