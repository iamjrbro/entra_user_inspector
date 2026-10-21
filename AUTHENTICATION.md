# Cadastro, login local e Microsoft SSO

O dashboard e todas as rotas /api exigem autenticação. A página /login oferece Entrar, Criar conta e Entrar com Microsoft. A sessão dura oito horas e pode ser encerrada pelo botão Sair.

## Demonstração

Execute npm run demo, abra http://localhost:3000 e crie uma conta de teste em Criar conta. Use uma senha de 12 a 128 caracteres. O modo demo dispensa convite e, sem AUTH_ALLOWED_EMAILS, aceita qualquer e-mail para explorar apenas os dados fictícios. Não use senhas reais na demonstração.

## Contas locais em uso real

1. Configure APP_URL com a origem exata do dashboard (sem caminho). Use HTTPS em produção e NODE_ENV=production.
2. Liste os operadores em AUTH_ALLOWED_EMAILS, separados por vírgula. Sem essa lista, o servidor recusa iniciar no modo real.
3. Para cada novo operador, gere um convite aleatório e calcule seu SHA-256. O comando abaixo pode ser executado localmente pelo administrador:

       node -e "const c=require('node:crypto');const invite=c.randomBytes(32).toString('hex');console.log('Convite:',invite);console.log('Hash:',c.createHash('sha256').update(invite).digest('hex'))"

4. Configure AUTH_REGISTRATION_INVITES como um objeto JSON, associando cada e-mail (em minúsculas) ao hash:

       AUTH_REGISTRATION_INVITES={"operador@suaempresa.com":"<hash SHA-256 de 64 caracteres>"}

5. Envie o convite ao operador por um canal privado. O operador informa nome, e-mail, senha e convite em Criar conta. O código é vinculado ao e-mail; conhecer um e-mail autorizado não permite cadastrar-se sem o convite. Após a criação, o par e-mail/senha é suficiente para entrar. Remova o convite usado da configuração; a conta já criada continua funcionando.

As senhas usam scrypt com salt aleatório e não são armazenadas em texto puro. Sessões usam tokens aleatórios, com apenas o hash armazenado no SQLite e cookies HttpOnly, SameSite=Lax e Secure em HTTPS. O login rotaciona a sessão e Sair a invalida no servidor. Há limitação de tentativas, proteção de origem para POST e limite de tamanho das requisições.

Não há envio de e-mail, verificação por e-mail ou recuperação de senha nesta versão. A autorização de cadastro local é feita pelo convite do administrador.

## Login Microsoft

1. No Microsoft Entra ID, crie um App Registration com contas somente deste diretório organizacional.
2. Em Authentication, adicione uma plataforma Web e a Redirect URI exata:

       http://localhost:3000/auth/microsoft/callback

   Para produção, cadastre também a URL HTTPS do domínio, seguida de /auth/microsoft/callback. O valor deve corresponder a APP_URL.
3. Crie uma credencial do aplicativo e configure no servidor:

       AUTH_MICROSOFT_TENANT_ID=<Directory tenant ID>
       AUTH_MICROSOFT_CLIENT_ID=<Application client ID>
       AUTH_MICROSOFT_CLIENT_SECRET=<valor da credencial, nunca o ID>

4. Inclua os UPNs corporativos autorizados em AUTH_ALLOWED_EMAILS e reinicie o servidor. O login usa preferred_username (UPN), com fallback para email, retornados pelo Microsoft Entra ID.
5. Clique em Entrar com Microsoft. A conta local e o convite não são necessários nesse fluxo. O aplicativo valida o tenant, o operador autorizado, state, nonce e PKCE, antes de criar a sessão.

O SSO solicita apenas openid, profile e email. As permissões de consulta ao diretório continuam pertencendo ao App Registration de serviço original, com credencial lida do Azure Key Vault. Os dois fluxos têm configurações separadas. Não há vínculo automático entre uma conta local e uma conta Microsoft pelo endereço de e-mail.

A credencial SSO fica apenas no servidor (.env local ou secret da plataforma de hospedagem). Nunca a coloque no código, navegador, relatório ou Git. O botão Microsoft permanece visível e indisponível enquanto faltar configuração.

## Armazenamento e operação

AUTH_DATABASE_PATH define o SQLite local (padrão data/auth.sqlite). Persista esse diretório na hospedagem, restrinja o acesso aos arquivos e mantenha backups protegidos. data/ e arquivos SQLite são ignorados pelo Git. Esta implementação usa SQLite local e deve rodar em uma única instância de aplicação.

Para revogar acesso, remova o e-mail de AUTH_ALLOWED_EMAILS e reinicie o servidor; as sessões existentes também passam a ser recusadas. Cookies expiram em oito horas; sessões e estados OAuth expirados são removidos no atendimento de requisições.

Node.js 22.13+ é necessário pelo módulo node:sqlite. Os testes usam SQLite em memória e um cliente Microsoft simulado; nenhuma credencial real é usada.

Referência: https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests

Contas, sessões e estados OAuth de demonstração ficam em tabelas separadas dos dados de autenticação reais, mesmo se o caminho do banco for compartilhado.
