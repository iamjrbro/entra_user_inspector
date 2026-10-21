# Entra User Inspector

Dashboard web para consultar identidades no Microsoft Entra ID e exportar auditorias em **HTML, PNG ou JPG**. A aplicação principal é acessada pelo navegador.

## Iniciar

Requer Node.js 22.13 ou superior.

    npm ci
    npm start

Antes do modo real, configure autenticação e operadores autorizados conforme [AUTHENTICATION.md](AUTHENTICATION.md). Abra http://localhost:3000 para entrar ou criar sua conta. Para experimentar sem Azure:

    npm run demo

Crie uma conta de teste na página de login e consulte ana.silva@example.com. A interface e os relatórios sinalizam que os dados são fictícios.

## Conectar ao tenant

Copie .env.example para .env e configure TENANT_ID, CLIENT_ID, KEYVAULT_URI e CLIENT_SECRET_NAME. Execute az login com a conta autorizada a ler o secret do Key Vault. As consultas continuam usando MSAL e Microsoft Graph, com o segredo armazenado no Key Vault. O guia de configuração original está em [AZURE-SETUP.md](AZURE-SETUP.md). Os arquivos deste projeto ficam na raiz, e não em src/. npm run test:auth verifica a autenticação.

## Dashboard e relatórios

- Consulta por UPN, nome, e-mail e Object ID.
- Indicadores de Directory Roles, grupos e tipos de grupo.
- Lista filtrável de vínculos e seus IDs.
- Abrir relatório: abre o HTML em outra aba do navegador.
- Baixar HTML: arquivo independente, sem fontes, scripts ou serviços externos; pode ser aberto offline.
- Baixar PNG/JPG: gera imagens no próprio navegador. Relatórios longos são divididos em partes numeradas; baixe todas pelos links apresentados.

As exportações contêm todos os vínculos da consulta, mesmo quando a tabela está filtrada. Os dados são mantidos apenas na memória da página; não há histórico persistente ou links públicos. O HTML pode ser impresso pelo navegador.

O escopo é o mesmo das consultas originais via transitiveMemberOf, incluindo grupos aninhados. Não cobre PIM elegível nem todas as permissões efetivas em aplicativos ou recursos Azure.

## Hospedagem

O servidor escuta em 127.0.0.1 por padrão. PORT altera a porta; HOST=0.0.0.0 permite hospedar em outro ambiente. O dashboard exige login local ou Microsoft e operadores autorizados. Configure APP_URL HTTPS, NODE_ENV=production e persistência do banco de contas conforme AUTHENTICATION.md, pois as consultas usam permissões do aplicativo. Somente os arquivos públicos explicitamente listados no servidor são servidos.

## Validar

    npm test

Testes cobrem rotas, validação de UPN, proteção dos arquivos de código/configuração, consulta com serviço simulado, escape de HTML e paginação de 500 grupos. O teste real contra o tenant depende da configuração Azure.

## Acesso ao dashboard

Login com e-mail e senha ou Microsoft SSO. O cadastro real exige convite do administrador. Consulte [AUTHENTICATION.md](AUTHENTICATION.md) para configurar o App Registration, a URL de retorno e os convites.
