/* =====================================================================
   USP · Carteira Digital do Estudante — núcleo compartilhado
   Criptografia (ECDSA P-256), codificação do QR e utilitários.
   Usado tanto pelo painel de emissão quanto pela página do aluno.
   ===================================================================== */
(function (global) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- Base64 URL-safe ---------- */
  function b64url(bytes) {
    const arr = new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function deB64url(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function passarPorStream(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ---------- Codificação compacta dos dados do aluno ----------
     Os campos vão em ordem fixa (array), comprimidos com deflate.
     Assim o QR fica menor e mais fácil de ler quando impresso.   */
  const CAMPOS = [
    'id', 'nome', 'cpf', 'ra', 'curso', 'unidade', 'campus', 'nivel', 'turno',
    'semestre', 'periodo', 'ingresso', 'conclusao', 'nascimento', 'emitido', 'validade'
  ];
  const VERSAO = 1;

  async function codificar(dados) {
    const arr = [VERSAO].concat(CAMPOS.map(k => (dados[k] == null ? '' : String(dados[k]))));
    const json = enc.encode(JSON.stringify(arr));
    if (typeof CompressionStream !== 'undefined') {
      try {
        const z = await passarPorStream(json, new CompressionStream('deflate-raw'));
        if (z.length < json.length) return 'z' + b64url(z);
      } catch (e) { /* cai para JSON puro */ }
    }
    return 'j' + b64url(json);
  }

  async function decodificar(p) {
    const tipo = p.charAt(0);
    const bytes = deB64url(p.slice(1));
    let json;
    if (tipo === 'z') {
      if (typeof DecompressionStream === 'undefined') throw new Error('NAVEGADOR');
      json = await passarPorStream(bytes, new DecompressionStream('deflate-raw'));
    } else if (tipo === 'j') {
      json = bytes;
    } else {
      throw new Error('FORMATO');
    }
    const arr = JSON.parse(dec.decode(json));
    if (!Array.isArray(arr) || arr[0] !== VERSAO) throw new Error('FORMATO');
    const dados = {};
    CAMPOS.forEach((k, i) => { dados[k] = arr[i + 1]; });
    return dados;
  }

  /* ---------- Assinatura digital ---------- */
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIG = { name: 'ECDSA', hash: 'SHA-256' };
  const PBKDF2_ITER = 600000;

  async function assinar(chavePrivada, dados) {
    const p = await codificar(dados);
    const sig = await crypto.subtle.sign(SIG, chavePrivada, enc.encode(p));
    return p + '.' + b64url(sig);
  }

  async function verificar(jwkPublica, token) {
    const partes = String(token || '').split('.');
    if (partes.length !== 2 || !partes[0] || !partes[1]) return { estado: 'formato' };
    let dados;
    try {
      dados = await decodificar(partes[0]);
    } catch (e) {
      return { estado: e.message === 'NAVEGADOR' ? 'navegador' : 'formato' };
    }
    try {
      const chave = await crypto.subtle.importKey('jwk', jwkPublica, ALG, false, ['verify']);
      const ok = await crypto.subtle.verify(SIG, chave, deB64url(partes[1]), enc.encode(partes[0]));
      return { estado: ok ? 'valido' : 'assinatura', dados };
    } catch (e) {
      return { estado: 'assinatura', dados };
    }
  }

  async function impressaoDigital(jwkPublica) {
    const h = await crypto.subtle.digest('SHA-256', enc.encode(jwkPublica.x + '.' + jwkPublica.y));
    return Array.from(new Uint8Array(h)).slice(0, 10)
      .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
      .replace(/(.{4})(?=.)/g, '$1 ');
  }

  /* ---------- Cofre: chave privada cifrada com a senha do administrador ---------- */
  async function derivarChave(senha, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function cifrar(senha, bytes) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const chave = await derivarChave(senha, salt);
    const dados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes);
    return { salt: b64url(salt), iv: b64url(iv), dados: b64url(dados) };
  }

  async function decifrar(senha, cofre) {
    const chave = await derivarChave(senha, deB64url(cofre.salt));
    try {
      return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64url(cofre.iv) }, chave, deB64url(cofre.dados));
    } catch (e) {
      throw new Error('SENHA');
    }
  }

  async function criarChaves(senha) {
    const par = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', par.publicKey);
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', par.privateKey);
    return {
      chavePublica: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      chavePrivadaCifrada: await cifrar(senha, pkcs8)
    };
  }

  async function abrirCofre(senha, cofre) {
    const pkcs8 = await decifrar(senha, cofre);
    return crypto.subtle.importKey('pkcs8', pkcs8, ALG, false, ['sign']);
  }

  async function trocarSenha(senhaAtual, novaSenha, cofre) {
    const pkcs8 = await decifrar(senhaAtual, cofre);
    return cifrar(novaSenha, pkcs8);
  }

  /* ---------- CPF ---------- */
  const soDigitos = s => String(s || '').replace(/\D/g, '');

  function validarCPF(valor) {
    const c = soDigitos(valor);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let soma = 0;
      for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
      const dig = ((soma * 10) % 11) % 10;
      if (dig !== Number(c[t])) return false;
    }
    return true;
  }
  function formatarCPF(valor) {
    const c = soDigitos(valor).slice(0, 11);
    return c.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  function mascararCPF(valor) {
    const c = soDigitos(valor);
    if (c.length !== 11) return String(valor || '');
    return '***.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-**';
  }

  /* ---------- Datas e textos ---------- */
  function hojeISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dataBR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '—');
  }
  function idade(nascISO) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(nascISO || ''));
    if (!m) return null;
    const hoje = new Date();
    let anos = hoje.getFullYear() - Number(m[1]);
    const mes = hoje.getMonth() + 1, dia = hoje.getDate();
    if (mes < Number(m[2]) || (mes === Number(m[2]) && dia < Number(m[3]))) anos--;
    return anos >= 0 && anos < 130 ? anos : null;
  }
  function periodoAtual() {
    const d = new Date();
    return d.getFullYear() + '/' + (d.getMonth() < 6 ? '1' : '2');
  }
  // Validade padrão: fim do período letivo informado (+ margem até o início do próximo)
  function validadePadrao(periodo) {
    const m = /^(\d{4})\s*\/\s*([12])$/.exec(String(periodo || '').trim());
    if (!m) return '';
    const ano = Number(m[1]);
    return m[2] === '1' ? ano + '-08-31' : (ano + 1) + '-02-28';
  }
  function expirado(validadeISO) {
    return !!validadeISO && String(validadeISO) < hojeISO();
  }
  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(p => p.length > 2 || /^[A-ZÀ-Ú]/.test(p));
    if (!partes.length) return '?';
    const a = partes[0][0], b = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (a + b).toUpperCase();
  }
  function semestresTotais(d) {
    const anos = Number(d.conclusao) - Number(d.ingresso) + 1;
    const total = anos > 0 && anos < 15 ? anos * 2 : 8;
    return Math.max(total, Number(d.semestre) || 1);
  }
  function ordinal(n) {
    const v = Number(n);
    return v ? v + 'º' : String(n || '—');
  }
  function gerarId() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let s = '';
    for (let i = 0; i < 8; i++) s += alfabeto[bytes[i] % alfabeto.length];
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }
  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /* ---------- Unidades e campi da USP (sugestões dos formulários) ---------- */
  const CAMPI = {
    BUTANTA: 'Cidade Universitária · São Paulo',
    LESTE: 'USP Leste · São Paulo',
    QUADRILATERO: 'Quadrilátero Saúde · São Paulo',
    CENTRO: 'Largo São Francisco · São Paulo',
    SAO_CARLOS: 'São Carlos',
    RIBEIRAO: 'Ribeirão Preto',
    PIRACICABA: 'Piracicaba',
    PIRASSUNUNGA: 'Pirassununga',
    BAURU: 'Bauru',
    LORENA: 'Lorena'
  };
  const UNIDADES = [
    ['Escola Politécnica (Poli)', 'BUTANTA'],
    ['Faculdade de Economia, Administração, Contabilidade e Atuária (FEA)', 'BUTANTA'],
    ['Faculdade de Filosofia, Letras e Ciências Humanas (FFLCH)', 'BUTANTA'],
    ['Faculdade de Arquitetura e Urbanismo (FAU)', 'BUTANTA'],
    ['Escola de Comunicações e Artes (ECA)', 'BUTANTA'],
    ['Faculdade de Educação (FE)', 'BUTANTA'],
    ['Instituto de Matemática e Estatística (IME)', 'BUTANTA'],
    ['Instituto de Física (IF)', 'BUTANTA'],
    ['Instituto de Química (IQ)', 'BUTANTA'],
    ['Instituto de Biociências (IB)', 'BUTANTA'],
    ['Instituto de Psicologia (IP)', 'BUTANTA'],
    ['Instituto de Relações Internacionais (IRI)', 'BUTANTA'],
    ['Faculdade de Ciências Farmacêuticas (FCF)', 'BUTANTA'],
    ['Faculdade de Odontologia (FO)', 'BUTANTA'],
    ['Faculdade de Medicina Veterinária e Zootecnia (FMVZ)', 'BUTANTA'],
    ['Escola de Educação Física e Esporte (EEFE)', 'BUTANTA'],
    ['Escola de Artes, Ciências e Humanidades (EACH)', 'LESTE'],
    ['Faculdade de Medicina (FMUSP)', 'QUADRILATERO'],
    ['Faculdade de Saúde Pública (FSP)', 'QUADRILATERO'],
    ['Escola de Enfermagem (EE)', 'QUADRILATERO'],
    ['Faculdade de Direito (FD)', 'CENTRO'],
    ['Escola de Engenharia de São Carlos (EESC)', 'SAO_CARLOS'],
    ['Instituto de Ciências Matemáticas e de Computação (ICMC)', 'SAO_CARLOS'],
    ['Instituto de Física de São Carlos (IFSC)', 'SAO_CARLOS'],
    ['Instituto de Química de São Carlos (IQSC)', 'SAO_CARLOS'],
    ['Instituto de Arquitetura e Urbanismo (IAU)', 'SAO_CARLOS'],
    ['Faculdade de Medicina de Ribeirão Preto (FMRP)', 'RIBEIRAO'],
    ['Faculdade de Filosofia, Ciências e Letras de Ribeirão Preto (FFCLRP)', 'RIBEIRAO'],
    ['Faculdade de Economia, Administração e Contabilidade de Ribeirão Preto (FEA-RP)', 'RIBEIRAO'],
    ['Faculdade de Direito de Ribeirão Preto (FDRP)', 'RIBEIRAO'],
    ['Escola de Enfermagem de Ribeirão Preto (EERP)', 'RIBEIRAO'],
    ['Escola Superior de Agricultura "Luiz de Queiroz" (ESALQ)', 'PIRACICABA'],
    ['Faculdade de Zootecnia e Engenharia de Alimentos (FZEA)', 'PIRASSUNUNGA'],
    ['Faculdade de Odontologia de Bauru (FOB)', 'BAURU'],
    ['Escola de Engenharia de Lorena (EEL)', 'LORENA']
  ].map(([nome, campus]) => ({ nome, campus: CAMPI[campus] }));

  function campusDaUnidade(unidade) {
    const u = semAcento(unidade);
    if (!u) return '';
    const achada = UNIDADES.find(x => semAcento(x.nome) === u ||
      (semAcento(x.nome).match(/\(([^)]+)\)/) || [])[1] === u);
    return achada ? achada.campus : '';
  }

  /* ---------- Configuração (repositório + pendente local) ---------- */
  function configAtiva() {
    const base = Object.assign({}, global.USP_CONFIG || {});
    if (!base.chavePublica) {
      try {
        const pendente = JSON.parse(localStorage.getItem('usp_config_pendente') || 'null');
        if (pendente && pendente.chavePublica) {
          base.chavePublica = pendente.chavePublica;
          base.chavePrivadaCifrada = pendente.chavePrivadaCifrada;
          base.origemLocal = true;
        }
      } catch (e) { /* sem armazenamento local */ }
    }
    return base;
  }

  function urlDoAluno(token) {
    const u = new URL('aluno.html', global.location.href);
    u.search = '';
    u.hash = token;
    return u.href;
  }

  global.USP = {
    CAMPOS, CAMPI, UNIDADES,
    b64url, deB64url,
    codificar, decodificar, assinar, verificar, impressaoDigital,
    criarChaves, abrirCofre, trocarSenha,
    soDigitos, validarCPF, formatarCPF, mascararCPF,
    hojeISO, dataBR, idade, periodoAtual, validadePadrao, expirado,
    iniciais, semestresTotais, ordinal, gerarId, esc, semAcento,
    campusDaUnidade, configAtiva, urlDoAluno
  };
})(typeof window !== 'undefined' ? window : globalThis);
