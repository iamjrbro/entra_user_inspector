# Entra User Inspector

CLI em Node.js para consultar, no Microsoft Entra ID (Azure AD), os dados
básicos, as **Directory Roles** e os **grupos** (com tipo) de um usuário,
usando **Microsoft Graph** com autenticação **App-Only** (MSAL + Client
Credentials).

O **Client Secret** do App Registration não fica em nenhum arquivo `.env`
nem em texto puro: ele é armazenado no **Azure Key Vault** e buscado em
tempo de execução usando a identidade de quem/o que roda o programa
(Managed Identity no Azure, ou a sua conta via `az login` localmente).

```
========================================
User Information
========================================
Name: John Doe
Email: john.doe@contoso.com
Object ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Directory Roles
----------------------------------------
- Global Reader
- Security Reader

Group Membership
----------------------------------------
- Finance (Security Group)
- HR Team (Microsoft 365 Group)
- All Employees (Microsoft 365 Group)

Total Roles: 2
Total Groups: 3
```

---

## Índice

1. [Arquitetura e decisões técnicas](#1-arquitetura-e-decisões-técnicas)
2. [Passo a passo no Microsoft Entra ID](#2-passo-a-passo-no-microsoft-entra-id)
3. [Passo a passo no Azure Key Vault](#3-passo-a-passo-no-azure-key-vault)
4. [Configurar e rodar o projeto localmente](#4-configurar-e-rodar-o-projeto-localmente)
5. [Testar cada etapa antes de avançar](#5-testar-cada-etapa-antes-de-avançar)
6. [Interpretando erros comuns](#6-interpretando-erros-comuns)
7. [Deploy no Azure Web App + Azure DevOps](#7-deploy-no-azure-web-app--azure-devops)

---

## 1. Arquitetura e decisões técnicas

```
/src
  keyvault.js -> Busca o Client Secret no Azure Key Vault
  auth.js     -> Obtém o Access Token (MSAL, Client Credentials)
  graph.js    -> Camada HTTP genérica para o Microsoft Graph (axios)
  user.js     -> Regras de negócio: busca usuário, roles, grupos, tipo de grupo
  app.js      -> Interface de terminal (readline) que orquestra tudo
.env.example
package.json
```

**Por que separar em 5 módulos?**
Cada um tem uma única responsabilidade (Single Responsibility Principle):
`keyvault.js` só sabe buscar um secret no Key Vault; `auth.js` não sabe o
que é um "usuário"; `graph.js` não sabe o que é uma "role"; `user.js` não
sabe nada de HTTP; `app.js` não sabe nada de Graph. Isso facilita testar,
reaproveitar (ex.: você pode plugar `user.js` numa API REST no futuro) e
depurar erros isoladamente — inclusive separa claramente "problema de
Key Vault" de "problema de Microsoft Graph" quando algo falha.

**Por que o Client Secret vai para o Key Vault em vez do `.env`?**
- Em produção (Azure Web App), variáveis de ambiente/Application Settings
  ficam visíveis para qualquer pessoa com acesso de "Contributor" ao
  recurso, e podem vazar em logs, backups ou exports do ARM template.
  O Key Vault centraliza o segredo, aplica controle de acesso granular
  (RBAC), versionamento e auditoria (quem leu o secret e quando).
- Com **Managed Identity**, o Web App nem precisa de credencial nenhuma
  para se autenticar no Key Vault — a identidade é gerenciada pelo
  próprio Azure. Ou seja, o único "segredo" que resta no sistema fica
  dentro do Key Vault, nunca em código, `.env` ou pipeline.
- `DefaultAzureCredential` (pacote `@azure/identity`) abstrai isso: o
  mesmo código funciona local (via `az login`) e em produção (via
  Managed Identity), sem `if`s de ambiente no seu código.

**Por que Client Credentials (App-Only) e não Authorization Code?**
Porque quem roda o programa é um **administrador operando uma ferramenta
interna**, não um usuário final se autenticando interativamente. Client
Credentials usa as permissões do **aplicativo em si** (Application
Permissions), concedidas uma única vez via Admin Consent — sem exigir
login/senha do administrador toda vez que a ferramenta rodar. É o mesmo
padrão do seu Enterprise App Monitor.

**Por que `transitiveMemberOf` em vez de `memberOf` + outra chamada para roles?**
- `memberOf` retorna apenas associações **diretas**. Se o usuário está no
  Grupo A, e o Grupo A é membro do Grupo B, `memberOf` não mostra o Grupo B.
  `transitiveMemberOf` mostra — e isso é o que realmente representa o
  acesso herdado do usuário, essencial numa auditoria de permissões.
- O endpoint `/users/{id}/transitiveMemberOf` retorna, na mesma resposta,
  tanto objetos `#microsoft.graph.group` quanto
  `#microsoft.graph.directoryRole`. Ou seja, **uma única chamada HTTP**
  resolve roles e grupos ao mesmo tempo — menos chamadas, menos risco de
  atingir o limite de requisições (429), mais rápido.

---

## 2. Passo a passo no Microsoft Entra ID

> Faça isso antes de tocar em qualquer linha de código. O aplicativo não
> funciona sem essa configuração.

### 2.1. Criar o App Registration

1. Acesse [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID**.
2. No menu lateral, clique em **Registros de aplicativo** (*App registrations*)
   → **+ Novo registro**.
3. Preencha:
   - **Nome**: `entra-user-inspector` (ou o nome que preferir).
   - **Tipos de conta com suporte**: "Somente contas neste diretório
     organizacional" (single-tenant) — é o cenário mais comum e seguro
     para ferramentas internas.
   - **URI de redirecionamento**: deixe em branco (não é necessário para
     Client Credentials, já que não há login interativo).
4. Clique em **Registrar**.

**Por quê:** o App Registration é a "identidade" que o Microsoft Entra ID
usa para reconhecer seu aplicativo e decidir o que ele pode ou não acessar
via Graph.

### 2.2. Anotar os IDs

Na página **Visão geral** do App Registration recém-criado, copie:
- **ID do aplicativo (cliente)** → vai para `CLIENT_ID`.
- **ID do diretório (locatário)** → vai para `TENANT_ID`.

### 2.3. Criar o Client Secret

1. No menu lateral do App Registration, clique em **Certificados e segredos**
   (*Certificates & secrets*).
2. Aba **Segredos do cliente** → **+ Novo segredo do cliente**.
3. Dê uma descrição (ex.: `secret-inspector-2026`) e escolha uma validade
   (ex.: 6 ou 12 meses — evite "Nunca expira" por segurança).
4. Clique em **Adicionar**.
5. **Copie imediatamente o campo "Valor"** (não o "ID do Segredo") — ele
   só é exibido uma vez. Esse valor vai para `CLIENT_SECRET`.

**Por quê:** o Client Secret é a "senha" do aplicativo, usada no fluxo
Client Credentials para provar ao Azure AD que a requisição realmente vem
do seu App Registration.

### 2.4. Configurar as API Permissions (Application Permissions)

1. No menu lateral, clique em **Permissões de API** (*API permissions*).
2. **+ Adicionar uma permissão** → **Microsoft Graph** → **Permissões de
   aplicativo** (**Application permissions** — não "Delegated permissions",
   pois não há usuário logado).
3. Adicione as seguintes permissões:

| Permissão | Por que é necessária |
|---|---|
| `User.Read.All` | Ler o perfil do usuário pesquisado (nome, e-mail, Object ID) via `GET /users/{upn}`. |
| `Directory.Read.All` | Ler grupos e Directory Roles do usuário via `GET /users/{id}/transitiveMemberOf`. É a permissão recomendada para esse endpoint pois cobre tanto grupos quanto roles de diretório com uma única concessão. |

> **Alternativa de menor privilégio:** se sua política de segurança exige o
> mínimo possível, você pode usar `GroupMember.Read.All` no lugar de
> `Directory.Read.All` — porém `GroupMember.Read.All` cobre apenas grupos;
> as Directory Roles retornadas por `transitiveMemberOf` podem exigir
> `Directory.Read.All` para serem lidas de forma consistente em todos os
> tenants. Por isso este projeto usa `Directory.Read.All`.

4. Clique em **Adicionar permissões**.

### 2.5. Conceder o Admin Consent

1. Ainda em **Permissões de API**, clique em **Conceder consentimento de
   administrador para [seu tenant]** (*Grant admin consent*).
2. Confirme.
3. O status de todas as permissões deve mudar para um ícone verde de "check"
   (Concedido).

**Por quê:** Application Permissions **sempre** exigem consentimento de um
Administrador Global (ou Privileged Role Administrator) do tenant, pois
concedem acesso amplo, sem depender de um usuário logado. Sem esse passo,
toda chamada ao Graph retornará **403 Forbidden**.

---

## 3. Passo a passo no Azure Key Vault

### 3.1. Criar o Key Vault

1. No [portal.azure.com](https://portal.azure.com), busque **Key Vaults**
   → **+ Criar**.
2. Preencha grupo de recursos, região e um **nome único** (ex.:
   `kv-entra-inspector-prod`).
3. Na aba **Controle de acesso** (*Access configuration*), escolha o
   modelo de permissão **Azure role-based access control (RBAC)** — é a
   opção recomendada pela Microsoft atualmente (mais granular e auditável
   do que o modelo antigo de "Access policies").
4. Clique em **Revisar + criar** → **Criar**.

**Por quê:** o Key Vault é o cofre gerenciado que vai guardar o Client
Secret com criptografia, controle de acesso e histórico de versões,
separado do App Registration e do código.

### 3.2. Guardar o Client Secret dentro do Key Vault

1. Abra o Key Vault criado → menu lateral **Segredos** (*Objects > Secrets*)
   → **+ Gerar/Importar**.
2. Preencha:
   - **Nome**: um nome descritivo, ex. `entra-user-inspector-client-secret`
     (esse é o valor que vai em `CLIENT_SECRET_NAME` no `.env`).
   - **Valor**: cole aqui o **Valor do client secret** gerado no passo
     2.3 do App Registration (não o "ID do Segredo").
3. Clique em **Criar**.

**Importante:** depois de salvo no Key Vault, você pode (e deve) apagar
qualquer cópia do secret que tenha ficado em anotações, chats ou arquivos
de texto locais — o Key Vault passa a ser a única fonte confiável dele.

### 3.3. Conceder acesso de LEITURA ao Key Vault

Quem/o que vai rodar o aplicativo precisa da permissão de **ler** secrets
(nunca de gerenciar o Key Vault inteiro). No modelo RBAC:

1. No Key Vault → **Controle de acesso (IAM)** → **+ Adicionar** →
   **Adicionar atribuição de função**.
2. Função (*Role*): **Key Vault Secrets User** — permite apenas `GET`/`LIST`
   em secrets, nada de criar, apagar ou gerenciar o cofre. É o princípio
   de menor privilégio aplicado também aqui.
3. Atribuir acesso a:
   - **Localmente (desenvolvimento):** seu próprio usuário do Entra ID
     (o mesmo que você usa no `az login`).
   - **Em produção (Azure Web App):** a **Managed Identity** do Web App
     (ver seção 7 — Deploy).
4. Selecione o membro correspondente e clique em **Revisar + atribuir**.

**Por quê:** isso substitui a necessidade de qualquer credencial extra no
código — o `DefaultAzureCredential` do `@azure/identity` detecta
automaticamente essa identidade (sua conta local, ou a Managed Identity em
produção) e a usa para autenticar no Key Vault.

### 3.4. Testar o acesso localmente com Azure CLI

Antes de rodar o Node.js, confirme que a sua sessão local consegue ler o
Key Vault:

```bash
az login
az keyvault secret show --vault-name <nome-do-keyvault> --name <CLIENT_SECRET_NAME> --query value -o tsv
```

- **Sucesso esperado**: o valor do secret é impresso no terminal.
- Se der erro de permissão aqui, o problema é a atribuição de RBAC do
  passo 3.3 (pode levar alguns minutos para propagar após atribuída).

---

## 4. Configurar e rodar o projeto localmente

### 4.1. Preencher o `.env`

```bash
cp .env.example .env
```

Edite `.env` com os valores dos passos 2.2 e 3.1/3.2 (repare que **não há
mais `CLIENT_SECRET`** — o segredo fica só no Key Vault):

```
TENANT_ID=<ID do diretório (locatário)>
CLIENT_ID=<ID do aplicativo (cliente)>
KEYVAULT_URI=https://<nome-do-keyvault>.vault.azure.net/
CLIENT_SECRET_NAME=entra-user-inspector-client-secret
```

### 4.2. Autenticar sua sessão local no Azure (para acessar o Key Vault)

```bash
az login
```

Isso é o que permite ao `DefaultAzureCredential` usar sua própria conta do
Entra ID (já autorizada no passo 3.3) para ler o secret — sem precisar de
nenhuma outra credencial no seu computador.

### 4.3. Instalar as dependências

```bash
npm install
```

Isso instala:
- `@azure/msal-node` — biblioteca oficial da Microsoft para autenticação no Graph.
- `@azure/identity` — resolve a identidade (Managed Identity / Azure CLI / etc.) para autenticar no Key Vault.
- `@azure/keyvault-secrets` — cliente oficial para ler secrets do Key Vault.
- `axios` — cliente HTTP para chamar o Microsoft Graph.
- `dotenv` — carrega o arquivo `.env` para `process.env`.

### 4.4. Executar o aplicativo

```bash
npm start
```

O terminal vai pedir o e-mail (UPN) do colaborador e exibir o resultado
formatado.

---

## 5. Testar cada etapa antes de avançar

Não pule etapas — cada teste isola um ponto de falha diferente.

### 5.1. Testar apenas a obtenção do token (antes de qualquer consulta)

```bash
npm run test:auth
```

Esse comando exercita a cadeia completa: `keyvault.js` (busca o secret) →
`auth.js` (troca o secret por um Access Token via MSAL).

- **Sucesso esperado**: `OK: token obtido com sucesso`.
- Isso valida `TENANT_ID`, `CLIENT_ID`, o acesso ao Key Vault
  (`KEYVAULT_URI`/`CLIENT_SECRET_NAME` + permissão RBAC) e o próprio
  Client Secret — ainda não testa nenhuma permissão do Graph, só a
  autenticação em si.
- Se falhar com uma mensagem começando com "Falha ao obter o secret...",
  o problema é Key Vault (URI, nome do secret ou permissão RBAC — volte
  à seção 3).
- Se falhar com "Falha ao autenticar no Microsoft Entra ID (MSAL)", o
  Key Vault funcionou, mas `TENANT_ID`/`CLIENT_ID` estão errados ou o
  secret está expirado/incorreto.

### 5.2. Testar a busca de um usuário

Rode `npm start` e informe um UPN que você **tem certeza que existe** no
tenant (ex.: o seu próprio e-mail corporativo).

- **Sucesso esperado**: nome, e-mail e Object ID aparecem corretamente.
- Se der **403** aqui, falta `User.Read.All` ou o Admin Consent não foi
  concedido (volte ao passo 2.4/2.5).
- Se der **404**, o UPN está incorreto ou o usuário não existe nesse tenant.

### 5.3. Testar a leitura de grupos e roles

Use um UPN de um usuário que você sabe que **pertence a pelo menos um
grupo e/ou tem uma role atribuída** (ex.: você mesmo, se for admin).

- **Sucesso esperado**: as seções "Directory Roles" e "Group Membership"
  aparecem com os itens esperados e o tipo de grupo correto.
- Se der **403** apenas nessa etapa (a busca do usuário já funcionou),
  falta `Directory.Read.All` (volte ao passo 2.4/2.5 e confirme o Admin
  Consent).

### 5.4. Teste de regressão rápido

Rode novamente com um usuário **sem** nenhum grupo/role (se existir algum
de teste) para confirmar que as mensagens `(Nenhuma Directory Role
atribuída)` e `(Usuário não pertence a nenhum grupo)` aparecem
corretamente, em vez de erro.

---

## 6. Interpretando erros comuns

### Erros do Microsoft Graph

| Código | Causa mais provável | Como resolver |
|---|---|---|
| **401** | Token inválido/expirado, ou `CLIENT_ID`/`TENANT_ID` incorretos, ou o secret lido do Key Vault não é o mesmo configurado no App Registration. | Rode `npm run test:auth`; confira se o secret salvo no Key Vault é exatamente o "Valor" gerado no App Registration e se ele não expirou. |
| **403** | Application Permission ausente ou Admin Consent não concedido. | Volte a **Permissões de API** no App Registration e confirme que `User.Read.All` e `Directory.Read.All` têm o ícone verde de concedido. |
| **404** | UPN digitado não existe no tenant, ou está em outro tenant. | Confirme o e-mail exato do colaborador (não confundir com alias/apelido). |
| **429** | Muitas requisições em curto período (throttling do Graph). | O próprio Graph geralmente envia um header `Retry-After`; aguarde alguns segundos e tente de novo. Isso é raro nesse app, pois cada consulta faz só 2 chamadas. |
| Erro de rede (sem `response`) | Sem conexão com a internet, proxy/firewall bloqueando `login.microsoftonline.com` ou `graph.microsoft.com`. | Verifique conectividade e regras de firewall/proxy corporativo. |

### Erros do Azure Key Vault

| Mensagem/Situação | Causa mais provável | Como resolver |
|---|---|---|
| `Falha ao obter o secret "..." do Key Vault` + **403 Forbidden** | A identidade atual (sua conta local, ou a Managed Identity em produção) não tem a role **Key Vault Secrets User** no cofre. | Revise a seção 3.3 e confirme a atribuição de RBAC no escopo correto (o Key Vault, não outro recurso). Atribuições de RBAC podem levar alguns minutos para propagar. |
| `Falha ao obter o secret "..." do Key Vault` + **404 Not Found** | O nome em `CLIENT_SECRET_NAME` não bate com o nome do secret cadastrado no Key Vault. | Confira em **Key Vault > Segredos** o nome exato (sensível a maiúsculas/minúsculas). |
| Erro de autenticação do `DefaultAzureCredential` (ex.: "No credential in this chain was able to authenticate") | Localmente: você não rodou `az login`, ou a sessão expirou. Em produção: a Managed Identity não foi habilitada no Web App. | Local: rode `az login` novamente. Produção: veja a seção 7.2 (habilitar Managed Identity). |
| `KEYVAULT_URI`/`CLIENT_SECRET_NAME` ausentes | Variáveis não preenchidas no `.env`. | Confira o `.env` contra o `.env.example`. |

### Como depurar autenticação/permissões passo a passo

1. `az keyvault secret show ...` (seção 3.4) — isola se a sua identidade
   consegue ler o Key Vault, fora do Node.js.
2. `npm run test:auth` — isola Key Vault + credenciais do App Registration
   juntos (o erro impresso já diz qual das duas etapas falhou).
3. Se OK, teste a busca do usuário isoladamente (passo 5.2) — isola
   `User.Read.All`.
4. Se OK, teste roles/grupos (passo 5.3) — isola `Directory.Read.All`.
5. Se algo falhar, o próprio erro impresso já diz o código HTTP, o
   `code` e a `message` originais do Graph (implementado em `graph.js`,
   função `traduzirErroGraph`) — copie essa mensagem completa ao pedir
   suporte ou pesquisar o erro.

---

## 7. Deploy no Azure Web App + Azure DevOps

### 7.1. Application Settings (não secretas)

**Nunca** commite o `.env` no Azure DevOps (já está no `.gitignore`). Em
produção, configure como **Application Settings** do Azure Web App
(Configuração > Configurações de aplicativo):

```
TENANT_ID=...
CLIENT_ID=...
KEYVAULT_URI=https://<nome-do-keyvault>.vault.azure.net/
CLIENT_SECRET_NAME=entra-user-inspector-client-secret
```

Note que **nenhuma delas é secreta** — são apenas identificadores. O
segredo de fato (o Client Secret) nunca entra nas Application Settings.

### 7.2. Habilitar Managed Identity no Web App

1. No Web App → menu lateral **Identidade** (*Identity*) → aba
   **Atribuída pelo sistema** (*System assigned*) → alternar **Status**
   para **Ativado** → **Salvar**.
2. Isso cria automaticamente uma identidade no Entra ID **exclusiva desse
   Web App**, sem senha nem secret para gerenciar.
3. Volte ao **Key Vault** → **Controle de acesso (IAM)** → **+ Adicionar
   atribuição de função** → role **Key Vault Secrets User** → atribua ao
   **Serviço gerenciado** (*Managed identity*) correspondente a esse Web App.

Com isso, em produção, o `DefaultAzureCredential` usado em `keyvault.js`
detecta automaticamente a Managed Identity (sem nenhuma mudança de
código) e consegue ler o Client Secret — o mesmo código que roda na sua
máquina local (via `az login`) funciona no Azure sem alterações.

### 7.3. CLI interativa vs. Web App

Este projeto é uma **CLI interativa** (usa `readline` esperando input de
teclado). Um Azure Web App normal serve HTTP, não terminal interativo.
Antes do deploy, avalie se você quer:

- (a) transformar `app.js` numa pequena API HTTP (ex.: endpoint
  `GET /api/user/:upn` que chama `user.js` e devolve JSON) — recomendado
  para Web App; ou
- (b) rodar como **WebJob**/**Azure Container Apps Job** disparado sob
  demanda, mantendo o formato CLI.

Os módulos `keyvault.js`, `auth.js`, `graph.js` e `user.js` já estão
desacoplados de `app.js` justamente para permitir essa migração sem
reescrever a lógica de negócio — eles não sabem (nem precisam saber) se
quem os chama é um terminal ou uma rota HTTP.

### 7.4. Pipeline no Azure DevOps

- Publique com `npm ci` (não `npm install`) e não inclua `node_modules/`
  no repositório — deixe o build/pipeline fazer isso.
- O pipeline (Build/Release) roda com a identidade do próprio Azure
  DevOps (ou de um Service Connection) — ela **não** precisa de acesso ao
  Key Vault, pois quem lê o secret em runtime é a Managed Identity do Web
  App, não o pipeline. Mantenha o pipeline sem qualquer referência ao
  Client Secret.
