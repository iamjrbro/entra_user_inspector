const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const failure = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createLoginAuth({ demo = false, env = process.env, databasePath, clientFactory } = {}) {
  const origin = new URL(env.APP_URL || 'http://localhost:3000').origin;
  const secure = origin.startsWith('https:');
  if (env.NODE_ENV === 'production' && !secure) throw new Error('APP_URL deve usar HTTPS em produção.');
  const allowed = (env.AUTH_ALLOWED_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!demo && !allowed.length) throw new Error('Configure AUTH_ALLOWED_EMAILS com os operadores autorizados.');
  let invitations;
  try { invitations = JSON.parse(env.AUTH_REGISTRATION_INVITES || '{}'); }
  catch { throw new Error('AUTH_REGISTRATION_INVITES deve ser um objeto JSON de hashes SHA-256.'); }
  if (!invitations || Array.isArray(invitations) || typeof invitations !== 'object' || Object.values(invitations).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('AUTH_REGISTRATION_INVITES inválido.');
  const tenant = env.AUTH_MICROSOFT_TENANT_ID || env.TENANT_ID;
  const clientId = env.AUTH_MICROSOFT_CLIENT_ID;
  const clientSecret = env.AUTH_MICROSOFT_CLIENT_SECRET;
  const microsoft = Boolean(tenant && clientId && clientSecret);
  if (microsoft && !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(tenant)) throw new Error('AUTH_MICROSOFT_TENANT_ID inválido.');
  const file = databasePath || env.AUTH_DATABASE_PATH || './data/auth.sqlite';
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Demo identities never become real operators when the application mode changes.
  const sql = statement => statement.replace(/\b(accounts|sessions|oauth)\b/g, name => demo ? 'demo_' + name : name);
  db.exec(sql(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, identity TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth (state TEXT PRIMARY KEY, browser TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);`));
  const attempts = new Map();
  let activeHashes = 0;
  const cookieName = secure ? '__Host-entra-session' : 'entra-session';
  const oauthCookie = secure ? '__Host-entra-oauth' : 'entra-oauth';
  const scopes = ['openid', 'profile', 'email'];
  const redirectUri = origin + '/auth/microsoft/callback';
  function cookie(req, name) {
    const parts = (req.headers.cookie || '').split(';').map(p => p.trim());
    return parts.find(p => p.startsWith(name + '='))?.slice(name.length + 1) || '';
  }
  function setCookie(res, name, token, age) {
    res.setHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
  }
  function permitted(email) { return allowed.includes(email.toLowerCase()) || (demo && !allowed.length); }
  function rate(req) {
    const now = Date.now(), key = req.socket.remoteAddress;
    for (const [id, row] of attempts) if (row.until < now) attempts.delete(id);
    const row = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
    if (++row.count > 20 || attempts.size > 10_000) throw failure(429, 'Muitas tentativas. Aguarde 15 minutos.');
    attempts.set(key, row);
  }
  async function passwordHash(password, salt) {
    if (activeHashes >= 4) throw failure(429, 'Servidor ocupado. Tente novamente em instantes.');
    activeHashes++;
    try { return await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
    finally { activeHashes--; }
  }
  async function body(req) {
    if (req.headers.origin !== origin) throw failure(403, 'Origem da requisição inválida.');
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw failure(415, 'Envie os dados em JSON.');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw failure(413, 'Dados muito grandes.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure(400, 'Dados inválidos.'); }
  }
  function credentials(data) {
    const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = data?.password;
    if (!emailPattern.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 128) throw failure(400, 'Informe e-mail e senha válidos.');
    return { email, password };
  }
  function startSession(res, identity) {
    const token = random();
    db.prepare(sql('INSERT INTO sessions VALUES (?,?,?)')).run(digest(token), JSON.stringify(identity), Date.now() + 8 * 3600_000);
    setCookie(res, cookieName, token, 8 * 3600);
  }
  function session(req) {
    const token = cookie(req, cookieName);
    if (!/^[\da-f]{64}$/.test(token)) return null;
    const row = db.prepare(sql('SELECT identity FROM sessions WHERE token=? AND expires>?')).get(digest(token), Date.now());
    if (!row) return null;
    const identity = JSON.parse(row.identity);
    return permitted(identity.email) ? identity : null;
  }
  function msal() {
    if (clientFactory) return clientFactory();
    const { ConfidentialClientApplication } = require('@azure/msal-node');
    return new ConfidentialClientApplication({ auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenant}` } });
  }
  async function handle(req, res, url, json) {
    db.prepare(sql('DELETE FROM sessions WHERE expires<?')).run(Date.now());
    db.prepare(sql('DELETE FROM oauth WHERE expires<?')).run(Date.now());
    if (url.pathname === '/auth/session' && req.method === 'GET') {
      json(200, { user: session(req), microsoft, demo, invitationRequired: !demo }); return true;
    }
    if (['/auth/register', '/auth/login', '/auth/logout'].includes(url.pathname) && req.method === 'POST') {
      rate(req);
      const data = await body(req);
      if (url.pathname === '/auth/logout') {
        db.prepare(sql('DELETE FROM sessions WHERE token=?')).run(digest(cookie(req, cookieName)));
        setCookie(res, cookieName, '', 0); json(200, { ok: true }); return true;
      }
      const { email, password } = credentials(data);
      if (url.pathname === '/auth/register') {
        const name = typeof data.name === 'string' ? data.name.trim() : '';
        if (!name || name.length > 100 || password.length < 12) throw failure(400, 'Informe seu nome e uma senha de 12 a 128 caracteres.');
        if (!permitted(email)) throw failure(403, 'Peça ao administrador para autorizar seu e-mail.');
        if (!demo && (typeof data.invitation !== 'string' || data.invitation.length > 256 || !equal(digest(data.invitation), invitations[email]))) throw failure(403, 'Convite inválido. Solicite ao administrador um convite para seu e-mail.');
        const salt = random(), hash = await passwordHash(password, salt);
        try { db.prepare(sql('INSERT INTO accounts VALUES (?,?,?,?)')).run(email, name, salt, hash.toString('hex')); }
        catch (error) {
          if (error.code === 'ERR_SQLITE_ERROR' && db.prepare(sql('SELECT 1 FROM accounts WHERE email=?')).get(email)) throw failure(409, 'Não foi possível criar a conta. Tente entrar ou contate o administrador.');
          throw error;
        }
        db.prepare(sql('DELETE FROM sessions WHERE token=?')).run(digest(cookie(req, cookieName)));
        startSession(res, { email, name, provider: 'local' }); json(201, { ok: true }); return true;
      }
      const account = db.prepare(sql('SELECT * FROM accounts WHERE email=?')).get(email);
      const hash = await passwordHash(password, account?.salt || 'missing-account-dummy-salt');
      if (!account || !equal(hash.toString('hex'), account.hash) || !permitted(email)) throw failure(401, 'E-mail ou senha inválidos.');
      db.prepare(sql('DELETE FROM sessions WHERE token=?')).run(digest(cookie(req, cookieName)));
      startSession(res, { email, name: account.name, provider: 'local' }); json(200, { ok: true }); return true;
    }
    if (url.pathname === '/auth/microsoft' && req.method === 'GET') {
      rate(req);
      if (!microsoft) throw failure(503, 'O administrador precisa configurar o login Microsoft.');
      const state = random(), browser = random(), nonce = random();
      const { CryptoProvider } = require('@azure/msal-node');
      const pkce = await new CryptoProvider().generatePkceCodes();
      const location = await msal().getAuthCodeUrl({ scopes, redirectUri, state, nonce, codeChallenge: pkce.challenge, codeChallengeMethod: 'S256' });
      db.prepare(sql('INSERT INTO oauth VALUES (?,?,?,?,?)')).run(digest(state), digest(browser), nonce, pkce.verifier, Date.now() + 600_000);
      setCookie(res, oauthCookie, browser, 600);
      res.writeHead(302, { Location: location }); res.end(); return true;
    }
    if (url.pathname === '/auth/microsoft/callback' && req.method === 'GET') {
      rate(req);
      const state = url.searchParams.get('state') || '';
      const pending = db.prepare(sql('SELECT * FROM oauth WHERE state=?')).get(digest(state));
      db.prepare(sql('DELETE FROM oauth WHERE state=?')).run(digest(state));
      setCookie(res, oauthCookie, '', 0);
      const code = url.searchParams.get('code');
      if (!microsoft || !pending || pending.expires < Date.now() || !equal(pending.browser, digest(cookie(req, oauthCookie))) || !code) throw failure(400, 'Login Microsoft inválido ou expirado. Inicie novamente.');
      let result;
      try { result = await msal().acquireTokenByCode({ code, scopes, redirectUri, codeVerifier: pending.verifier }); }
      catch { throw failure(401, 'Não foi possível concluir o login Microsoft. Tente novamente.'); }
      const claims = result?.idTokenClaims;
      const email = (claims?.preferred_username || claims?.email || '').toLowerCase();
      if (!claims?.oid || !equal(claims.nonce, pending.nonce) || claims.tid?.toLowerCase() !== tenant.toLowerCase() || result.account?.tenantId?.toLowerCase() !== tenant.toLowerCase() || !permitted(email)) throw failure(403, 'Conta Microsoft ou tenant não autorizado.');
      db.prepare(sql('DELETE FROM sessions WHERE token=?')).run(digest(cookie(req, cookieName)));
      startSession(res, { email, name: claims.name || email, provider: 'microsoft', oid: claims.oid, tenant: claims.tid });
      // Clear the OAuth cookie as well as setting the authenticated session cookie.
      res.setHeader('Set-Cookie', [res.getHeader('Set-Cookie'), `${oauthCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`]);
      res.writeHead(302, { Location: '/' }); res.end(); return true;
    }
    return false;
  }
  return { handle, session, close: () => db.close() };
}
module.exports = { createLoginAuth };
