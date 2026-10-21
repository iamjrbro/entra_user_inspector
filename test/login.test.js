const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('../server');
const {createLoginAuth}=require('../login-auth');
const origin='http://localhost:3000';
const tenant='11111111-1111-4111-8111-111111111111';
const env={APP_URL:origin,AUTH_ALLOWED_EMAILS:'ana@example.com'};
const account={name:'Ana Silva',email:'ana@example.com',password:'A long test password 123!'};
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0];
async function using(options,fn){const server=createServer({demo:true,authOptions:{databasePath:':memory:',env,...options}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const post=(url,body,token='',extra={})=>fetch(base+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:token,...extra},body:JSON.stringify(body)});try{await fn(base,post);}finally{await new Promise(r=>server.close(r));}}
test('dashboard and API require login, login page is accessible',()=>using({},async base=>{assert.equal((await fetch(base,{redirect:'manual'})).headers.get('location'),'/login');assert.equal((await fetch(base+'/api/user?upn=ana@example.com')).status,401);const html=await(await fetch(base+'/login')).text();assert.ok(html.includes('Entrar com Microsoft'));assert.ok(html.includes('Criar conta'));assert.equal((await fetch(base+'/login-auth.js')).status,404);}));
test('registration, duplicate, login, logout, session rotation and CSRF',()=>using({},async(base,post)=>{
 assert.equal((await post('/auth/register',account,'',{Origin:'https://attacker.invalid'})).status,403);
 assert.equal((await post('/auth/register',{...account,password:'short'})).status,400);
 assert.equal((await post('/auth/register',{...account,email:'outside@example.com'})).status,403);
 let response=await post('/auth/register',account);assert.equal(response.status,201);const first=cookie(response);assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));assert.ok(response.headers.get('set-cookie').includes('SameSite=Lax'));
 assert.equal((await post('/auth/register',account)).status,409);
 assert.equal((await post('/auth/login',{...account,password:'incorrect password'})).status,401);
 assert.equal((await post('/auth/login',{...account,email:'missing@example.com'})).status,401);
 const identity=await(await fetch(base+'/auth/session',{headers:{Cookie:first}})).json();assert.equal(identity.user.name,'Ana Silva');assert.equal(identity.user.provider,'local');assert.ok(!JSON.stringify(identity).includes('password'));
 response=await post('/auth/login',account,first);assert.equal(response.status,200);const second=cookie(response);assert.notEqual(first,second);assert.equal((await(await fetch(base+'/auth/session',{headers:{Cookie:first}})).json()).user,null);
 assert.equal((await post('/auth/logout',{},second)).status,200);assert.equal((await(await fetch(base+'/auth/session',{headers:{Cookie:second}})).json()).user,null);
}));
test('Microsoft SSO uses PKCE, state, nonce, tenant checks and consumes callback once',()=>using({env:{...env,AUTH_MICROSOFT_TENANT_ID:tenant,AUTH_MICROSOFT_CLIENT_ID:'test-client',AUTH_MICROSOFT_CLIENT_SECRET:'test-fixture-secret'},clientFactory:()=>({getAuthCodeUrl:async args=>{assert.equal(args.codeChallengeMethod,'S256');assert.ok(args.codeChallenge);return 'https://login.microsoftonline.com/test?'+new URLSearchParams({state:args.state,nonce:args.nonce});},acquireTokenByCode:async args=>{assert.ok(args.codeVerifier);return {account:{tenantId:tenant},idTokenClaims:{tid:tenant,oid:'user-id',preferred_username:account.email,name:account.name,nonce:nonce}};}})},async base=>{
 let response=await fetch(base+'/auth/microsoft',{redirect:'manual'});assert.equal(response.status,302);const browser=cookie(response),destination=new URL(response.headers.get('location'));nonce=destination.searchParams.get('nonce');const state=destination.searchParams.get('state');
 const callback=base+'/auth/microsoft/callback?'+new URLSearchParams({state,code:'test-code'});
 response=await fetch(callback,{headers:{Cookie:browser},redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/');const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);const sessionCookie=cookies.find(v=>v.startsWith('entra-session=')).split(';')[0];const data=await(await fetch(base+'/auth/session',{headers:{Cookie:sessionCookie}})).json();assert.equal(data.user.provider,'microsoft');assert.equal(data.user.oid,'user-id');assert.equal((await fetch(callback,{headers:{Cookie:browser},redirect:'manual'})).status,400);
}));
let nonce;
test('Microsoft callback without browser binding is rejected before token exchange',()=>using({env:{...env,AUTH_MICROSOFT_TENANT_ID:tenant,AUTH_MICROSOFT_CLIENT_ID:'test-client',AUTH_MICROSOFT_CLIENT_SECRET:'test-secret'},clientFactory:()=>({getAuthCodeUrl:async args=>'https://login.microsoftonline.com/test?state='+args.state,acquireTokenByCode:async()=>{assert.fail('Should not exchange code');}})},async base=>{const response=await fetch(base+'/auth/microsoft',{redirect:'manual'});const state=new URL(response.headers.get('location')).searchParams.get('state');assert.equal((await fetch(base+'/auth/microsoft/callback?state='+state+'&code=test')).status,400);}));
test('real mode refuses an empty operator allowlist; HTTPS is required in production',()=>{assert.throws(()=>createLoginAuth({env:{APP_URL:origin},databasePath:':memory:'}),/AUTH_ALLOWED_EMAILS/);assert.throws(()=>createLoginAuth({demo:true,env:{APP_URL:origin,NODE_ENV:'production'},databasePath:':memory:'}),/HTTPS/);} );

test('real registration requires an invitation bound to the authorized email',async()=>{
 const {createHash}=require('node:crypto');const invitation='test-invitation-for-this-email';
 const server=createServer({authOptions:{databasePath:':memory:',env:{...env,AUTH_REGISTRATION_INVITES:JSON.stringify({'ana@example.com':createHash('sha256').update(invitation).digest('hex')})}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const post=data=>fetch(base+'/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal((await post(account)).status,403);assert.equal((await post({...account,invitation:'wrong'})).status,403);assert.equal((await post({...account,invitation})).status,201);}finally{await new Promise(r=>server.close(r));}
});
for(const mismatch of ['nonce','tenant','email'])test('Microsoft denies mismatched '+mismatch,()=>{
 let pending;
 return using({env:{...env,AUTH_MICROSOFT_TENANT_ID:tenant,AUTH_MICROSOFT_CLIENT_ID:'test',AUTH_MICROSOFT_CLIENT_SECRET:'test'},clientFactory:()=>({getAuthCodeUrl:async args=>{pending=args;return 'https://login.microsoftonline.com/test?state='+args.state;},acquireTokenByCode:async()=>({account:{tenantId:tenant},idTokenClaims:{oid:'test-user',tid:mismatch==='tenant'?'different-tenant':tenant,nonce:mismatch==='nonce'?'wrong':pending.nonce,preferred_username:mismatch==='email'?'outside@example.com':account.email}})})},async base=>{const response=await fetch(base+'/auth/microsoft',{redirect:'manual'});const callback=base+'/auth/microsoft/callback?state='+pending.state+'&code=test';assert.equal((await fetch(callback,{headers:{Cookie:cookie(response)},redirect:'manual'})).status,403);});
});

test('demo accounts and sessions cannot authenticate against real mode in the same database',async()=>{
 const {mkdtemp,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),{join}=require('node:path');const directory=await mkdtemp(join(tmpdir(),'entra-auth-test-')),databasePath=join(directory,'auth.sqlite');
 const demoServer=createServer({demo:true,authOptions:{databasePath,env}}),realServer=createServer({authOptions:{databasePath,env}});
 await new Promise(r=>demoServer.listen(0,'127.0.0.1',r));await new Promise(r=>realServer.listen(0,'127.0.0.1',r));
 const demoBase='http://127.0.0.1:'+demoServer.address().port,realBase='http://127.0.0.1:'+realServer.address().port;
 const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(account)};
 try{const registered=await fetch(demoBase+'/auth/register',options);assert.equal(registered.status,201);const token=cookie(registered);assert.equal((await(await fetch(realBase+'/auth/session',{headers:{Cookie:token}})).json()).user,null);assert.equal((await fetch(realBase+'/auth/login',options)).status,401);}
 finally{await new Promise(r=>demoServer.close(r));await new Promise(r=>realServer.close(r));await rm(directory,{recursive:true,force:true});}
});
