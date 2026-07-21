/**
 * src/user.js
 * ---------------------------------------------------------------------------
 * Regras de negócio: "o que perguntar" ao Microsoft Graph para responder
 * às perguntas do administrador (dados do usuário, roles e grupos).
 * ---------------------------------------------------------------------------
 */

const { graphGet, graphGetAllPages } = require('./graph');

/**
 * Busca um usuário no Microsoft Entra ID pelo UPN (User Principal Name,
 * geralmente igual ao e-mail corporativo).
 *
 * Endpoint: GET /users/{upn}
 * Permissão necessária: User.Read.All (Application)
 *
 * Usamos $select para trazer só os campos que precisamos — isso reduz o
 * payload e é a prática recomendada pela Microsoft (evita "over-fetching").
 *
 * @param {string} upn
 * @returns {Promise<object>} { id, displayName, mail, userPrincipalName }
 */
async function buscarUsuarioPorUpn(upn) {
  const campos = 'id,displayName,mail,userPrincipalName';
  // O UPN vai direto na URL do recurso (/users/{upn}), sem precisar de $filter.
  // encodeURIComponent protege contra caracteres especiais no e-mail.
  const usuario = await graphGet(`/users/${encodeURIComponent(upn)}`, {
    $select: campos,
  });

  return usuario;
}

/**
 * Obtém, em UMA ÚNICA chamada, todos os grupos (incluindo aninhados) E
 * todas as Directory Roles atribuídas ao usuário.
 *
 * Endpoint: GET /users/{id}/transitiveMemberOf
 * Permissões necessárias: Directory.Read.All (recomendado) ou, no mínimo,
 * GroupMember.Read.All + User.Read.All (Application).
 *
 * Por que "transitiveMemberOf" e não "memberOf"?
 * - memberOf retorna apenas associações DIRETAS.
 * - transitiveMemberOf retorna também associações INDIRETAS, ou seja,
 *   grupos aninhados (ex.: usuário está no grupo A, que é membro do
 *   grupo B → o usuário "herda" a associação com B). Isso reflete o
 *   acesso real do usuário, que é o que importa para uma auditoria de
 *   permissões.
 *
 * Por que uma única chamada para roles E grupos?
 * - O Graph retorna, na mesma coleção, objetos de tipos diferentes,
 *   diferenciados pelo campo "@odata.type":
 *     "#microsoft.graph.group"          -> grupo
 *     "#microsoft.graph.directoryRole"  -> role de diretório atribuída
 * - Isso evita uma segunda chamada (ex.: /users/{id}/appRoleAssignments
 *   ou /users/{id}/memberOf) só para pegar roles, economizando uma
 *   requisição HTTP e reduzindo o risco de throttling (429).
 *
 * @param {string} userId - Object ID do usuário
 * @returns {Promise<{roles: object[], grupos: object[]}>}
 */
async function obterRolesEGruposDoUsuario(userId) {
  const campos = 'id,displayName,groupTypes,securityEnabled,mailEnabled';

  // graphGetAllPages garante que, mesmo que o usuário pertença a centenas
  // de grupos (resposta paginada pelo Graph), todas as páginas sejam
  // percorridas via @odata.nextLink.
  const itens = await graphGetAllPages(`/users/${userId}/transitiveMemberOf`, {
    $select: campos,
  });

  const roles = itens.filter(
    (item) => item['@odata.type'] === '#microsoft.graph.directoryRole'
  );

  const grupos = itens.filter(
    (item) => item['@odata.type'] === '#microsoft.graph.group'
  );

  return { roles, grupos };
}

/**
 * Classifica o tipo "amigável" de um grupo com base nos campos
 * groupTypes / securityEnabled / mailEnabled retornados pelo Graph.
 *
 * Regras (conforme documentação da Microsoft):
 * - groupTypes contém "Unified"                         -> Microsoft 365 Group
 * - securityEnabled=true  e mailEnabled=false            -> Security Group
 * - securityEnabled=true  e mailEnabled=true (sem Unified)-> Mail-Enabled Security Group
 * - securityEnabled=false e mailEnabled=true (sem Unified)-> Distribution List
 *
 * @param {object} grupo
 * @returns {string} descrição do tipo do grupo
 */
function classificarTipoDeGrupo(grupo) {
  const groupTypes = grupo.groupTypes || [];

  if (groupTypes.includes('Unified')) {
    return 'Microsoft 365 Group';
  }

  if (grupo.securityEnabled && grupo.mailEnabled) {
    return 'Mail-Enabled Security Group';
  }

  if (grupo.securityEnabled && !grupo.mailEnabled) {
    return 'Security Group';
  }

  if (!grupo.securityEnabled && grupo.mailEnabled) {
    return 'Distribution List';
  }

  return 'Tipo desconhecido';
}

module.exports = {
  buscarUsuarioPorUpn,
  obterRolesEGruposDoUsuario,
  classificarTipoDeGrupo,
};
