import {preparedPortionAllocator} from '../../app/utils/prepared-portions-policy'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createSessionValue,getAuthSession} from '../../app/utils/auth-server'
import {confirmMealConsumption,prepareConsumptionForPlan} from '../../app/utils/meal-consumption-server'
import {getReplenishmentSuggestions} from '../../app/utils/replenishment-server'
import {storePurchaseLot,storedQuantityFor} from '../../app/utils/purchase-storage-server'
import {PATCH} from '../../app/api/stock/items/route'
// @ts-expect-error local test doubles
import {setDbResolver,setAuthResolver,calls,authCalls} from '../../test-support/db.mjs'
// @ts-expect-error local test doubles
import {setCookies} from '../../test-support/headers.mjs'
const root=process.env.MEALIO_TEST_PROJECT!,id=randomUUID(),recipe=randomUUID(),preparation=randomUUID(),location=randomUUID();
const session=()=>{process.env.MEALIO_SESSION_SECRET='test-v131-secret-with-at-least-32-characters';setCookies({mealio_session:createSessionValue('Test',id)})};
test('V1.3.1 : session vérifiée contre UUID, foyer et mot de passe ; pas de repli service key',async()=>{
 session();setAuthResolver(()=>({data:{id,username:'Test',password:'changed'},error:null}));assert.equal(await getAuthSession(),null);assert.ok(authCalls.at(-1).filters.some((f:any)=>f[1]==='id'&&f[2]===id));setAuthResolver(()=>({data:null,error:null}));assert.equal(await getAuthSession(),null);setAuthResolver(null);assert.equal((await getAuthSession())?.username,'Test');
 const secret=process.env.MEALIO_SESSION_SECRET;delete process.env.MEALIO_SESSION_SECRET;process.env.FROSTI_SERVICE_ROLE_KEY='old-key';assert.throws(()=>createSessionValue('Test',id),/32 caractères/);process.env.MEALIO_SESSION_SECRET=secret;
});
test('V1.3.1 : Non reste enregistrable quand la recette a disparu, sans lire Cookiwiki ni modifier le stock',async()=>{
 session();setDbResolver((c:any)=>({data:c.table==='meal_plans'?[{id,user_id:'Test',recipe_id:recipe,servings:8,scheduled_date:'2026-10-09',meal_type:'soir'}]:c.single?null:[],error:null}));
 const result=await confirmMealConsumption('Test',id,false);assert.equal(result.status,'skipped');assert.ok(!calls.some((c:any)=>c.source==='cookiwiki'||c.table.endsWith('_stock_action')));assert.equal(calls.find((c:any)=>c.table==='meal_consumption_events'&&c.action==='upsert').payload.status,'skipped');
});
test('V1.3.1 : repas préparé consomme les portions finies ; lot manquant ne redéduit pas les ingrédients',async()=>{
 const plan:any={id,recipe_id:recipe,user_id:'Test',servings:8,scheduled_date:'2026-10-09'};let available=4;
 setDbResolver((c:any)=>({data:c.table==='app_users'?{id}:c.table==='items'&&c.source==='frosti'?[{id:'ready',produit:'Lasagnes',qte:available,unite:'barquette(s)',recipe_id:recipe,preparation_id:preparation,preparation_origin:'homemade',portions_per_unit:2,version:3}]:c.table==='meal_preparation_links'?{preparation_id:preparation,recipe_id:recipe}:c.table==='ecosystem_jobs'?{status:'completed'}:c.single?null:[],error:null}));
 const full=await prepareConsumptionForPlan('Test',plan);assert.equal(full.actions.length,1);assert.equal(full.actions[0].payload.amount,4);assert.equal(full.result.shortages.length,0);assert.ok(!calls.some((c:any)=>c.source==='cookiwiki'));
 available=0;const missing=await prepareConsumptionForPlan('Test',plan);assert.equal(missing.actions.length,0);assert.equal(missing.result.shortages[0].qte,8);
});
test('V1.3.1 : seuils partagent identité et conversion des pots avec les recettes',async()=>{
 session();const fixture=JSON.parse(await readFile(root+'/tests/fixtures/reference-snapshot.json','utf8'));const milk=fixture.official_ingredients.find((i:any)=>i.nom==='Lait entier');let min=500;
 setDbResolver((c:any)=>{let data:any=c.single?null:fixture[c.table]??[];if(c.table==='app_users')data={id};if(c.table==='items')data=c.source==='cellio'?[{id:'brand',produit:'Marque sans synonyme',qte:4,unite:'pot(s)',content_quantity:250,content_unit:'mL',ingredient_id:milk.id,version:1}]:[];if(c.table==='stock_replenishment_thresholds')data=[{id:'t',ingredient_id:milk.id,min_quantity:min,target_quantity:2000,unite:'mL',active:true,mode:'suggestion'}];if(['pantry_products','household_pantry_products','shopping_lists','household_pantry_signals','recurring_shopping_rules'].includes(c.table))data=[];return{data,error:null}});
 assert.equal((await getReplenishmentSuggestions('Test')).length,0);min=1500;const [suggestion]=await getReplenishmentSuggestions('Test');assert.equal(suggestion.stock_quantity,1000);assert.equal(suggestion.quantity,1000);
});
test('V1.3.1 : édition transmet la version vue par le navigateur',async()=>{
 session();setDbResolver((c:any)=>({data:c.table==='app_users'?{id}:c.table==='items'?{id,user_id:id,qte:500,version:2,unite:'g',produit:'Farine',categorie:'Épicerie'}:c.action==='rpc'?{id,qte:1000,version:3}:[],error:null}));
 const response=await PATCH(new Request('http://mealio.test/api/stock/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,source:'frosti',qte:1000,expected_version:1})}));assert.equal(response.status,200);assert.equal(calls.find((c:any)=>c.action==='rpc').payload.p_payload.version,1);
});
test('V1.3.1 : rangement reprend la demande figée après perte du journal ; pending ne compte jamais comme rangé',async()=>{
 const row:any={shopping_item_id:id,quantity:1,status:'pending',storage:'frosti',location_id:location,location_name:'Origine',rule_label:'Règle initiale',operation_key:`mealio:${id}:from:0:to:1`,request_payload:{source:'frosti',produit:'Lait',categorie:'Lait',qte:1,unite:'mL',congelo_id:location,date_entree:'2026-10-09',ingredient_id:recipe,ingredient_name:'Lait',notes:null,merge_exact:true,apply_default_expiry:true}};let receipt:any=null;let fail=true;let writes=0;
 setDbResolver((c:any)=>{
  if(c.table==='mealio_reserve_purchase_stock')return{data:row,error:null};if(c.table==='app_users')return{data:{id},error:null};
  if(c.table==='frosti_operations')return{data:receipt,error:null};
  if(c.table==='frosti_stock_action'){writes++;receipt={result:{id:'stock',qte:1,version:1}};return{data:receipt.result,error:null}}
  if(c.table==='shopping_item_stock_transfers'){if(c.action==='update'){if(fail){fail=false;return{data:null,error:{message:'journal offline'}}}row.status='completed'}return{data:c.single?row:[row],error:null}}
  return{data:c.single?null:[],error:null};
 });
 const args:any=['Test',{id,produit:'Lait',ingredient_id:recipe,unite:'mL'},{nom:'Lait',categorie:'Lait'},'frosti',{source:'frosti',location_id:randomUUID(),location_name:'Nouvelle règle',rule_label:'Nouvelle règle'}];
 assert.equal(storedQuantityFor({id,stock_stored_quantity:1},[row]),0);
 await assert.rejects(storePurchaseLot(...args as Parameters<typeof storePurchaseLot>),/offline/);const done=await storePurchaseLot(...args as Parameters<typeof storePurchaseLot>);assert.equal(writes,1);assert.equal(done.stored_quantity,1);assert.equal(done.location_id,location);
});
test('V1.3.1 : vrai PostgreSQL réserve une seule opération même si achat/destination changent ; verrous exclusifs',async()=>{
 const {PGlite}=createRequire(root+'/package.json')('@electric-sql/pglite');const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE shopping_lists(id uuid PRIMARY KEY,user_id text);CREATE TABLE shopping_items(id uuid PRIMARY KEY,list_id uuid,qte_achetee numeric,stock_stored_quantity numeric);CREATE TABLE shopping_item_stock_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shopping_item_id uuid,stock_item_id text,storage text,location_id uuid,location_name text,rule_label text,quantity numeric,operation_key text,status text,attempted_at timestamptz);`);
 await db.exec(await readFile(root+'/migrations/001_mealio_v1_3_ecosystem.sql','utf8'));await db.exec(await readFile(root+'/migrations/002_mealio_v1_3_1.sql','utf8'));
 await db.query("INSERT INTO shopping_lists VALUES($1,'Test');",[recipe]);await db.query('INSERT INTO shopping_items VALUES($1,$2,1000,0)',[id,recipe]);
 const reserve=async(l:string)=>(await db.query('SELECT mealio_reserve_purchase_stock($1,$2,$3,$4,$5,$6,$7::jsonb) r',['Test',id,'frosti',l,'Frigo','default',JSON.stringify({produit:'Lait',qte:999})])).rows[0].r;
 const first=await reserve(location);assert.equal(Number(first.quantity),1000);assert.equal(first.request_payload.qte,1000);await db.query('UPDATE shopping_items SET qte_achetee=1500 WHERE id=$1',[id]);const second=await reserve(randomUUID());assert.equal(second.operation_key,first.operation_key);assert.equal(second.location_id,location);
 await db.query("UPDATE shopping_item_stock_transfers SET status='completed'");const third=await reserve(location);assert.equal(Number(third.quantity),500);assert.notEqual(third.operation_key,first.operation_key);
 const job=randomUUID();await db.query("INSERT INTO ecosystem_jobs(id,user_id,kind,request_hash,request,actions,result) VALUES($1,'Test','transfer','hash','{}','[]','{}')",[job]);
 const claim=async(token:string)=>(await db.query("SELECT mealio_claim_job('Test',$1,$2) ok",[job,token])).rows[0].ok;const token=randomUUID();assert.equal(await claim(token),true);assert.equal(await claim(randomUUID()),false);await db.query('UPDATE ecosystem_jobs SET lease_until=now()-interval \'1 second\' WHERE id=$1',[job]);assert.equal(await claim(randomUUID()),true);
 }finally{await db.close()}
});

test('V1.3.1 : les courses ne réutilisent pas les mêmes portions sur deux repas',()=>{const allocator=preparedPortionAllocator([{id,source:'frosti',produit:'Lasagnes',qte:4,unite:'barquette(s)',categorie:'Préparations',recipe_id:recipe,preparation_origin:'homemade',portions_per_unit:2}]);const first=allocator.allocate(recipe,6),second=allocator.allocate(recipe,6);assert.equal(first.missing,0);assert.equal(first.used[0].amount,3);assert.equal(second.used[0].amount,1);assert.equal(second.missing,4)})
