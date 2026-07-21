/**
 * src/graph.js
 * ---------------------------------------------------------------------------
 * Camada fina de acesso HTTP ao Microsoft Graph.
 * Não conhece "usuário", "grupo" ou "role" — apenas sabe fazer requisições
 * GET autenticadas e traduzir erros HTTP em mensagens compreensíveis.
 * Isso mantém user.js focado em regras de negócio (o que perguntar ao
 * Graph), e graph.js focado em "como" perguntar.
 * ---------------------------------------------------------------------------
 */

const axios = require('axios');
const { getAccessToken } = require('./auth');

// Endpoint base do Microsoft Graph, versão estável (v1.0).
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Executa um GET autenticado contra o Microsoft Graph.
 *
 * @param {string} path - Caminho relativo, ex: "/users/joao@contoso.com"
 * @param {object} [params] - Query params opcionais (ex.: $select, $filter)
 * @returns {Promise<object>} corpo da resposta (JSON já parseado)
 */
async function graphGet(path, params = {}) {
  const accessToken = await getAccessToken();

  try {
    const response = await axios.get(`${GRAPH_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      params,
    });

    return response.data;
  } catch (erro) {
    throw traduzirErroGraph(erro, path);
  }
}

/**
 * Segue manualmente o link @odata.nextLink para buscar TODAS as páginas
 * de uma coleção (o Graph pagina resultados grandes, ex.: muitos grupos).
 *
 * @param {string} path - Caminho inicial relativo
 * @param {object} [params] - Query params da primeira página
 * @returns {Promise<object[]>} lista completa (todas as páginas concatenadas)
 */
async function graphGetAllPages(path, params = {}) {
  const accessToken = await getAccessToken();
  let url = `${GRAPH_BASE_URL}${path}`;
  let currentParams = params;
  const itens = [];

  try {
    while (url) {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        // params só se aplica na primeira chamada; o nextLink já vem
        // com a query string completa embutida.
        params: currentParams,
      });

      const data = response.data;
      if (Array.isArray(data.value)) {
        itens.push(...data.value);
      }

      url = data['@odata.nextLink'] || null;
      currentParams = undefined; // evita duplicar params ao seguir o nextLink
    }

    return itens;
  } catch (erro) {
    throw traduzirErroGraph(erro, path);
  }
}

/**
 * Converte erros do Axios/Graph em mensagens claras, mapeando os códigos
 * HTTP mais comuns retornados pelo Microsoft Graph.
 */
function traduzirErroGraph(erro, path) {
  if (!erro.response) {
    // Erro de rede (sem resposta do servidor): DNS, timeout, sem internet...
    return new Error(
      `Erro de rede ao chamar o Microsoft Graph (${path}): ${erro.message}`
    );
  }

  const status = erro.response.status;
  const graphError = erro.response.data && erro.response.data.error;
  const codigo = graphError ? graphError.code : 'desconhecido';
  const mensagem = graphError ? graphError.message : erro.message;

  const mapa = {
    400: 'Requisição inválida (Bad Request). Verifique parâmetros/UPN informado.',
    401: 'Não autorizado (401). O token é inválido, expirou ou não foi enviado. Verifique CLIENT_ID/CLIENT_SECRET/TENANT_ID.',
    403: 'Acesso negado (403). O App Registration não tem a Application Permission necessária, ou o Admin Consent não foi concedido.',
    404: 'Recurso não encontrado (404). O usuário informado (UPN) não existe no tenant.',
    429: 'Limite de requisições excedido (429 - Too Many Requests). Aguarde e tente novamente (throttling do Graph).',
  };

  const explicacao = mapa[status] || `Erro HTTP ${status} retornado pelo Microsoft Graph.`;

  return new Error(
    `${explicacao}\nEndpoint: ${path}\nCódigo Graph: ${codigo}\nMensagem Graph: ${mensagem}`
  );
}

module.exports = { graphGet, graphGetAllPages };
