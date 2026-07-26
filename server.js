/**
 * src/server.js
 * ---------------------------------------------------------------------------
 * Servidor web (Express) que expõe a mesma lógica de negócio da CLI
 * (keyvault.js -> auth.js -> graph.js -> user.js) como uma API HTTP, e
 * serve o front-end estático (pasta /public) com a interface visual.
 *
 * Nenhuma regra de negócio mora aqui: este arquivo só faz "tradução" entre
 * requisição HTTP e as funções de src/user.js, e cuida de erros -> status
 * code. Isso é o que permite reaproveitar a CLI (src/app.js) e a Web API
 * a partir do mesmo núcleo, sem duplicar lógica.
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();

const path = require('path');
const express = require('express');

const {
  buscarUsuarioPorUpn,
  obterRolesEGruposDoUsuario,
  classificarTipoDeGrupo,
} = require('./user');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve os arquivos estáticos do front-end (HTML/CSS/JS) da pasta /public.
app.use(express.static(__dirname));
app.use(express.json());

// Mesma validação de formato usada na CLI, para dar feedback rápido sem
// gastar uma chamada de rede com um UPN obviamente inválido.
function upnPareceValido(upn) {
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regexEmail.test(upn);
}

/**
 * GET /api/user?upn=alguem@empresa.com
 * Retorna os dados do usuário, roles e grupos em JSON.
 */
app.get('/api/user', async (req, res) => {
  const upn = (req.query.upn || '').trim();

  if (!upn) {
    return res.status(400).json({ error: 'Informe o parâmetro "upn".' });
  }

  if (!upnPareceValido(upn)) {
    return res.status(400).json({ error: 'Formato de e-mail (UPN) inválido.' });
  }

  try {
    const usuario = await buscarUsuarioPorUpn(upn);
    const { roles, grupos } = await obterRolesEGruposDoUsuario(usuario.id);

    // Adiciona o "tipo amigável" de cada grupo antes de devolver ao
    // front-end, para a interface não precisar reimplementar essa regra.
    const gruposComTipo = grupos.map((grupo) => ({
      id: grupo.id,
      displayName: grupo.displayName,
      tipo: classificarTipoDeGrupo(grupo),
    }));

    const rolesFormatadas = roles.map((role) => ({
      id: role.id,
      displayName: role.displayName,
    }));

    res.json({
      usuario: {
        displayName: usuario.displayName,
        email: usuario.mail || usuario.userPrincipalName,
        objectId: usuario.id,
      },
      roles: rolesFormatadas,
      grupos: gruposComTipo,
      totais: {
        roles: rolesFormatadas.length,
        grupos: gruposComTipo.length,
      },
    });
  } catch (erro) {
    // erro.status vem de graph.js (traduzirErroGraph) quando o problema é
    // do Microsoft Graph; caso contrário (ex.: falha no Key Vault/MSAL),
    // usamos 500 como padrão.
    const status = erro.status || 500;
    res.status(status).json({ error: erro.message });
  }
});

// Qualquer rota não reconhecida como API cai no index.html (SPA simples).
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Entra User Inspector rodando em http://localhost:${PORT}`);
});