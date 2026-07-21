/**
 * src/keyvault.js
 * ---------------------------------------------------------------------------
 * Responsável por obter, com segurança, o valor do Client Secret do App
 * Registration a partir do Azure Key Vault — em vez de guardá-lo em texto
 * puro no .env ou em variáveis de ambiente do servidor.
 *
 * Autenticação no Key Vault:
 * Usamos DefaultAzureCredential (@azure/identity), que tenta, em ordem,
 * várias formas de identidade SEM exigir nenhum segredo novo no código:
 *   - Managed Identity (quando rodando no Azure: Web App, Container Apps, VM...)
 *   - Azure CLI (`az login`) quando rodando localmente na máquina do dev
 *   - Variáveis de ambiente AZURE_CLIENT_ID/AZURE_TENANT_ID/AZURE_CLIENT_SECRET
 *     (se você optar por um Service Principal dedicado só para o Key Vault)
 *   - Visual Studio Code / outras credenciais de desenvolvimento
 *
 * Ou seja: o CLIENT_SECRET do App Registration usado no Microsoft Graph
 * NUNCA fica em arquivo, em variável de ambiente estática, nem em nenhum
 * repositório de código — apenas a identidade de quem/o que está rodando
 * o programa precisa ter permissão de LEITURA no Key Vault.
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();

const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

const { KEYVAULT_URI, CLIENT_SECRET_NAME } = process.env;

function validarVariaveisDeAmbiente() {
  const faltando = [];
  if (!KEYVAULT_URI) faltando.push('KEYVAULT_URI');
  if (!CLIENT_SECRET_NAME) faltando.push('CLIENT_SECRET_NAME');

  if (faltando.length > 0) {
    throw new Error(
      `Variáveis de ambiente ausentes no .env: ${faltando.join(', ')}. ` +
      'Copie o arquivo .env.example para .env e preencha os valores.'
    );
  }
}

// Cliente do Key Vault e cache do secret em memória (singleton por processo).
// Buscar o secret uma única vez evita chamadas repetidas desnecessárias ao
// Key Vault a cada requisição/execução do token.
let secretClient = null;
let clientSecretCache = null;

function obterSecretClient() {
  if (!secretClient) {
    validarVariaveisDeAmbiente();
    // DefaultAzureCredential detecta automaticamente o melhor mecanismo de
    // autenticação disponível no ambiente atual (ver comentário acima).
    const credential = new DefaultAzureCredential();
    secretClient = new SecretClient(KEYVAULT_URI, credential);
  }
  return secretClient;
}

/**
 * Retorna o valor atual do Client Secret armazenado no Key Vault.
 * Sempre busca a versão mais recente do secret (o SecretClient.getSecret,
 * sem especificar versão, já traz a versão "current"/ativa).
 *
 * @returns {Promise<string>} valor do secret
 */
async function obterClientSecret() {
  if (clientSecretCache) {
    return clientSecretCache;
  }

  const client = obterSecretClient();

  try {
    const secret = await client.getSecret(CLIENT_SECRET_NAME);

    if (!secret || !secret.value) {
      throw new Error('O secret retornado pelo Key Vault está vazio.');
    }

    clientSecretCache = secret.value;
    return clientSecretCache;
  } catch (erro) {
    throw new Error(
      `Falha ao obter o secret "${CLIENT_SECRET_NAME}" do Key Vault ` +
      `(${KEYVAULT_URI}): ${erro.message}`
    );
  }
}

module.exports = { obterClientSecret };
