# Carteira Digital do Estudante · USP

Proposta de novo layout e sistema de comprovação de matrícula por QR code para a Universidade de São Paulo.

A secretaria preenche os dados do aluno, o sistema gera a carteirinha com um **QR code assinado digitalmente**. Quem escanear o QR abre uma página exclusiva daquele estudante, com o seguinte texto:

> A Universidade de São Paulo declara que **Fulano**, CPF \*\*\*.982.247-\*\*, Nº USP **12345678**, está regularmente matriculado(a) no curso de **Engenharia Civil** da **Escola Politécnica**, cursando o **5º semestre** no período letivo **2026/2**.

## Páginas

| Página | Para quem | O que faz |
|---|---|---|
| `index.html` | Público | Portal de validação: leitor de QR pela câmera ou link colado |
| `aluno.html#…` | Quem escaneia o QR | Comprovante de matrícula daquele aluno (um QR = uma página) |
| `admin.html` | Somente o administrador | Emissão individual e em lote, carteirinha em PNG, histórico, revogação e IA |

## Diferenciais

- **Assinatura digital ECDSA P-256.** Os dados do aluno vão dentro do próprio QR, assinados com a chave da Universidade. Se qualquer letra for alterada, a página mostra "Documento inválido".
- **Sem servidor e sem banco de dados público.** Roda 100% no GitHub Pages. A verificação acontece no celular de quem lê o QR, e os dados ficam depois do `#` do link, por isso nunca chegam a servidores.
- **Painel protegido de verdade.** A chave que assina fica cifrada com a senha mestra (AES-256-GCM + PBKDF2 com 600 mil iterações). Mesmo com o código público no GitHub, ninguém consegue emitir carteirinhas sem a senha.
- **Proteção contra print.** A página tem relógio ao vivo, selo holográfico animado que reage ao movimento do celular e status pulsante, então uma captura de tela não passa por documento verdadeiro.
- **LGPD.** O CPF fica parcialmente oculto por padrão (`***.982.247-**`) e o CPF completo não sai do painel.
- **IA (Claude, da Anthropic).** Cole um e-mail, uma ficha ou uma planilha bagunçada e a IA preenche os cadastros.
- **Emissão em lote.** Importa CSV/Excel, confere os CPFs pelos dígitos verificadores, imprime as carteirinhas no tamanho de cartão (CR80) em folha A4 e exporta os links.
- **Ciclo de vida completo.** Mostra a validade por período letivo, marca o documento como expirado, permite revogar carteirinhas (`revogados.js`) e tem a barra de progresso da jornada acadêmica.
- Tem modo escuro automático, funciona no celular, é acessível e tem versão de impressão do comprovante.

## Primeiro uso

1. Abra `https://<seu-usuario>.github.io/<repositorio>/admin.html`.
2. Na **Configuração inicial**, crie a senha mestra (10 caracteres ou mais). O painel gera as chaves.
3. Clique em **Baixar config.js** e substitua `assets/js/config.js` no repositório (pelo GitHub: *Add file → Upload files*).
4. Pronto. Entre no painel com a senha e emita as carteirinhas.

> Guarde a senha. Ela não pode ser recuperada. Se perdê-la, gere chaves novas e reemita as carteirinhas.

## Assistente de IA (opcional)

Em **Ajustes**, cole uma chave da API da Anthropic (`sk-ant-…`). A chave fica salva só no seu navegador. Ao usar a IA, o texto colado é enviado à API da Anthropic para ser processado.

## Revogar uma carteirinha

No **Histórico**, clique em **Revogar** e depois em **Baixar revogados.js**. Publique o arquivo em `assets/js/revogados.js`. A partir daí, quem ler aquele QR verá "Documento revogado".

## Estrutura

```
index.html            portal público de validação
aluno.html            comprovante do aluno (abre pelo QR)
admin.html            painel de emissão (restrito por senha)
assets/css/usp.css    identidade visual compartilhada
assets/css/admin.css  estilos do painel
assets/js/core.js     criptografia, codificação do QR e utilitários
assets/js/aluno.js    verificação e exibição do comprovante
assets/js/admin.js    painel: formulário, carteirinha PNG, lote, histórico
assets/js/ia.js       integração com a IA (Claude)
assets/js/config.js   chave pública + chave privada cifrada (gerado pelo painel)
assets/js/revogados.js lista de documentos revogados
assets/img/           logotipo simplificado e ilustração do campus
```

Logotipo: `assets/img/logo-sup.png` é o original; `logo-usp.png` (branco) e `logo-usp-escuro.png` (azul-marinho) são versões transparentes geradas a partir dele.

Modo de exibição: em `config.js`, `modoDemonstracao: true` mostra a faixa "Protótipo" nas páginas públicas; `false` exibe o sistema como adotado.
