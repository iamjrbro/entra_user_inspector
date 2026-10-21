'use strict';
const $ = id => document.getElementById(id);
let registering = false, invitationRequired = false;
function mode(register) {
  registering = register;
  $('name-field').hidden = !register;
  $('invitation-field').hidden = !(register && invitationRequired);
  $('invitation').required = register && invitationRequired;
  $('name').required = register;
  $('password-hint').hidden = !register;
  $('password').minLength = register ? 12 : 1;
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('auth-title').textContent = register ? 'Crie sua conta' : 'Entre na sua conta';
  $('auth-description').textContent = register ? 'Use o e-mail autorizado pela sua organização.' : 'Acesse o dashboard para iniciar uma auditoria.';
  $('auth-submit').textContent = register ? 'Criar conta →' : 'Entrar no dashboard →';
  $('auth-message').textContent = '';
  for (const [id, active] of [['tab-login', !register], ['tab-register', register]]) {
    $(id).classList.toggle('selected', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
}
$('tab-login').addEventListener('click', () => mode(false));
$('tab-register').addEventListener('click', () => mode(true));
$('show-password').addEventListener('click', () => {
  const visible = $('password').type === 'password';
  $('password').type = visible ? 'text' : 'password';
  $('show-password').textContent = visible ? 'Ocultar' : 'Mostrar';
  $('show-password').setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
});
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const register = registering;
  const controls = ['auth-submit', 'tab-login', 'tab-register'].map($);
  controls.forEach(button => button.disabled = true);
  $('auth-message').textContent = register ? 'Criando sua conta…' : 'Entrando…';
  try {
    const response = await fetch(register ? '/auth/register' : '/auth/login', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: $('name').value, email: $('email').value, password: $('password').value, invitation: $('invitation').value})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    $('password').value = '';
    location.assign('/');
  } catch (error) { $('auth-message').textContent = error.message; }
  finally { controls.forEach(button => button.disabled = false); }
});
fetch('/auth/session').then(response => {
  if (!response.ok) throw new Error('Não foi possível verificar o login.');
  return response.json();
}).then(data => {
  invitationRequired = data.invitationRequired;
  mode(registering);
  if (data.user) { location.replace('/'); return; }
  if (!data.microsoft) {
    $('microsoft-signin').removeAttribute('href');
    $('microsoft-signin').setAttribute('aria-disabled', 'true');
    $('sso-status').textContent = 'Login Microsoft aguardando configuração pelo administrador.';
  }
  if (data.demo) $('auth-message').textContent = 'Demonstração: crie uma conta de teste para explorar dados fictícios.';
}).catch(error => { $('auth-message').textContent = error.message; });
