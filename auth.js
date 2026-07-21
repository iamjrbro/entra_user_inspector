/**
 * src/auth.js
 * ---------------------------------------------------------------------------
 * Responsável exclusivamente por obter um Access Token válido para o
 * Microsoft Graph, usando o fluxo "Client Credentials" (aplicação daemon,
 * sem interação do usuário).
 *
 * O Client Secret do App Registration NÃO fica no .env: ele é buscado em
 * tempo de execução no Azure Key Vault (ver src/keyvault.js). Aqui só
 * ficam TENANT_ID e CLIENT_ID, que não são segredos (identificam o app,
 * mas não autenticam sozinhos).
 *
 * Por que Client Credentials?
 * - O aplicativo roda no terminal/servidor, sem um usuário logado
 *   interativamente.
 * - Ele age "como aplicativo" (App-Only), usando as Application Permissions
 *   concedidas via Admin Consent no App Registration.
 * ---------------------------------------------------------------------------
 */

// Carrega as variáveis definidas no arquivo .env para process.env
require('dotenv').config();

// ConfidentialClientApplication é a classe do MSAL Node usada quando o
// aplicativo consegue guardar um segredo com segurança (server-side),
// diferente de um "public client" (SPA, app mobile) que não pode.
const { ConfidentialClientApplication } = require('@azure/msal-node');

// Busca o Client Secret no Azure Key Vault em vez de ler de variável
// de ambiente estática.
const { obterClientSecret } = require('./keyvault');

// -----------------------------------------------------------------------
// 1. Validação das variáveis de ambiente obrigatórias (não secretas)
// -----------------------------------------------------------------------
const { TENANT_ID, CLIENT_ID } = process.env;

function validarVariaveisDeAmbiente() {
  const faltando = [];
  if (!TENANT_ID) faltando.push('TENANT_ID');
  if (!CLIENT_ID) faltando.push('CLIENT_ID');

  if (faltando.length > 0) {
    throw new Error(
      `Variáveis de ambiente ausentes no .env: ${faltando.join(', ')}. ` +
      'Copie o arquivo .env.example para .env e preencha os valores.'
    );
  }
}

// -----------------------------------------------------------------------
// 2. Configuração e instância (assíncrona) do MSAL
// -----------------------------------------------------------------------
// Como o clientSecret agora vem de uma chamada assíncrona ao Key Vault,
// a criação do ConfidentialClientApplication também precisa ser assíncrona.
// Guardamos a Promise de inicialização (não o cliente em si) para garantir
// que, mesmo se getAccessToken() for chamado várias vezes "ao mesmo tempo",
// o Key Vault e o MSAL sejam inicializados apenas UMA vez (singleton).
let msalClientPromise = null;

async function criarMsalClient() {
  validarVariaveisDeAmbiente();

  // Busca o valor do secret no Key Vault (com cache interno em keyvault.js).
  const clientSecret = await obterClientSecret();

  // authority = endpoint do Azure AD específico do seu tenant.
  // Usar o tenant específico (em vez de "common") é a prática recomendada
  // para aplicações App-Only, pois evita ambiguidades de multi-tenant.
  const msalConfig = {
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret,
    },
  };

  return new ConfidentialClientApplication(msalConfig);
}

function obterMsalClient() {
  if (!msalClientPromise) {
    msalClientPromise = criarMsalClient();
  }
  return msalClientPromise;
}

/**
 * Obtém um Access Token válido para chamar o Microsoft Graph.
 *
 * O escopo "https://graph.microsoft.com/.default" instrui o Azure AD a
 * emitir um token contendo TODAS as Application Permissions que já
 * receberam Admin Consent no App Registration. É o padrão recomendado
 * para o fluxo Client Credentials (não se pede escopos individuais aqui).
 *
 * @returns {Promise<string>} accessToken
 */
async function getAccessToken() {
  const client = await obterMsalClient();

  const request = {
    scopes: ['https://graph.microsoft.com/.default'],
  };

  try {
    // acquireTokenByClientCredential faz a chamada OAuth2 client_credentials
    // ao endpoint /token do Azure AD e retorna o token (o MSAL também
    // cacheia o token em memória até ele expirar).
    const response = await client.acquireTokenByClientCredential(request);

    if (!response || !response.accessToken) {
      throw new Error('MSAL retornou uma resposta sem accessToken.');
    }

    return response.accessToken;
  } catch (erro) {
    // Erros comuns aqui: CLIENT_ID/TENANT_ID errado, secret expirado ou
    // incorreto no Key Vault, app registration deletado, etc.
    throw new Error(
      `Falha ao autenticar no Microsoft Entra ID (MSAL): ${erro.message}`
    );
  }
}

module.exports = { getAccessToken };
