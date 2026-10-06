/* =====================================================================
   Painel de Emissão — lógica da interface
   ===================================================================== */
(function () {
  'use strict';

  const U = window.USP;
  const $ = id => document.getElementById(id);

  /* ---------- Armazenamento local (apenas no navegador do administrador) ---------- */
  const K = { historico: 'usp_historico', api: 'usp_api_key', cpfModo: 'usp_cpf_modo', pendente: 'usp_config_pendente' };
  const LS = {
    get(k, padrao) {
      try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } }
  };

  let cfg = U.configAtiva();
  let chavePrivada = null;
  let fingerprint = '';
  let historico = LS.get(K.historico, []);
  let lote = [];
  let validadeAutomatica = true;
  let seqPrevia = 0;
  let timerPrevia = null;
  let ultimoUso = Date.now();
  const BLOQUEIO_MIN = 15;

  const form = {
    id: U.gerarId(),
    foto: null,
    token: '',
    url: '',
    dados: null,
    emitida: false
  };

  /* ---------- Utilidades de interface ---------- */
  let timerToast = null;
  function toast(texto) {
    const t = $('toast');
    t.textContent = texto;
    t.classList.add('visivel');
    clearTimeout(timerToast);
    timerToast = setTimeout(() => t.classList.remove('visivel'), 3200);
  }
  function msg(id, texto, tipo) {
    const el = $(id);
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' ' + tipo : '');
  }
  function baixar(nome, conteudo, tipo) {
    const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function baixarCanvas(canvas, nome) {
    canvas.toBlob(b => baixar(nome, b), 'image/png');
  }
  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      toast('Link copiado para a área de transferência');
    } catch (e) {
      prompt('Copie o link:', texto);
    }
  }
  function slug(s) {
    return U.semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'aluno';
  }
  const PREPOSICOES = ['de', 'da', 'do', 'das', 'dos', 'e'];
  function nomeProprio(s) {
    const limpo = String(s || '').replace(/\s+/g, ' ').trim();
    if (!limpo || limpo !== limpo.toUpperCase()) return limpo; // só corrige nomes TODO EM MAIÚSCULAS
    return limpo.toLowerCase().split(' ').map((p, i) =>
      i > 0 && PREPOSICOES.includes(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }
  function dataParaISO(s) {
    const t = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
  }
  function expandirUnidade(u) {
    const alvo = U.semAcento(u);
    if (!alvo) return '';
    const achada = U.UNIDADES.find(x => {
      const sigla = (x.nome.match(/\(([^)]+)\)\s*$/) || [])[1];
      return U.semAcento(x.nome) === alvo || (sigla && U.semAcento(sigla) === alvo);
    });
    return achada ? achada.nome : String(u).trim();
  }
  function textoConfig(c) {
    const publico = {
      instituicao: c.instituicao || 'Universidade de São Paulo',
      modoDemonstracao: c.modoDemonstracao !== false,
      chavePublica: c.chavePublica,
      chavePrivadaCifrada: c.chavePrivadaCifrada
    };
    return '/* =====================================================================\n' +
      '   Configuração pública do sistema — gerada pelo Painel de Emissão em ' + U.dataBR(U.hojeISO()) + '.\n' +
      '   A chave privada está CIFRADA com a senha mestra (AES-256-GCM + PBKDF2).\n' +
      '   modoDemonstracao: mude para false quando o sistema for adotado oficialmente.\n' +
      '   ===================================================================== */\n' +
      'window.USP_CONFIG = ' + JSON.stringify(publico, null, 2) + ';\n';
  }

  /* ---------- Telas ---------- */
  function mostrar(tela) {
    ['setup', 'login', 'app'].forEach(t => { $('tela-' + t).hidden = t !== tela; });
    $('topo-acoes').hidden = tela !== 'app';
    if (tela === 'login') setTimeout(() => $('login-senha').focus(), 50);
  }

  function forcaSenha(s) {
    let p = 0;
    if (s.length >= 10) p++;
    if (s.length >= 14) p++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
    if (/\d/.test(s)) p++;
    if (/[^A-Za-z0-9]/.test(s) || /\s/.test(s)) p++;
    return Math.min(p, 4);
  }

  function iniciarSetup() {
    let config = null, senhaCriada = '';
    $('setup-senha').addEventListener('input', e => {
      const f = forcaSenha(e.target.value);
      const cores = ['var(--erro)', 'var(--erro)', 'var(--alerta)', 'var(--usp-azul)', 'var(--ok)'];
      const textos = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Excelente'];
      $('medidor-barra').style.width = (f + 1) * 20 + '%';
      $('medidor-barra').style.background = cores[f];
      $('medidor-texto').textContent = e.target.value.length < 10 ? 'Mínimo de 10 caracteres.' : 'Força: ' + textos[f];
    });

    $('form-setup').addEventListener('submit', async e => {
      e.preventDefault();
      const s1 = $('setup-senha').value, s2 = $('setup-confirma').value;
      if (s1.length < 10) return msg('setup-msg', 'A senha precisa ter pelo menos 10 caracteres.', 'erro');
      if (s1 !== s2) return msg('setup-msg', 'As senhas não conferem.', 'erro');
      const btn = $('btn-setup');
      btn.disabled = true;
      btn.textContent = 'Gerando chaves…';
      try {
        const chaves = await U.criarChaves(s1);
        config = Object.assign({}, window.USP_CONFIG || {}, chaves);
        LS.set(K.pendente, chaves);
        senhaCriada = s1;
        $('form-setup').hidden = true;
        $('setup-resultado').hidden = false;
      } catch (err) {
        console.error(err);
        msg('setup-msg', 'Não foi possível gerar as chaves neste navegador.', 'erro');
        btn.disabled = false;
        btn.textContent = 'Criar chaves da Universidade';
      }
    });

    $('btn-baixar-config-setup').addEventListener('click', () => baixar('config.js', textoConfig(config), 'text/javascript;charset=utf-8'));
    $('btn-copiar-config-setup').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(textoConfig(config)); toast('Conteúdo do config.js copiado'); } catch (e) { toast('Não foi possível copiar — use o botão de baixar'); }
    });
    $('btn-ir-painel').addEventListener('click', async () => {
      cfg = U.configAtiva();
      chavePrivada = await U.abrirCofre(senhaCriada, cfg.chavePrivadaCifrada);
      senhaCriada = '';
      entrarNoApp();
    });
  }

  function iniciarLogin() {
    $('login-aviso-local').hidden = !cfg.origemLocal;
    $('form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('btn-login');
      btn.disabled = true;
      btn.textContent = 'Verificando…';
      msg('login-msg', '');
      try {
        chavePrivada = await U.abrirCofre($('login-senha').value, cfg.chavePrivadaCifrada);
        $('login-senha').value = '';
        entrarNoApp();
      } catch (err) {
        msg('login-msg', err.message === 'SENHA' ? 'Senha incorreta.' : 'Não foi possível abrir a chave.', 'erro');
        $('login-senha').select();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });
  }

  async function entrarNoApp() {
    fingerprint = await U.impressaoDigital(cfg.chavePublica);
    $('chip-chave').textContent = 'Chave ' + fingerprint.slice(0, 9);
    $('aj-fingerprint').textContent = fingerprint;
    $('aj-origem').textContent = cfg.origemLocal ? 'Somente neste navegador (publique o config.js)' : 'Repositório (config.js publicado)';
    ultimoUso = Date.now();
    mostrar('app');
    atualizarPrevia(true);
    renderizarHistorico();
  }

  function bloquear(motivo) {
    chavePrivada = null;
    mostrar('login');
    if (motivo) msg('login-msg', motivo);
  }

  /* ---------- Abas ---------- */
  function iniciarAbas() {
    document.querySelectorAll('.abas [data-aba]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.abas [data-aba]').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
        document.querySelectorAll('.aba').forEach(p => { p.hidden = p.id !== 'aba-' + btn.dataset.aba; });
        if (btn.dataset.aba === 'historico') renderizarHistorico();
      });
    });
  }

  /* ---------- QR code ---------- */
  function criarQR(texto) {
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr;
  }

  function desenharQRNoCanvas(ctx, qr, x, y, tamanho) {
    const n = qr.getModuleCount();
    const celula = Math.floor(tamanho / n);
    const desloc = Math.floor((tamanho - celula * n) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, tamanho, tamanho);
    ctx.fillStyle = '#0c1d33';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(x + desloc + c * celula, y + desloc + r * celula, celula, celula);
      }
    }
  }

  function qrPNG(url) {
    const qr = criarQR(url);
    const n = qr.getModuleCount();
    const cel = 16, margem = 4 * cel;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n * cel + margem * 2;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    desenharQRNoCanvas(ctx, qr, margem, margem, n * cel);
    return cv;
  }

  /* ---------- Carteirinha em alta resolução (canvas) ---------- */
  const LOGO = typeof Path2D !== 'undefined'
    ? new Path2D('M9 8 V35 Q9 51 24 51 Q38 51 38 35 V8 M76 12 H55 Q46 12 46 21 Q46 30 55 30 H65 Q74 30 74 40 Q74 50 64 50 H44 M86 52 V10 H107 Q122 10 122 23 Q122 36 107 36 H86')
    : null;

  function retArredondado(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function quebrarTexto(ctx, texto, largura, maxLinhas) {
    const palavras = String(texto || '').split(/\s+/).filter(Boolean);
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      const teste = atual ? atual + ' ' + p : p;
      if (ctx.measureText(teste).width <= largura || !atual) { atual = teste; } else { linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    if (linhas.length > maxLinhas) {
      const corte = linhas.slice(0, maxLinhas);
      let ultima = corte[maxLinhas - 1];
      while (ctx.measureText(ultima + '…').width > largura && ultima.length > 1) ultima = ultima.slice(0, -1);
      corte[maxLinhas - 1] = ultima.trimEnd() + '…';
      return corte;
    }
    return linhas;
  }

  async function gerarCartao(d, url, foto) {
    try { await document.fonts.ready; } catch (e) { /* segue com fonte do sistema */ }
    const S = 1.5, W = 1012, H = 638;
    const cv = document.createElement('canvas');
    cv.width = W * S;
    cv.height = H * S;
    const x = cv.getContext('2d');
    x.scale(S, S);
    const F = 'Roboto, "Segoe UI", Arial, sans-serif';
    const FC = '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';
    const FM = '"Roboto Mono", Consolas, monospace';

    x.save();
    retArredondado(x, 0, 0, W, H, 40);
    x.clip();
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);

    // faixa superior
    x.fillStyle = '#142c4c';
    x.fillRect(0, 0, W, 140);
    x.save();
    x.globalAlpha = 0.09;
    x.strokeStyle = '#64c4d2';
    x.lineWidth = 16;
    [110, 170, 230, 290].forEach(r => { x.beginPath(); x.arc(W - 40, -30, r, 0, Math.PI * 2); x.stroke(); });
    x.restore();

    if (LOGO) {
      x.save();
      x.translate(42, 36);
      x.scale(1.18, 1.18);
      x.lineJoin = 'round';
      x.lineCap = 'square';
      x.strokeStyle = '#ffffff';
      x.lineWidth = 13;
      x.stroke(LOGO);
      x.lineCap = 'butt';
      x.strokeStyle = '#142c4c';
      x.lineWidth = 5;
      x.stroke(LOGO);
      x.restore();
    }
    x.fillStyle = '#ffffff';
    x.font = '700 36px ' + F;
    x.fillText('Universidade de São Paulo', 220, 74);
    x.fillStyle = '#fcb421';
    x.font = '700 21px ' + FC;
    if ('letterSpacing' in x) x.letterSpacing = '4px';
    x.fillText('CARTEIRA DE ESTUDANTE', 220, 108);
    if ('letterSpacing' in x) x.letterSpacing = '0px';

    // listras
    const terco = W / 3;
    x.fillStyle = '#fcb421'; x.fillRect(0, 140, terco, 10);
    x.fillStyle = '#64c4d2'; x.fillRect(terco, 140, terco, 10);
    x.fillStyle = '#1094ab'; x.fillRect(terco * 2, 140, terco + 1, 10);

    // foto ou iniciais
    const fx = 44, fy = 184, fw = 200, fh = 266;
    x.save();
    retArredondado(x, fx, fy, fw, fh, 20);
    x.clip();
    if (foto) {
      const esc = Math.max(fw / foto.naturalWidth, fh / foto.naturalHeight);
      const lw = foto.naturalWidth * esc, lh = foto.naturalHeight * esc;
      x.drawImage(foto, fx + (fw - lw) / 2, fy + (fh - lh) / 2, lw, lh);
    } else {
      const g = x.createLinearGradient(fx, fy, fx + fw, fy + fh);
      g.addColorStop(0, '#142c4c');
      g.addColorStop(1, '#1094ab');
      x.fillStyle = g;
      x.fillRect(fx, fy, fw, fh);
      x.fillStyle = '#ffffff';
      x.font = '700 78px ' + FC;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(U.iniciais(d.nome), fx + fw / 2, fy + fh / 2);
      x.textAlign = 'left';
      x.textBaseline = 'alphabetic';
    }
    x.restore();

    // dados
    const tx = 272, tw = 436;
    const rotulo = (t, px, py) => {
      x.fillStyle = '#6b7a8c';
      x.font = '700 15px ' + FC;
      if ('letterSpacing' in x) x.letterSpacing = '2px';
      x.fillText(t, px, py);
      if ('letterSpacing' in x) x.letterSpacing = '0px';
    };
    let y = 200;
    rotulo('NOME', tx, y);
    x.fillStyle = '#142c4c';
    x.font = '700 33px ' + F;
    quebrarTexto(x, d.nome, tw, 2).forEach(l => { y += 38; x.fillText(l, tx, y); });
    y += 34;
    rotulo('CURSO', tx, y);
    x.fillStyle = '#142c4c';
    x.font = '600 27px ' + F;
    quebrarTexto(x, d.curso, tw, 2).forEach(l => { y += 32; x.fillText(l, tx, y); });
    x.fillStyle = '#4b5a6b';
    x.font = '400 18px ' + F;
    quebrarTexto(x, d.unidade, tw, 2).forEach(l => { y += 24; x.fillText(l, tx, Math.min(y, 452)); });

    const by = 486;
    rotulo('Nº USP', tx, by);
    rotulo('VALIDADE', tx + 168, by);
    rotulo('PERÍODO', tx + 330, by);
    x.fillStyle = '#142c4c';
    x.font = '600 24px ' + FM;
    x.fillText(String(d.ra || '—'), tx, by + 32);
    x.fillText(U.dataBR(d.validade), tx + 168, by + 32);
    x.fillText(String(d.periodo || '—'), tx + 330, by + 32);

    // QR code
    const qs = 236, qx = W - 44 - qs, qy = 184;
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    desenharQRNoCanvas(x, criarQR(url), Math.round(qx * S), Math.round(qy * S), Math.round(qs * S));
    x.restore();
    x.fillStyle = '#6b7a8c';
    x.font = '500 16px ' + F;
    x.textAlign = 'center';
    x.fillText('Escaneie para validar', qx + qs / 2, qy + qs + 30);
    x.textAlign = 'left';

    // rodapé
    x.fillStyle = '#eef3f7';
    x.fillRect(0, H - 56, W, 56);
    x.fillStyle = '#4b5a6b';
    x.font = '500 16px ' + FM;
    x.fillText('DOC. ' + d.id + '  ·  EMITIDA ' + U.dataBR(d.emitido) + '  ·  ASSINATURA DIGITAL ECDSA P-256', 44, H - 22);
    x.restore();
    return cv;
  }

  /* ---------- Formulário de emissão ---------- */
  const CAMPOS_FORM = ['nome', 'cpf', 'ra', 'nascimento', 'curso', 'unidade', 'campus', 'nivel', 'turno',
    'semestre', 'periodo', 'ingresso', 'conclusao', 'validade'];
  const campo = n => $('f-' + n);

  function cpfModo() { return LS.get(K.cpfModo, 'mascarado'); }

  function lerFormulario() {
    const v = n => campo(n).value.trim();
    const cpf = U.soDigitos(v('cpf'));
    return {
      id: form.id,
      nome: v('nome').replace(/\s+/g, ' '),
      cpf: cpfModo() === 'completo' ? cpf : U.mascararCPF(cpf),
      ra: v('ra'),
      curso: v('curso'),
      unidade: v('unidade'),
      campus: v('campus'),
      nivel: v('nivel'),
      turno: v('turno'),
      semestre: v('semestre'),
      periodo: v('periodo'),
      ingresso: v('ingresso'),
      conclusao: v('conclusao'),
      nascimento: v('nascimento'),
      emitido: U.hojeISO(),
      validade: v('validade')
    };
  }

  function validarAluno(d, cpfDigitos) {
    const faltando = [];
    if (!d.nome || d.nome.split(' ').length < 2) faltando.push('nome completo');
    if (!U.validarCPF(cpfDigitos)) faltando.push('CPF válido');
    if (!d.ra) faltando.push('Nº USP');
    if (!d.curso) faltando.push('curso');
    if (!d.unidade) faltando.push('unidade');
    if (!d.semestre) faltando.push('semestre');
    if (!/^\d{4}\/[12]$/.test(d.periodo || '')) faltando.push('período (AAAA/1 ou AAAA/2)');
    if (!d.validade) faltando.push('validade');
    return faltando;
  }

  function definirPadroes() {
    campo('periodo').value = U.periodoAtual();
    campo('validade').value = U.validadePadrao(campo('periodo').value);
    validadeAutomatica = true;
    campo('nivel').value = 'Graduação';
    campo('turno').value = 'Integral';
  }

  function preencherFormulario(a) {
    const set = (n, v) => { if (v != null && String(v).trim() !== '') campo(n).value = String(v).trim(); };
    set('nome', nomeProprio(a.nome));
    if (a.cpf) campo('cpf').value = U.formatarCPF(a.cpf);
    set('ra', U.soDigitos(a.ra) || a.ra);
    set('nascimento', dataParaISO(a.nascimento));
    set('curso', a.curso);
    set('unidade', expandirUnidade(a.unidade));
    set('campus', a.campus || U.campusDaUnidade(expandirUnidade(a.unidade)));
    if (['Graduação', 'Mestrado', 'Doutorado', 'Especialização', 'Residência'].includes(a.nivel)) campo('nivel').value = a.nivel;
    if (['Integral', 'Matutino', 'Vespertino', 'Noturno'].includes(a.turno)) campo('turno').value = a.turno;
    set('semestre', U.soDigitos(a.semestre));
    if (/^\d{4}\/[12]$/.test(a.periodo || '')) {
      campo('periodo').value = a.periodo;
      if (validadeAutomatica) campo('validade').value = U.validadePadrao(a.periodo);
    }
    set('ingresso', U.soDigitos(a.ingresso));
    set('conclusao', U.soDigitos(a.conclusao));
    aoMudarCPF();
    aoMudarNascimento();
    agendarPrevia();
  }

  function aoMudarCPF() {
    const el = campo('cpf');
    const dig = U.soDigitos(el.value);
    el.value = U.formatarCPF(dig);
    const box = $('campo-cpf');
    box.classList.remove('erro', 'ok');
    if (dig.length === 11) {
      const ok = U.validarCPF(dig);
      box.classList.add(ok ? 'ok' : 'erro');
      $('dica-cpf').textContent = ok
        ? (cpfModo() === 'completo' ? 'CPF válido ✓' : 'CPF válido ✓ · no QR: ' + U.mascararCPF(dig))
        : 'CPF inválido — confira os dígitos';
    } else {
      $('dica-cpf').textContent = '';
    }
  }
  function aoMudarNascimento() {
    const anos = U.idade(campo('nascimento').value);
    $('dica-idade').textContent = anos != null ? anos + ' anos' : '';
  }

  function marcarComoRascunho() {
    if (!form.emitida) return;
    form.emitida = false;
    form.id = U.gerarId();
    $('previa-status').textContent = 'Prévia ao vivo';
    $('previa-status').className = 'etiqueta';
    ['btn-png', 'btn-qr-png', 'btn-abrir', 'btn-copiar'].forEach(id => { $(id).disabled = true; });
  }

  function agendarPrevia() {
    clearTimeout(timerPrevia);
    timerPrevia = setTimeout(() => atualizarPrevia(), 220);
  }

  async function atualizarPrevia() {
    const d = lerFormulario();
    $('ce-nome').textContent = d.nome || 'Nome do estudante';
    $('ce-curso').textContent = d.curso || '—';
    $('ce-unidade').textContent = d.unidade;
    $('ce-ra').textContent = d.ra || '—';
    $('ce-validade').textContent = d.validade ? U.dataBR(d.validade) : '—';
    $('ce-base').textContent = 'DOC. ' + d.id + ' · ASSINATURA DIGITAL ECDSA';
    const fotoBox = $('ce-foto');
    if (form.foto) {
      if (!fotoBox.querySelector('img')) { fotoBox.textContent = ''; fotoBox.append(form.foto.cloneNode()); }
    } else {
      fotoBox.innerHTML = '<span>' + U.esc(U.iniciais(d.nome)) + '</span>';
    }
    if (!chavePrivada) return;
    const seq = ++seqPrevia;
    const token = await U.assinar(chavePrivada, d);
    if (seq !== seqPrevia) return;
    form.token = token;
    form.url = U.urlDoAluno(token);
    form.dados = d;
    const qr = criarQR(form.url);
    $('ce-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    $('previa-tamanho').textContent = 'QR ' + qr.getModuleCount() + '×' + qr.getModuleCount() + ' · ' + form.url.length + ' caracteres';
  }

  function limparFormulario() {
    $('form-aluno').reset();
    form.foto = null;
    form.emitida = true; // força a troca de ID
    marcarComoRascunho();
    definirPadroes();
    $('dica-cpf').textContent = '';
    $('dica-idade').textContent = '';
    $('campo-cpf').classList.remove('erro', 'ok');
    msg('form-msg', '');
    atualizarPrevia();
    campo('nome').focus();
  }

  function salvarHistorico() {
    if (!LS.set(K.historico, historico)) toast('Atenção: não foi possível salvar o histórico neste navegador');
    $('cont-historico').textContent = historico.length;
  }

  function registrar(dados, url) {
    historico = historico.filter(h => h.id !== dados.id);
    historico.unshift({ id: dados.id, dados, url, emitidoEm: new Date().toISOString(), revogado: false });
    salvarHistorico();
  }

  function iniciarFormulario() {
    definirPadroes();
    const dlU = $('lista-unidades'), dlC = $('lista-campi');
    U.UNIDADES.forEach(u => { const o = document.createElement('option'); o.value = u.nome; dlU.append(o); });
    Object.values(U.CAMPI).forEach(c => { const o = document.createElement('option'); o.value = c; dlC.append(o); });

    const f = $('form-aluno');
    f.addEventListener('input', e => {
      if (e.target.id === 'f-cpf') aoMudarCPF();
      if (e.target.id === 'f-nascimento') aoMudarNascimento();
      if (e.target.id === 'f-validade') validadeAutomatica = false;
      if (e.target.id === 'f-periodo' && validadeAutomatica) {
        const v = U.validadePadrao(e.target.value);
        if (v) campo('validade').value = v;
      }
      if (e.target.id !== 'f-foto') { marcarComoRascunho(); agendarPrevia(); }
    });
    campo('unidade').addEventListener('change', () => {
      const completa = expandirUnidade(campo('unidade').value);
      campo('unidade').value = completa;
      const c = U.campusDaUnidade(completa);
      if (c) campo('campus').value = c;
      marcarComoRascunho();
      agendarPrevia();
    });
    campo('nome').addEventListener('blur', () => { campo('nome').value = nomeProprio(campo('nome').value); });
    campo('foto').addEventListener('change', e => {
      const arq = e.target.files[0];
      if (!arq) return;
      const img = new Image();
      img.onload = () => { form.foto = img; $('ce-foto').textContent = ''; $('ce-foto').append(img.cloneNode()); };
      img.src = URL.createObjectURL(arq);
    });

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const d = lerFormulario();
      const faltando = validarAluno(d, U.soDigitos(campo('cpf').value));
      if (faltando.length) return msg('form-msg', 'Confira: ' + faltando.join(', ') + '.', 'erro');
      await atualizarPrevia();
      registrar(form.dados, form.url);
      form.emitida = true;
      $('previa-status').textContent = 'Emitida · ' + form.id;
      $('previa-status').className = 'etiqueta emitida';
      ['btn-png', 'btn-qr-png', 'btn-abrir', 'btn-copiar'].forEach(id => { $(id).disabled = false; });
      msg('form-msg', 'Carteirinha emitida e registrada no histórico.', 'ok');
      toast('✓ Carteirinha de ' + d.nome.split(' ')[0] + ' emitida');
    });
    $('btn-limpar').addEventListener('click', limparFormulario);

    $('btn-png').addEventListener('click', async () => {
      baixarCanvas(await gerarCartao(form.dados, form.url, form.foto), 'carteirinha-' + slug(form.dados.nome) + '-' + form.id + '.png');
    });
    $('btn-qr-png').addEventListener('click', () => baixarCanvas(qrPNG(form.url), 'qr-' + slug(form.dados.nome) + '-' + form.id + '.png'));
    $('btn-abrir').addEventListener('click', () => window.open(form.url, '_blank', 'noopener'));
    $('btn-copiar').addEventListener('click', () => copiar(form.url));

    // efeito 3D/holográfico na prévia
    const cartao = $('cartao');
    cartao.addEventListener('pointermove', e => {
      const r = cartao.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      cartao.style.setProperty('--ry', ((px - 0.5) * 10).toFixed(2) + 'deg');
      cartao.style.setProperty('--rx', ((0.5 - py) * 8).toFixed(2) + 'deg');
      cartao.style.setProperty('--brilho', (100 - px * 100).toFixed(0) + '%');
    });
    cartao.addEventListener('pointerleave', () => {
      cartao.style.setProperty('--rx', '0deg');
      cartao.style.setProperty('--ry', '0deg');
    });

    // IA: preencher a partir de texto livre
    $('btn-ia-unico').addEventListener('click', async () => {
      const btn = $('btn-ia-unico');
      btn.disabled = true;
      msg('ia-msg-unico', 'Lendo o texto com IA…');
      try {
        const r = await window.USP_IA.extrair($('ia-texto-unico').value, LS.get(K.api, ''));
        if (!r.alunos.length) {
          msg('ia-msg-unico', 'Nenhum estudante identificado no texto.', 'erro');
        } else {
          marcarComoRascunho();
          preencherFormulario(r.alunos[0]);
          const extra = r.alunos.length > 1 ? ' Encontrei ' + r.alunos.length + ' estudantes: use a Emissão em lote para todos.' : '';
          msg('ia-msg-unico', 'Formulário preenchido. Confira antes de emitir.' + extra + (r.observacoes ? ' ' + r.observacoes : ''), 'ok');
        }
      } catch (e) {
        msg('ia-msg-unico', e.message, 'erro');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Emissão em lote ---------- */
  const SINONIMOS = {
    nome: ['nome', 'nome completo', 'aluno', 'estudante', 'nome do aluno'],
    cpf: ['cpf', 'documento'],
    ra: ['ra', 'nusp', 'n usp', 'no usp', 'numero usp', 'nº usp', 'n° usp', 'matricula', 'numero de matricula'],
    curso: ['curso'],
    unidade: ['unidade', 'faculdade', 'instituto', 'escola', 'unidade de ensino'],
    campus: ['campus', 'cidade'],
    nivel: ['nivel', 'modalidade', 'grau'],
    turno: ['turno'],
    semestre: ['semestre', 'semestre atual', 'sem'],
    periodo: ['periodo', 'periodo letivo', 'ano/semestre'],
    ingresso: ['ingresso', 'ano de ingresso', 'ano ingresso', 'entrada'],
    conclusao: ['conclusao', 'ano de conclusao', 'conclusao prevista', 'previsao de conclusao', 'formatura'],
    nascimento: ['nascimento', 'data de nascimento', 'data nascimento', 'dn', 'nasc']
  };

  function lerCSV(texto) {
    const linhas = texto.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
    if (!linhas.length) return [];
    const cab = linhas[0];
    const sep = ['\t', ';', ','].map(s => [s, cab.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const quebrar = linha => {
      const out = [];
      let cel = '', aspas = false;
      for (let i = 0; i < linha.length; i++) {
        const ch = linha[i];
        if (ch === '"') {
          if (aspas && linha[i + 1] === '"') { cel += '"'; i++; } else aspas = !aspas;
        } else if (ch === sep && !aspas) { out.push(cel); cel = ''; } else cel += ch;
      }
      out.push(cel);
      return out.map(c => c.trim());
    };
    return linhas.map(quebrar);
  }

  function linhasParaAlunos(matriz) {
    if (matriz.length < 2) return null;
    const cab = matriz[0].map(h => U.semAcento(h).replace(/[._]/g, ' ').replace(/\s+/g, ' '));
    const mapa = {};
    cab.forEach((h, i) => {
      for (const [campoNome, lista] of Object.entries(SINONIMOS)) {
        if (mapa[campoNome] == null && lista.includes(h)) { mapa[campoNome] = i; break; }
      }
    });
    if (mapa.nome == null) return null;
    return matriz.slice(1).map(l => {
      const a = {};
      Object.keys(SINONIMOS).forEach(k => { a[k] = mapa[k] != null ? (l[mapa[k]] || '') : ''; });
      return a;
    }).filter(a => a.nome);
  }

  function normalizarAluno(a) {
    const periodoPadrao = $('lote-periodo').value.trim() || U.periodoAtual();
    const periodo = /^\d{4}\/[12]$/.test(String(a.periodo || '').trim()) ? a.periodo.trim() : periodoPadrao;
    const unidade = expandirUnidade(a.unidade);
    const nivel = ['Graduação', 'Mestrado', 'Doutorado', 'Especialização', 'Residência'].find(n => U.semAcento(n) === U.semAcento(a.nivel)) || $('lote-nivel').value;
    const turno = ['Integral', 'Matutino', 'Vespertino', 'Noturno'].find(n => U.semAcento(n) === U.semAcento(a.turno)) || 'Integral';
    return {
      nome: nomeProprio(a.nome),
      cpfDigitos: U.soDigitos(a.cpf),
      ra: U.soDigitos(a.ra) || String(a.ra || '').trim(),
      curso: String(a.curso || '').trim(),
      unidade,
      campus: String(a.campus || '').trim() || U.campusDaUnidade(unidade),
      nivel,
      turno,
      semestre: U.soDigitos(a.semestre),
      periodo,
      ingresso: U.soDigitos(a.ingresso).slice(0, 4),
      conclusao: U.soDigitos(a.conclusao).slice(0, 4),
      nascimento: dataParaISO(a.nascimento),
      validade: $('lote-validade').value || U.validadePadrao(periodo)
    };
  }

  function carregarLote(alunos) {
    lote = alunos.map(a => {
      const n = normalizarAluno(a);
      return { aluno: n, faltando: validarAluno(n, n.cpfDigitos), dados: null, url: '' };
    });
    renderizarLote();
  }

  function renderizarLote() {
    $('lote-tabela-bloco').hidden = !lote.length;
    const tbody = $('lote-tabela').querySelector('tbody');
    tbody.innerHTML = lote.map((l, i) => {
      const a = l.aluno;
      const sit = l.url
        ? '<span class="tag ok">Emitida · ' + U.esc(l.dados.id) + '</span>'
        : l.faltando.length ? '<span class="tag erro" title="' + U.esc(l.faltando.join(', ')) + '">Falta: ' + U.esc(l.faltando.join(', ')) + '</span>'
        : '<span class="tag alerta">Pronta</span>';
      return '<tr><td>' + (i + 1) + '</td><td>' + U.esc(a.nome) + '</td><td class="mono">' + U.esc(U.formatarCPF(a.cpfDigitos)) +
        '</td><td class="mono">' + U.esc(a.ra) + '</td><td>' + U.esc(a.curso) + '</td><td>' + U.esc(a.unidade) +
        '</td><td>' + U.esc(a.semestre) + '</td><td>' + sit + '</td><td><button class="btn btn-sec btn-pequeno" data-remover="' + i + '" type="button" aria-label="Remover linha">✕</button></td></tr>';
    }).join('');
    const prontas = lote.filter(l => !l.faltando.length).length;
    const emitidas = lote.filter(l => l.url).length;
    $('lote-resumo').textContent = lote.length + ' estudantes · ' + prontas + ' prontas' + (emitidas ? ' · ' + emitidas + ' emitidas' : '');
    $('btn-lote-imprimir').disabled = !emitidas;
    $('btn-lote-csv').disabled = !emitidas;
  }

  async function imprimirCartoes(itens) {
    const area = $('area-impressao');
    area.innerHTML = '';
    toast('Preparando ' + itens.length + ' carteirinhas para impressão…');
    for (const it of itens) {
      const cv = await gerarCartao(it.dados, it.url, null);
      const img = new Image();
      img.src = cv.toDataURL('image/png');
      img.alt = it.dados.nome;
      area.append(img);
    }
    await Promise.all([...area.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    document.body.classList.add('imprimindo');
    const fim = () => { document.body.classList.remove('imprimindo'); area.innerHTML = ''; window.removeEventListener('afterprint', fim); };
    window.addEventListener('afterprint', fim);
    window.print();
  }

  function iniciarLote() {
    $('lote-periodo').value = U.periodoAtual();
    $('lote-periodo').addEventListener('change', () => {
      const v = U.validadePadrao($('lote-periodo').value);
      if (v) $('lote-validade').value = v;
    });
    $('lote-validade').value = U.validadePadrao(U.periodoAtual());

    $('btn-lote-planilha').addEventListener('click', () => {
      const alunos = linhasParaAlunos(lerCSV($('lote-texto').value));
      if (!alunos) return msg('lote-msg', 'Não reconheci o cabeçalho (precisa ter ao menos a coluna "nome"). Tente "Organizar com IA".', 'erro');
      carregarLote(alunos);
      msg('lote-msg', alunos.length + ' linhas lidas da planilha.', 'ok');
    });

    $('btn-lote-ia').addEventListener('click', async () => {
      const btn = $('btn-lote-ia');
      btn.disabled = true;
      msg('lote-msg', 'A IA está organizando os dados…');
      try {
        const r = await window.USP_IA.extrair($('lote-texto').value, LS.get(K.api, ''));
        carregarLote(r.alunos);
        msg('lote-msg', r.alunos.length + ' estudantes identificados pela IA. Confira a tabela.' + (r.observacoes ? ' ' + r.observacoes : ''), r.alunos.length ? 'ok' : 'erro');
      } catch (e) {
        msg('lote-msg', e.message, 'erro');
      } finally {
        btn.disabled = false;
      }
    });

    $('lote-arquivo').addEventListener('change', async e => {
      const arq = e.target.files[0];
      if (!arq) return;
      const buf = await arq.arrayBuffer();
      let texto = new TextDecoder('utf-8').decode(buf);
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel
      $('lote-texto').value = texto.replace(/^﻿/, '');
      e.target.value = '';
      $('btn-lote-planilha').click();
    });

    $('btn-lote-modelo').addEventListener('click', () => {
      baixar('modelo-carteirinhas.csv', '﻿nome;cpf;ra;curso;unidade;campus;nivel;turno;semestre;periodo;ingresso;conclusao;nascimento\n' +
        'Maria Eduarda Albuquerque;529.982.247-25;13748291;Engenharia Civil;Poli;;Graduação;Integral;5;' + U.periodoAtual() + ';2024;2028;12/03/2004\n',
        'text/csv;charset=utf-8');
    });

    $('lote-tabela').addEventListener('click', e => {
      const b = e.target.closest('[data-remover]');
      if (!b) return;
      lote.splice(Number(b.dataset.remover), 1);
      renderizarLote();
    });

    $('btn-lote-emitir').addEventListener('click', async () => {
      if (!chavePrivada) return bloquear('Sessão expirada. Entre novamente.');
      const btn = $('btn-lote-emitir');
      btn.disabled = true;
      let feitas = 0;
      for (const l of lote) {
        if (l.url || l.faltando.length) continue;
        const a = l.aluno;
        const dados = {
          id: U.gerarId(), nome: a.nome,
          cpf: cpfModo() === 'completo' ? a.cpfDigitos : U.mascararCPF(a.cpfDigitos),
          ra: a.ra, curso: a.curso, unidade: a.unidade, campus: a.campus, nivel: a.nivel, turno: a.turno,
          semestre: a.semestre, periodo: a.periodo, ingresso: a.ingresso, conclusao: a.conclusao,
          nascimento: a.nascimento, emitido: U.hojeISO(), validade: a.validade
        };
        l.dados = dados;
        l.url = U.urlDoAluno(await U.assinar(chavePrivada, dados));
        registrar(dados, l.url);
        feitas++;
      }
      btn.disabled = false;
      renderizarLote();
      const pend = lote.filter(l => !l.url).length;
      msg('lote-msg', feitas + ' carteirinhas emitidas' + (pend ? ' · ' + pend + ' com pendências (corrija e importe novamente)' : '') + '.', 'ok');
      if (feitas) toast('✓ ' + feitas + ' carteirinhas emitidas');
    });

    $('btn-lote-imprimir').addEventListener('click', () => imprimirCartoes(lote.filter(l => l.url).map(l => ({ dados: l.dados, url: l.url }))));

    $('btn-lote-csv').addEventListener('click', () => {
      const q = s => '"' + String(s || '').replace(/"/g, '""') + '"';
      const linhas = lote.filter(l => l.url).map(l => [l.dados.id, l.dados.nome, l.dados.ra, l.dados.curso, l.dados.validade, l.url].map(q).join(';'));
      baixar('links-carteirinhas-' + U.hojeISO() + '.csv', '﻿documento;nome;nusp;curso;validade;link\n' + linhas.join('\n') + '\n', 'text/csv;charset=utf-8');
    });

    $('btn-lote-limpar').addEventListener('click', () => { lote = []; renderizarLote(); msg('lote-msg', ''); });
  }

  /* ---------- Histórico ---------- */
  function statusDe(h) {
    const publicado = (window.USP_REVOGADOS || []).includes(h.id);
    if (h.revogado) return publicado ? ['erro', 'Revogada'] : ['alerta', 'Revogação pendente'];
    if (publicado) return ['alerta', 'Restauração pendente'];
    if (U.expirado(h.dados.validade)) return ['alerta', 'Expirada'];
    return ['ok', 'Ativa'];
  }

  function renderizarHistorico() {
    $('cont-historico').textContent = historico.length;
    const termo = U.semAcento($('hist-busca').value);
    const filtrados = historico.filter(h => !termo ||
      U.semAcento([h.id, h.dados.nome, h.dados.ra, h.dados.curso, h.dados.unidade].join(' ')).includes(termo));

    const ativas = historico.filter(h => statusDe(h)[1] === 'Ativa').length;
    const revog = historico.filter(h => h.revogado).length;
    const exp = historico.filter(h => !h.revogado && U.expirado(h.dados.validade)).length;
    $('hist-kpis').innerHTML =
      '<div class="kpi"><b>' + historico.length + '</b><span>emitidas</span></div>' +
      '<div class="kpi"><b>' + ativas + '</b><span>ativas</span></div>' +
      '<div class="kpi"><b>' + exp + '</b><span>expiradas</span></div>' +
      '<div class="kpi"><b>' + revog + '</b><span>revogadas</span></div>';

    $('hist-vazio').hidden = historico.length > 0;
    $('hist-tabela').querySelector('tbody').innerHTML = filtrados.map(h => {
      const st = statusDe(h);
      return '<tr><td class="mono">' + U.esc(h.id) + '</td>' +
        '<td><strong>' + U.esc(h.dados.nome) + '</strong><br><span class="dica">Nº USP ' + U.esc(h.dados.ra) + '</span></td>' +
        '<td>' + U.esc(h.dados.curso) + '<br><span class="dica">' + U.esc(h.dados.periodo) + ' · ' + U.esc(U.ordinal(h.dados.semestre)) + ' sem.</span></td>' +
        '<td class="mono">' + U.esc(U.dataBR(h.dados.emitido)) + '</td>' +
        '<td class="mono">' + U.esc(U.dataBR(h.dados.validade)) + '</td>' +
        '<td><span class="tag ' + st[0] + '">' + st[1] + '</span></td>' +
        '<td><div class="acoes-linha">' +
          '<button class="btn btn-sec" type="button" data-acao="abrir" data-id="' + U.esc(h.id) + '">Abrir</button>' +
          '<button class="btn btn-sec" type="button" data-acao="png" data-id="' + U.esc(h.id) + '">PNG</button>' +
          '<button class="btn btn-sec" type="button" data-acao="copiar" data-id="' + U.esc(h.id) + '">Link</button>' +
          '<button class="btn ' + (h.revogado ? 'btn-sec' : 'btn-perigo') + '" type="button" data-acao="revogar" data-id="' + U.esc(h.id) + '">' + (h.revogado ? 'Restaurar' : 'Revogar') + '</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function listaRevogados() {
    const publicados = window.USP_REVOGADOS || [];
    const locais = new Map(historico.map(h => [h.id, h.revogado]));
    const ids = new Set(publicados.filter(id => locais.get(id) !== false));
    historico.filter(h => h.revogado).forEach(h => ids.add(h.id));
    return [...ids];
  }

  function iniciarHistorico() {
    $('cont-historico').textContent = historico.length;
    $('hist-busca').addEventListener('input', renderizarHistorico);
    $('hist-tabela').addEventListener('click', async e => {
      const b = e.target.closest('[data-acao]');
      if (!b) return;
      const h = historico.find(x => x.id === b.dataset.id);
      if (!h) return;
      if (b.dataset.acao === 'abrir') window.open(h.url, '_blank', 'noopener');
      if (b.dataset.acao === 'copiar') copiar(h.url);
      if (b.dataset.acao === 'png') baixarCanvas(await gerarCartao(h.dados, h.url, null), 'carteirinha-' + slug(h.dados.nome) + '-' + h.id + '.png');
      if (b.dataset.acao === 'revogar') {
        if (!h.revogado && !confirm('Revogar a carteirinha ' + h.id + ' de ' + h.dados.nome + '?\n\nDepois, publique o revogados.js no GitHub para valer em todos os celulares.')) return;
        h.revogado = !h.revogado;
        salvarHistorico();
        renderizarHistorico();
        toast(h.revogado ? 'Marcada como revogada — baixe e publique o revogados.js' : 'Carteirinha restaurada — publique o revogados.js');
      }
    });

    $('btn-revogados').addEventListener('click', () => {
      const ids = listaRevogados();
      const conteudo = '/* =====================================================================\n' +
        '   Lista de carteirinhas revogadas — gerada pelo Painel em ' + U.dataBR(U.hojeISO()) + '.\n' +
        '   Publique este arquivo em assets/js/revogados.js\n' +
        '   ===================================================================== */\n' +
        'window.USP_REVOGADOS = ' + JSON.stringify(ids, null, 2) + ';\n';
      baixar('revogados.js', conteudo, 'text/javascript;charset=utf-8');
    });

    $('btn-backup').addEventListener('click', () => {
      baixar('backup-carteirinhas-' + U.hojeISO() + '.json',
        JSON.stringify({ tipo: 'usp-carteirinhas', versao: 1, exportadoEm: new Date().toISOString(), historico }, null, 2),
        'application/json');
    });

    $('backup-arquivo').addEventListener('change', async e => {
      const arq = e.target.files[0];
      e.target.value = '';
      if (!arq) return;
      try {
        const j = JSON.parse(await arq.text());
        if (j.tipo !== 'usp-carteirinhas' || !Array.isArray(j.historico)) throw new Error();
        const ids = new Set(historico.map(h => h.id));
        const novos = j.historico.filter(h => h && h.id && h.dados && !ids.has(h.id));
        historico = historico.concat(novos).sort((a, b) => String(b.emitidoEm).localeCompare(String(a.emitidoEm)));
        salvarHistorico();
        renderizarHistorico();
        toast(novos.length + ' registros importados');
      } catch (err) {
        toast('Arquivo de backup inválido');
      }
    });
  }

  /* ---------- Ajustes ---------- */
  function iniciarAjustes() {
    const temChave = !!LS.get(K.api, '');
    $('api-chave').placeholder = temChave ? '•••••••• (chave salva)' : 'sk-ant-…';
    $('btn-salvar-api').addEventListener('click', () => {
      const v = $('api-chave').value.trim();
      if (!v) return msg('api-msg', 'Cole a chave antes de salvar.', 'erro');
      LS.set(K.api, v);
      $('api-chave').value = '';
      $('api-chave').placeholder = '•••••••• (chave salva)';
      msg('api-msg', 'Chave salva neste navegador.', 'ok');
    });
    $('btn-remover-api').addEventListener('click', () => {
      LS.del(K.api);
      $('api-chave').placeholder = 'sk-ant-…';
      msg('api-msg', 'Chave removida.', 'ok');
    });

    document.querySelectorAll('input[name="cpf-modo"]').forEach(r => {
      r.checked = r.value === cpfModo();
      r.addEventListener('change', () => {
        LS.set(K.cpfModo, r.value);
        aoMudarCPF();
        marcarComoRascunho();
        atualizarPrevia();
        toast(r.value === 'completo' ? 'Próximos QR codes terão o CPF completo' : 'Próximos QR codes terão o CPF parcialmente oculto');
      });
    });

    $('btn-baixar-config').addEventListener('click', () => baixar('config.js', textoConfig(cfg), 'text/javascript;charset=utf-8'));

    $('form-senha').addEventListener('submit', async e => {
      e.preventDefault();
      const atual = $('senha-atual').value, nova = $('senha-nova').value;
      if (nova.length < 10) return msg('senha-msg', 'A nova senha precisa de 10+ caracteres.', 'erro');
      if (nova !== $('senha-nova2').value) return msg('senha-msg', 'As senhas novas não conferem.', 'erro');
      msg('senha-msg', 'Processando…');
      try {
        const cofre = await U.trocarSenha(atual, nova, cfg.chavePrivadaCifrada);
        cfg = Object.assign({}, cfg, { chavePrivadaCifrada: cofre });
        if (cfg.origemLocal) LS.set(K.pendente, { chavePublica: cfg.chavePublica, chavePrivadaCifrada: cofre });
        baixar('config.js', textoConfig(cfg), 'text/javascript;charset=utf-8');
        e.target.reset();
        msg('senha-msg', 'Novo config.js baixado. Publique-o no GitHub para a nova senha valer.', 'ok');
      } catch (err) {
        msg('senha-msg', err.message === 'SENHA' ? 'Senha atual incorreta.' : 'Falha ao trocar a senha.', 'erro');
      }
    });
  }

  /* ---------- Bloqueio automático por inatividade ---------- */
  function iniciarBloqueio() {
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { ultimoUso = Date.now(); }, { passive: true }));
    setInterval(() => {
      if (chavePrivada && Date.now() - ultimoUso > BLOQUEIO_MIN * 60000) {
        bloquear('Painel bloqueado após ' + BLOQUEIO_MIN + ' minutos sem uso.');
      }
    }, 30000);
    $('btn-bloquear').addEventListener('click', () => bloquear('Painel bloqueado.'));
  }

  /* ---------- Início ---------- */
  function iniciar() {
    if (!window.crypto || !crypto.subtle) {
      document.querySelector('main').innerHTML = '<div class="painel tela-central"><h1>Conexão não segura</h1><p>Abra o painel pelo endereço https:// do GitHub Pages (ou localhost) para habilitar a criptografia.</p></div>';
      return;
    }
    // se o config.js publicado já contém a mesma chave, descarta a cópia local
    const pendente = LS.get(K.pendente, null);
    if (pendente && window.USP_CONFIG && window.USP_CONFIG.chavePublica && window.USP_CONFIG.chavePublica.x === pendente.chavePublica.x) {
      LS.del(K.pendente);
    }

    iniciarSetup();
    iniciarLogin();
    iniciarAbas();
    iniciarFormulario();
    iniciarLote();
    iniciarHistorico();
    iniciarAjustes();
    iniciarBloqueio();
    if (!window.qrcode) toast('Biblioteca de QR code não carregou — verifique a internet');
    mostrar(cfg.chavePublica ? 'login' : 'setup');
  }

  iniciar();
})();
