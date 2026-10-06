/* =====================================================================
   Configuração pública do sistema.

   ⚠ Os campos "chavePublica" e "chavePrivadaCifrada" são preenchidos
   automaticamente: abra admin.html, faça a configuração inicial e
   substitua ESTE arquivo pelo config.js que o painel gerar.

   A chave privada fica CIFRADA com a sua senha (AES-256 + PBKDF2).
   Mesmo público no GitHub, ninguém consegue emitir carteirinhas sem ela.
   ===================================================================== */
window.USP_CONFIG = {
  instituicao: 'Universidade de São Paulo',

  // Mostra a faixa "Protótipo" nas páginas públicas.
  // Mude para false somente quando o sistema for adotado oficialmente.
  modoDemonstracao: true,

  chavePublica: null,
  chavePrivadaCifrada: null
};
