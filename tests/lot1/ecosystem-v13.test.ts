import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {executeActions,runJob,reserveJob,type EcosystemJob} from '../../app/utils/ecosystem-jobs-server'
import {fefoOrder,stockContent} from '../../app/utils/ecosystem-policy'
import {operationUuid,inventoryHouseholdBatch} from '../../app/utils/household-server'
import {loadReferenceData,compareToStock,resolveRecipeIngredients,aggregateRequirements} from '../../app/utils/matcher'
import {POST as ecosystem} from '../../app/api/ecosystem/route'
import {createSessionValue} from '../../app/utils/auth-server'
// @ts-expect-error local I/O doubles
import {setDbResolver,calls} from '../../test-support/db.mjs'
// @ts-expect-error local I/O doubles
import {setCookies} from '../../test-support/headers.mjs'
const root=process.env.MEALIO_TEST_PROJECT!;
const {PGlite}=createRequire(root+'/package.json')('@electric-sql/pglite');
const u=randomUUID(),f=randomUUID(),c=randomUUID(),ingredient=randomUUID();
test('Conditionnement explicite et ingrédient validé : 4 pots d’une marque = 1000 mL, sans densité implicite',async()=>{
 const ref=JSON.parse(await readFile(root+'/tests/fixtures/reference-snapshot.json','utf8'));
 setDbResolver((call:any)=>({data:call.single?null:ref[call.table]??[],error:null}));
 const data=await loadReferenceData();data.pantryProducts=new Map();const milk=data.officialList.find(i=>i.nom==='Lait entier')!;
 assert.ok(milk);const needs=await resolveRecipeIngredients([{name:'Lait entier',qty:1200,unit:'mL'}],data,'test','test');
 const results=await compareToStock(aggregateRequirements([needs]),[{id:'cellio:brand',produit:'Marque sans synonyme',qte:4,unite:'pot(s)',ingredient_id:milk.id,content_quantity:250,content_unit:'mL'}],data,undefined,{memory:new Map(),exclusions:new Set()});
 assert.equal(results[0].qte_a_acheter,200);assert.deepEqual(stockContent({qte:4,unite:'pot',content_quantity:250,content_unit:'mL'}),{qte:1000,unite:'mL'});
});
test('FEFO qualifié : DLC puis DDM ; apogée exclue ; dates absentes départagées par entrée',()=>{
 const rows:any[]=[{id:'wine',source:'cellio',date_role:'apogee',date_peremption:'2020-01-01',date_entree:'2026-01-01'},{id:'ddm',source:'cellio',date_role:'ddm',date_peremption:'2026-10-12'},{id:'dlc',source:'frosti',date_role:'dlc',date_peremption:'2026-10-11'},{id:'none',source:'cellio',date_role:'unknown',date_entree:'2026-02-01'}];
 assert.deepEqual(rows.sort(fefoOrder).map(i=>i.id),['dlc','ddm','wine','none']);
});
test('Deux vraies bases : transfert partiel, fusion cible et reprise après réponse perdue sans double déduction',async()=>{
 const a=new PGlite(),b=new PGlite();try{
 for(const [db,app,files] of [[a,'frosti',['001_frosti_v1_0.sql','004_frosti_v1_1.sql','005_frosti_v1_2.sql','006_frosti_v1_3.sql','007_frosti_v1_3_1.sql']],[b,'cellio',['001_cellio_v1_1.sql','004_cellio_v1_2.sql','005_cellio_v1_2_1.sql']]] as const){
  await db.exec(await readFile(root+`/tests/fixtures/ecosystem/${app}/baseline.sql`,'utf8'));
  for(const file of files)await db.exec(await readFile(root+`/tests/fixtures/ecosystem/${app}/${file}`,'utf8'));
  await db.query("INSERT INTO app_users(id,username,password) VALUES($1,'Test','test')",[u]);
  await db.query(`INSERT INTO ${app==='frosti'?'freezers':'cellars'}(id,user_id,name) VALUES($1,$2,'Test')`,[app==='frosti'?f:c,u]);
 }
 const payload={produit:'Compote',categorie:'Épicerie',qte:4,unite:'pot(s)',date_entree:'2026-10-10',date_peremption:'2027-01-01',date_role:'ddm',preparation_id:randomUUID(),recipe_id:randomUUID(),portions_per_unit:2,ingredient_id:ingredient,content_quantity:250,content_unit:'mL',product_type:'food',preparation_origin:'homemade',date_fabrication:'2026-10-09'};
 const invoke=async(db:any,app:string,action:string,id:string|null,p:any,op:string=randomUUID())=>(await db.query(`SELECT ${app}_stock_action($1,$2,$3,$4,$5::jsonb) r`,[u,op,action,id,JSON.stringify(p)])).rows[0].r;
 const original=await invoke(a,'frosti','add',null,{...payload,congelo_id:f});const target=await invoke(b,'cellio','add',null,{...payload,qte:2,cellar_id:c});
 const job:any={id:randomUUID(),result:{ok:true},actions:[{source:'frosti',action:'use',item_id:original.id,payload:{amount:1,version:original.version}},{source:'cellio',action:'add',item_id:null,payload:{...payload,qte:1,cellar_id:c,merge_exact:true}}]};let loseResponse=true;
 const apply=async(action:any,op:string)=>{const value=await invoke(action.source==='frosti'?a:b,action.source,action.action,action.item_id,action.payload,op);if(action.source==='cellio'&&loseResponse){loseResponse=false;throw new Error('réponse perdue')}return value};
 await assert.rejects(executeActions(job,apply),/perdue/);await executeActions(job,apply);await executeActions(job,apply);
 const source=(await a.query('SELECT * FROM items')).rows;const destination=(await b.query('SELECT * FROM items')).rows;
 assert.equal(source.length,1);assert.equal(Number(source[0].qte),3);assert.equal(destination.length,1);assert.equal(destination[0].id,target.id);assert.equal(Number(destination[0].qte),3);assert.equal(destination[0].date_role,'ddm');assert.equal(destination[0].preparation_id,payload.preparation_id);assert.equal(destination[0].recipe_id,payload.recipe_id);assert.equal(Number(destination[0].portions_per_unit),2);assert.equal(destination[0].ingredient_id,ingredient);assert.equal(Number(destination[0].content_quantity),250);
 }finally{await a.close();await b.close()}
});
test('Journal immutable et reprise : une erreur de finalisation ne devient pas un succès',async()=>{
 const id=randomUUID();let stored:EcosystemJob|null=null;let fail=true;const ops=new Set();
 setDbResolver((call:any)=>{
  if(call.table==='app_users')return {data:{id:u},error:null};
  if(call.table==='ecosystem_jobs'){
   if(call.action==='upsert'&&!stored)stored={...call.payload};
   if(call.action==='update')Object.assign(stored!,call.payload);
   return {data:call.single?stored:[],error:null};
  }
  if(call.action==='rpc'){ops.add(call.payload.p_operation);return {data:{qte:0},error:null}}
  if(call.table==='meal_consumption_events'&&fail){fail=false;return {data:null,error:{message:'journal offline'}}}
  return {data:[],error:null};
 });
 await reserveJob('Test',id,'consumption',{meal_plan_id:'plan'},[{source:'frosti',action:'use',item_id:f,payload:{amount:1}}],{consumed:[],shortages:[]});
 await assert.rejects(runJob('Test',id),/offline/);assert.equal((stored as unknown as EcosystemJob).status,'blocked');
 const resumed=await runJob('Test',id);assert.equal(resumed.status,'completed');assert.equal(ops.size,1);
 await assert.rejects(reserveJob('Test',id,'consumption',{meal_plan_id:'another'},[],{}),/déjà utilisé/);
});
test('Inventaire utilise RPC atomique et UUID du foyer propre à la source',async()=>{
 setDbResolver((call:any)=>({data:call.table==='app_users'?{id:call.source==='frosti'?f:c}:[],error:null}));
 const op=randomUUID();await inventoryHouseholdBatch('Test','cellio',[{id:u,qte:2,unite:'pot(s)',version:7}],op);
 const rpc=calls.find((i:any)=>i.action==='rpc');assert.equal(rpc.table,'cellio_inventory_batch');assert.equal(rpc.payload.p_user,c);assert.equal(rpc.payload.p_rows[0].version,7);assert.equal(rpc.payload.p_operation,op);
});
test('Écosystème : foyer signé, origine extérieure et lot non possédé refusés avant mutation',async()=>{
 process.env.MEALIO_SESSION_SECRET='test-session-secret---------------------';setCookies({mealio_session:createSessionValue('Test',u)});
 setDbResolver((call:any)=>({data:call.table==='app_users'?{id:u}:call.single?null:[],error:null}));
 const body={kind:'transfer',operation_id:randomUUID(),lots:[{id:f,source:'frosti',amount:1,version:1}],target_source:'cellio',target_id:c};
 const req=(origin?:string)=>new Request('http://mealio.test/api/ecosystem',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});
 assert.equal((await ecosystem(req('https://other.test'))).status,409);assert.equal((await ecosystem(req())).status,409);
 assert.ok(!calls.some((c:any)=>c.action==='rpc'||c.action==='upsert'));
 assert.equal(operationUuid('same'),operationUuid('same'));assert.notEqual(operationUuid('same'),operationUuid('different'));
});
