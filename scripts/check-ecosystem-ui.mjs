import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`,secret='local-preview-secret-at-least-32-characters',id=randomUUID(),f=randomUUID(),c=randomUUID();
const payload=Buffer.from(JSON.stringify({username:'Test',frostiUserId:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const token=payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
const env={...process.env,MEALIO_SESSION_SECRET:secret};for(const app of ['MEALIO','FROSTI','CELLIO','COOKIWIKI']){env[`NEXT_PUBLIC_${app}_URL`]=`https://${app.toLowerCase()}.example.invalid`;env[`${app}_SERVICE_ROLE_KEY`]='local-preview-placeholder'}
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});
let browser;try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'mealio_session',value:token,url:base,httpOnly:true}]);
 const changes=[],jobs=[];let fail=true;
 await context.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{username:'Test'}});
  if(path==='/api/stock')return route.fulfill({json:{items:[{id,produit:'Compote test',qte:4,unite:'pot(s)',ingredient_name:'Pomme',content_quantity:250,content_unit:'mL',date_role:'ddm',date_peremption:'2027-01-01',source:'cellio',cellar_id:c,location_name:'Placard',version:3}],locations:[{id:f,source:'frosti',name:'Frigo'},{id:c,source:'cellio',name:'Placard'}]}});
  if(path==='/api/recipes')return route.fulfill({json:{recipes:[{id:randomUUID(),nom:'Compote maison',ingredients:[{name:'Pomme',qty:1,unit:'kg'}]}]}});
  if(path==='/api/ecosystem'&&route.request().method()==='POST'){
   const body=route.request().postDataJSON();changes.push(body);
   if(body.action==='resume'){jobs[0].status='completed';return route.fulfill({json:{job:jobs[0]}})}
   if(fail){fail=false;jobs.push({id:body.operation_id,kind:body.kind,status:'blocked',error:'Réponse interrompue',result:{label:'Transfert',consumed:[{produit:'Compote test',qte:1,unite:'pot(s)',source:'cellio'}]}});return route.fulfill({status:409,json:{error:'Réponse interrompue'}})}
   const job={id:body.operation_id,kind:body.kind,status:'completed',result:{label:body.label,consumed:body.inputs??[],outputs:body.outputs}};jobs.push(job);return route.fulfill({json:{job}});
  }
  if(path==='/api/ecosystem')return route.fulfill({json:{jobs,ingredients:[{id:randomUUID(),nom:'Pomme'}]}});
  return route.fulfill({json:{pending:[],recipes:[],reminders:[],rules:[],notices:[]}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/ecosystem');await page.getByText('Compote test',{exact:true}).first().waitFor();
 await mkdir('recette',{recursive:true});
 for(const width of [320,375,390,1024]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);await page.screenshot({path:`recette/ecosystem-${width}.png`,fullPage:true})}
 await page.setViewportSize({width:390,height:844});await page.getByLabel('À transférer (pot(s))').fill('1');await page.getByLabel('Équipement de destination').selectOption(`frosti:${f}`);await page.getByRole('button',{name:'Vérifier avant confirmation'}).click();await page.getByRole('button',{name:'Confirmer',exact:true}).click();await page.getByRole('button',{name:'Reprendre l’opération'}).waitFor();const operation=changes[0].operation_id;
 await page.getByRole('button',{name:'Reprendre l’opération'}).click();await page.getByText('Terminée',{exact:true}).first().waitFor();assert.equal(changes[1].id,operation);
 await page.getByRole('button',{name:'Préparation maison',exact:true}).click();await page.getByLabel('Nom de la préparation').fill('Compote maison');await page.getByLabel('Produit',{exact:true}).fill('Compote maison');await page.getByLabel('Quantité',{exact:true}).fill('4');await page.getByLabel('Unité',{exact:true}).fill('pot(s)');await page.getByLabel('Rangement').selectOption(`cellio:${c}`);
 await page.getByRole('button',{name:'+ Ajouter un lot produit'}).click();await page.getByLabel('Produit',{exact:true}).last().fill('Compote à congeler');await page.getByLabel('Rangement').last().selectOption(`frosti:${f}`);
 await page.screenshot({path:'recette/preparation-mobile.png',fullPage:true});await page.getByRole('button',{name:'Vérifier avant confirmation'}).click();await page.getByRole('button',{name:'Confirmer',exact:true}).click();await page.getByText('Compote maison',{exact:true}).last().waitFor();assert.equal(changes.at(-1).outputs.length,2);assert.equal(changes.at(-1).outputs[0].qte,4);
 assert.equal(errors.length,0,errors.join('\n'));console.log('UI ecosystem OK: 320/375/390/1024 px, reviewed transfer, failure and stable-id resume, homemade preparation with two destinations, no browser errors.');await context.close();
}finally{if(browser)await browser.close();server.kill()}
