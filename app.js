/**
 * src/app.js
 * ---------------------------------------------------------------------------
 * /**
 * src/app.js
 * ---------------------------------------------------------------------------
 * Ponto de entrada do aplicativo (CLI). Responsável por:
 *  1. Ler o UPN digitado pelo administrador no terminal.
 *  2. Orquestrar as chamadas aos módulos user.js/graph.js/auth.js.
 *  3. Formatar e exibir o resultado no console.
 *
 * Execução: npm start
 * ---------------------------------------------------------------------------
 */

const readline = require('readline');
const {
  buscarUsuarioPorUpn,
  obterRolesEGruposDoUsuario,
  classificarTipoDeGrupo,
} = require('./user');

// readline é o módulo nativo do Node para ler entrada do terminal (CMD),
// sem precisar de nenhuma dependência externa para isso.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Faz uma pergunta no terminal e retorna a resposta digitada como Promise,
 * já que readline por padrão usa callback.
 */
function perguntar(pergunta) {
  return new Promise((resolve) => {
    rl.question(pergunta, (resposta) => resolve(resposta.trim()));
  });
}

/**
 * Validação simples de formato de e-mail/UPN antes de gastar uma chamada
 * de rede — feedback mais rápido para o administrador em caso de erro
 * de digitação.
 */
function upnPareceValido(upn) {
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regexEmail.test(upn);
}

/**
 * Imprime o cabeçalho/rodapé de seção no formato solicitado.
 */
function imprimirSecao(titulo) {
  const linha = '='.repeat(40);
  console.log(`\n${linha}`);
  console.log(titulo);
  console.log(linha);
}

function imprimirSubSecao(titulo) {
  const linha = '-'.repeat(40);
  console.log(`\n${titulo}`);
  console.log(linha);
}

/**
 * Exibe o resultado final formatado, igual ao layout de exemplo solicitado.
 */
function exibirResultado(usuario, roles, grupos) {
  imprimirSecao('User Information');
  console.log(`Name: ${usuario.displayName || '(não informado)'}`);
  console.log(`Email: ${usuario.mail || usuario.userPrincipalName}`);
  console.log(`Object ID: ${usuario.id}`);

  imprimirSubSecao('Directory Roles');
  if (roles.length === 0) {
    console.log('(Nenhuma Directory Role atribuída)');
  } else {
    roles.forEach((role) => console.log(`- ${role.displayName}`));
  }

  imprimirSubSecao('Group Membership');
  if (grupos.length === 0) {
    console.log('(Usuário não pertence a nenhum grupo)');
  } else {
    grupos.forEach((grupo) => {
      const tipo = classificarTipoDeGrupo(grupo);
      console.log(`- ${grupo.displayName} (${tipo})`);
    });
  }

  console.log(`\nTotal Roles: ${roles.length}`);
  console.log(`Total Groups: ${grupos.length}`);
}

/**
 * Fluxo principal do programa.
 */
async function main() {
  console.log('========================================');
  console.log('Entra ID - Consulta de Permissões de Usuário');
  console.log('========================================');

  const upn = await perguntar('\nDigite o e-mail (UPN) do colaborador: ');

  if (!upnPareceValido(upn)) {
    console.error('\n[ERRO] Formato de e-mail inválido. Encerrando.');
    rl.close();
    process.exitCode = 1;
    return;
  }

  try {
    console.log('\nBuscando usuário no Microsoft Entra ID...');
    const usuario = await buscarUsuarioPorUpn(upn);

    console.log('Obtendo grupos e roles atribuídas...');
    const { roles, grupos } = await obterRolesEGruposDoUsuario(usuario.id);

    exibirResultado(usuario, roles, grupos);
  } catch (erro) {
    // Toda a tradução de erros HTTP (401/403/404/429) já acontece em
    // graph.js; aqui só exibimos a mensagem já formatada.
    console.error(`\n[ERRO] ${erro.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main();

 *
 * Execução: npm start
 * ---------------------------------------------------------------------------
 */

const readline = require('readline');
const {
  buscarUsuarioPorUpn,
  obterRolesEGruposDoUsuario,
  classificarTipoDeGrupo,
} = require('./user');

// readline é o módulo nativo do Node para ler entrada do terminal (CMD),
// sem precisar de nenhuma dependência externa para isso.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Faz uma pergunta no terminal e retorna a resposta digitada como Promise,
 * já que readline por padrão usa callback.
 */
function perguntar(pergunta) {
  return new Promise((resolve) => {
    rl.question(pergunta, (resposta) => resolve(resposta.trim()));
  });
}

/**
 * Validação simples de formato de e-mail/UPN antes de gastar uma chamada
 * de rede — feedback mais rápido para o administrador em caso de erro
 * de digitação.
 */
function upnPareceValido(upn) {
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regexEmail.test(upn);
}

/**
 * Imprime o cabeçalho/rodapé de seção no formato solicitado.
 */
function imprimirSecao(titulo) {
  const linha = '='.repeat(40);
  console.log(`\n${linha}`);
  console.log(titulo);
  console.log(linha);
}

function imprimirSubSecao(titulo) {
  const linha = '-'.repeat(40);
  console.log(`\n${titulo}`);
  console.log(linha);
}

/**
 * Exibe o resultado final formatado, igual ao layout de exemplo solicitado.
 */
function exibirResultado(usuario, roles, grupos) {
  imprimirSecao('User Information');
  console.log(`Name: ${usuario.displayName || '(não informado)'}`);
  console.log(`Email: ${usuario.mail || usuario.userPrincipalName}`);
  console.log(`Object ID: ${usuario.id}`);

  imprimirSubSecao('Directory Roles');
  if (roles.length === 0) {
    console.log('(Nenhuma Directory Role atribuída)');
  } else {
    roles.forEach((role) => console.log(`- ${role.displayName}`));
  }

  imprimirSubSecao('Group Membership');
  if (grupos.length === 0) {
    console.log('(Usuário não pertence a nenhum grupo)');
  } else {
    grupos.forEach((grupo) => {
      const tipo = classificarTipoDeGrupo(grupo);
      console.log(`- ${grupo.displayName} (${tipo})`);
    });
  }

  console.log(`\nTotal Roles: ${roles.length}`);
  console.log(`Total Groups: ${grupos.length}`);
}

/**
 * Fluxo principal do programa.
 */
async function main() {
  console.log('========================================');
  console.log('Entra ID - Consulta de Permissões de Usuário');
  console.log('========================================');

  const upn = await perguntar('\nDigite o e-mail (UPN) do colaborador: ');

  if (!upnPareceValido(upn)) {
    console.error('\n[ERRO] Formato de e-mail inválido. Encerrando.');
    rl.close();
    process.exitCode = 1;
    return;
  }

  try {
    console.log('\nBuscando usuário no Microsoft Entra ID...');
    const usuario = await buscarUsuarioPorUpn(upn);

    console.log('Obtendo grupos e roles atribuídas...');
    const { roles, grupos } = await obterRolesEGruposDoUsuario(usuario.id);

    exibirResultado(usuario, roles, grupos);
  } catch (erro) {
    // Toda a tradução de erros HTTP (401/403/404/429) já acontece em
    // graph.js; aqui só exibimos a mensagem já formatada.
    console.error(`\n[ERRO] ${erro.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main();
