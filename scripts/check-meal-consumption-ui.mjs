import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createHmac,randomUUID} from 'node:crypto';import {chromium} from 'playwright';import {mkdir} from 'node:fs/promises';
const port=3112,base=`http://127.0.0.1:${port}`,secret='ui-test-secret-with-more-than-32-characters';const data=Buffer.from(JSON.stringify({username:'Test',frostiUserId:randomUUID(),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const token=data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
const env={...process.env,MEALIO_SESSION_SECRET:secret};for(const app of ['MEALIO','FROSTI','CELLIO','COOKIWIKI']){env[`NEXT_PUBLIC_${app}_URL`]=`https://${app.toLowerCase()}.example.invalid`;env[`${app}_SERVICE_ROLE_KEY`]='local-preview-placeholder'}
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});let browser;
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,'server not ready');
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'mealio_session',value:token,url:base,httpOnly:true}]);let hang=false;const posts=[];const plan={id:randomUUID(),recipe_id:randomUUID(),servings:8,scheduled_date:'2026-10-09',meal_type:'soir'};
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/auth/me')return route.fulfill({json:{authenticated:true,username:'Test'}});
  if(url.pathname==='/api/meal-consumption'){
   if(req.method()==='POST'){posts.push(req.postDataJSON());if(hang)return new Promise(()=>{});return route.fulfill({json:{result:{status:'skipped',consumed:[],shortages:[]}}})}
   if(url.searchParams.has('meal_plan_id'))return route.fulfill({status:400,json:{error:'Recette introuvable. Aucun stock modifié.'}});
   return route.fulfill({json:{pending:[{plan,recipe_nom:'Recette inconnue'}]}});
  }
  return route.fulfill({json:{plans:[],items:[],pending:[],list:null,recipes:[],reminders:[],notices:[]}});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/');await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Oui, vérifier les quantités'}).click();await page.getByRole('alert').filter({hasText:'Recette introuvable'}).waitFor();
 await mkdir('recette',{recursive:true});for(const width of [320,375,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`recette/repas-erreur-${width}.png`,fullPage:true})}
 await page.getByRole('button',{name:'Non, pas cuisiné'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(posts[0].confirmed,false);
 await page.reload();await page.getByRole('dialog').waitFor();hang=true;await page.getByRole('button',{name:'Non, pas cuisiné'}).click();await page.getByRole('button',{name:'Plus tard',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.reload();await page.waitForTimeout(300);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(errors.length,0,errors.join('\n'));
 console.log('Meal prompt UI OK: missing recipe shows error, Non succeeds, Plus tard closes an in-flight request, dismissal survives navigation, 320/375/390 px.');await context.close();
}finally{if(browser)await browser.close();server.kill()}
