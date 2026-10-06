/* =====================================================================
   Página do aluno: lê o token do QR (após o #), confere a assinatura
   digital e mostra o comprovante de matrícula.
   ===================================================================== */
(function () {
  'use strict';
  const U = window.USP;
  const cfg = U.configAtiva();
  const alvo = document.getElementById('conteudo');
  const esc = U.esc;

  if (cfg.modoDemonstracao !== false) document.getElementById('faixa-demo').hidden = false;

  const ICONES = {
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" width="16" height="16"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    escudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>',
    erro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
    compartilhar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    imprimir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>'
  };

  function falha(tipo, titulo, texto) {
    const cor = tipo === 'alerta' ? 'var(--alerta)' : 'var(--erro)';
    const fundo = tipo === 'alerta' ? 'var(--alerta-bg)' : 'var(--erro-bg)';
    alvo.innerHTML =
      '<div class="estado-falha">' +
        '<div class="icone" style="color:' + cor + ';background:' + fundo + '">' + (tipo === 'alerta' ? ICONES.alerta : ICONES.erro) + '</div>' +
        '<span class="status ' + (tipo === 'alerta' ? 'alerta' : 'erro') + '"><span class="ponto"></span>' + esc(titulo) + '</span>' +
        '<h2 style="margin-top:16px">' + esc(titulo) + '</h2>' +
        '<p>' + texto + '</p>' +
        '<div class="acoes" style="justify-content:center"><a class="btn btn-primario" href="index.html">' + ICONES.qr + 'Validar outro documento</a></div>' +
      '</div>';
    document.title = titulo + ' · USP';
  }

  function linha(rotulo, valor) {
    return valor ? '<div><dt>' + esc(rotulo) + '</dt><dd>' + esc(valor) + '</dd></div>' : '';
  }

  function relogioAoVivo() {
    const el = document.getElementById('agora');
    if (!el) return;
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const tic = () => { el.textContent = fmt.format(new Date()).replace(',', ' ·'); };
    tic();
    setInterval(tic, 1000);
  }

  // Efeito holográfico: o brilho do selo acompanha o dedo/mouse e a inclinação do celular
  function seloHolografico() {
    const selo = document.getElementById('selo');
    if (!selo) return;
    const mover = (x, y) => {
      selo.style.setProperty('--mx', Math.round(x * 100) + '%');
      selo.style.setProperty('--my', Math.round(y * 100) + '%');
    };
    window.addEventListener('pointermove', e => mover(e.clientX / innerWidth, e.clientY / innerHeight), { passive: true });
    window.addEventListener('deviceorientation', e => {
      if (e.gamma == null) return;
      mover(Math.min(1, Math.max(0, (e.gamma + 45) / 90)), Math.min(1, Math.max(0, (e.beta - 10) / 90)));
    }, { passive: true });
  }

  async function renderizarValido(d, fingerprint, token) {
    const vencido = U.expirado(d.validade);
    const anos = U.idade(d.nascimento);
    const total = U.semestresTotais(d);
    const atual = Number(d.semestre) || 0;
    const cpf = d.cpf && /^\d{11}$/.test(d.cpf) ? U.formatarCPF(d.cpf) : d.cpf;
    const semestreTxt = atual ? U.ordinal(atual) + ' semestre' : d.semestre;

    let trilha = '';
    for (let i = 1; i <= total; i++) {
      trilha += '<span class="' + (i < atual ? 'feito' : i === atual ? 'atual' : '') + '" title="' + i + 'º semestre"></span>';
    }

    const status = vencido
      ? '<span class="status alerta"><span class="ponto"></span>Comprovante expirado</span>'
      : '<span class="status ok"><span class="ponto"></span>Matrícula ativa</span>';

    const declaracao = vencido
      ? 'Este comprovante foi válido até <strong>' + esc(U.dataBR(d.validade)) + '</strong> e precisa ser renovado. Os dados abaixo referem-se ao período letivo <strong>' + esc(d.periodo) + '</strong>.'
      : 'A <strong>' + esc(cfg.instituicao || 'Universidade de São Paulo') + '</strong> declara que <strong>' + esc(d.nome) +
        '</strong>, CPF <strong>' + esc(cpf) + '</strong>, Nº USP <strong>' + esc(d.ra) +
        '</strong>, está regularmente matriculado(a) no curso de <strong>' + esc(d.curso) + '</strong>' +
        (d.nivel ? ' (' + esc(d.nivel) + ')' : '') +
        (d.unidade ? ' da <strong>' + esc(d.unidade) + '</strong>' : '') +
        ', cursando o <strong>' + esc(semestreTxt) + '</strong> no período letivo <strong>' + esc(d.periodo) + '</strong>.';

    alvo.innerHTML =
      '<div class="doc-topo">' + status +
        '<div class="relogio" title="Relógio ao vivo: comprova que esta tela não é uma captura">' + ICONES.relogio +
          '<span>Verificado em <strong id="agora"></strong></span></div>' +
      '</div>' +
      '<div class="aluno">' +
        '<div class="avatar" aria-hidden="true">' + esc(U.iniciais(d.nome)) + '</div>' +
        '<div><h2 class="aluno-nome">' + esc(d.nome) + '</h2>' +
          '<div class="aluno-id"><span>Nº USP <b>' + esc(d.ra) + '</b></span><span>CPF <b>' + esc(cpf) + '</b></span>' +
          (anos != null ? '<span>' + anos + ' anos</span>' : '') + '</div></div>' +
        '<div class="selo" id="selo" aria-label="Selo de autenticidade"><div class="selo-texto"><span class="logo-mascara"></span><small>Autêntico</small><small>' + esc(String(d.periodo || '')) + '</small></div></div>' +
      '</div>' +
      '<p class="declaracao">' + declaracao + '</p>' +
      '<dl class="grade-dados">' +
        linha('Curso', d.curso) + linha('Nível', d.nivel) + linha('Unidade', d.unidade) + linha('Campus', d.campus) +
        linha('Turno', d.turno) + linha('Semestre atual', semestreTxt) + linha('Período letivo', d.periodo) +
        linha('Ano de ingresso', d.ingresso) + linha('Conclusão prevista', d.conclusao) +
        linha('Válido até', U.dataBR(d.validade)) +
      '</dl>' +
      (atual ? '<div class="jornada"><div class="jornada-topo"><span>Jornada acadêmica</span><span><strong>' + atual + '</strong> de ' + total + ' semestres</span></div>' +
        '<div class="trilha" style="--total:' + total + '">' + trilha + '</div></div>' : '') +
      '<div class="autenticidade">' + ICONES.escudo +
        '<div><strong>Assinatura digital verificada.</strong> Este comprovante foi emitido e assinado eletronicamente pela Universidade. ' +
        'Qualquer alteração nos dados invalida o documento automaticamente.' +
        '<details class="tecnico"><summary>Detalhes técnicos</summary><dl>' +
          '<dt>Documento</dt><dd>' + esc(d.id) + '</dd>' +
          '<dt>Emitido em</dt><dd>' + esc(U.dataBR(d.emitido)) + '</dd>' +
          '<dt>Válido até</dt><dd>' + esc(U.dataBR(d.validade)) + '</dd>' +
          '<dt>Algoritmo</dt><dd>ECDSA P-256 · SHA-256</dd>' +
          '<dt>Chave USP</dt><dd>' + esc(fingerprint) + '</dd>' +
          '<dt>Tamanho</dt><dd>' + token.length + ' caracteres</dd>' +
        '</dl></details></div>' +
      '</div>' +
      '<div class="acoes">' +
        '<button class="btn btn-primario" id="btn-compartilhar" type="button">' + ICONES.compartilhar + 'Compartilhar</button>' +
        '<button class="btn btn-sec" id="btn-imprimir" type="button">' + ICONES.imprimir + 'Imprimir comprovante</button>' +
        '<a class="btn btn-sec" href="index.html">' + ICONES.qr + 'Validar outro documento</a>' +
      '</div>';

    document.title = d.nome + ' · Comprovante de Matrícula USP';
    relogioAoVivo();
    seloHolografico();

    document.getElementById('btn-imprimir').addEventListener('click', () => window.print());
    document.getElementById('btn-compartilhar').addEventListener('click', async ev => {
      const dados = { title: 'Comprovante de Matrícula · USP', text: d.nome + ' — ' + d.curso, url: location.href };
      if (navigator.share) {
        try { await navigator.share(dados); } catch (e) { /* cancelado */ }
      } else {
        try {
          await navigator.clipboard.writeText(location.href);
          ev.currentTarget.lastChild.textContent = 'Link copiado';
        } catch (e) { prompt('Copie o link:', location.href); }
      }
    });
  }

  async function iniciar() {
    const token = decodeURIComponent((location.hash || '').replace(/^#/, '')).trim();

    if (!window.crypto || !crypto.subtle) {
      return falha('alerta', 'Navegador sem suporte', 'Abra este link em um navegador atualizado (Chrome, Safari, Edge ou Firefox) para verificar a assinatura digital.');
    }
    if (!cfg.chavePublica) {
      return falha('alerta', 'Sistema não configurado', 'A chave pública da Universidade ainda não foi publicada. Conclua a configuração inicial no painel de emissão.');
    }
    if (!token) {
      return falha('alerta', 'Nenhum documento informado', 'Escaneie o QR code impresso na carteirinha do estudante para abrir o comprovante.');
    }

    const r = await U.verificar(cfg.chavePublica, token);
    if (r.estado === 'navegador') {
      return falha('alerta', 'Atualize o navegador', 'Este aparelho não consegue ler o formato do QR code. Atualize o navegador e tente novamente.');
    }
    if (r.estado !== 'valido') {
      return falha('erro', 'Documento inválido', 'A assinatura digital não confere. O QR code pode ter sido <strong>alterado, copiado de forma incompleta ou falsificado</strong>. Solicite à secretaria da unidade a emissão de uma nova carteirinha.');
    }
    const revogados = window.USP_REVOGADOS || [];
    if (revogados.indexOf(r.dados.id) !== -1) {
      return falha('erro', 'Documento revogado', 'Esta carteirinha (documento <strong>' + esc(r.dados.id) + '</strong>) foi cancelada pela Universidade e não comprova mais vínculo de matrícula.');
    }
    renderizarValido(r.dados, await U.impressaoDigital(cfg.chavePublica), token);
  }

  window.addEventListener('hashchange', () => location.reload());
  iniciar().catch(err => {
    console.error(err);
    falha('erro', 'Não foi possível verificar', 'Ocorreu um erro inesperado ao ler o QR code. Tente abrir o link novamente.');
  });
})();
