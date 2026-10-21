const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();
const { createLoginAuth } = require('./login-auth');
function createServer({demo = false, service, authOptions = {}} = {}) {
 const auth = createLoginAuth({...authOptions, demo});
 const assets = {'/login':['login.html','text/html'],'/login.js':['login.js','text/javascript'],'/':['index.html','text/html'],'/style.css':['style.css','text/css'],'/dashboard.js':['dashboard.js','text/javascript'],'/report.js':['report.js','text/javascript']};
 const server = http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  try {
   const url=new URL(req.url,'http://localhost');
   if(await auth.handle(req,res,url,json)) return;
   if(req.method!=='GET')return json(405,{error:'Método não permitido.'});
   if(url.pathname==='/' && !auth.session(req)){res.writeHead(302,{Location:'/login'});res.end();return;}
   if(url.pathname.startsWith('/api/') && !auth.session(req))return json(401,{error:'Entre para acessar o dashboard.'});
   if(url.pathname==='/api/config')return json(200,{demo,configured:demo||['TENANT_ID','CLIENT_ID','KEYVAULT_URI','CLIENT_SECRET_NAME'].every(k=>Boolean(process.env[k]))});
   if(url.pathname==='/api/user'){
    const values=url.searchParams.getAll('upn'),upn=(values[0]||'').trim();
    if(values.length!==1||upn.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(upn))return json(400,{error:'Informe um e-mail corporativo (UPN) válido.'});
    if(demo){const sample=require('./demo.json');if(upn.toLowerCase()!==sample.usuario.email)return json(404,{error:'Na demonstração, consulte ana.silva@example.com.'});return json(200,{...sample,demonstracao:true,consultadoEm:new Date().toISOString()});}
    const api=service||require('./user');const user=await api.buscarUsuarioPorUpn(upn);const {roles,grupos}=await api.obterRolesEGruposDoUsuario(user.id);
    return json(200,{usuario:{displayName:user.displayName,email:user.mail||user.userPrincipalName,objectId:user.id},roles:roles.map(r=>({id:r.id,displayName:r.displayName})),grupos:grupos.map(g=>({id:g.id,displayName:g.displayName,tipo:api.classificarTipoDeGrupo(g)})),consultadoEm:new Date().toISOString(),demonstracao:false});
   }
   if(!assets[url.pathname])return json(404,{error:'Recurso não encontrado.'});
   const [file,type]=assets[url.pathname];const body=await fs.readFile(path.join(__dirname,'public',file));res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(body);
  }catch(error){const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:500;json(status,{error:status===500?'Falha na consulta. Confira a configuração do Azure e as permissões do aplicativo.':error.message});}
 });
 server.on('close',()=>auth.close());
 return server;
}
if(require.main===module){const demo=process.argv.includes('--demo'),port=process.env.PORT||3000;createServer({demo}).listen(port,process.env.HOST||'127.0.0.1',()=>console.log('Dashboard: http://localhost:'+port+(demo?' (DEMONSTRAÇÃO)':'')));}
module.exports={createServer};
