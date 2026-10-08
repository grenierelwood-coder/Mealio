import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandRecipeLines, validateRecipeLines } from '../../app/utils/recipe-quality-policy'
import { getRecipeDetailsFromCookiwiki, parseIngredients } from '../../app/utils/cookiwiki-fetcher'
import { loadReferenceData, cleanText, resolveRecipeIngredients, aggregateRequirements, compareToStock, createMatcherTrace } from '../../app/utils/matcher'
import { prepareShoppingRequirement } from '../../app/utils/shopping-requirement-policy'
import { stockSourceLink } from '../../app/utils/stock-source-link'
import { matcherCorrectionLink } from '../../app/utils/matcher-correction-link'
import { runPurchaseCycle } from '../../app/utils/integration-campaign'
import { PATCH as saveRecipe, GET as getRecipes } from '../../app/api/admin/recipes/route'
import { createSessionValue } from '../../app/utils/auth-server'
// @ts-expect-error local doubles
import { calls, setDbResolver } from '../../test-support/db.mjs'
// @ts-expect-error local doubles
import { setCookies } from '../../test-support/headers.mjs'
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures')
const read=(f:string)=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))
const base=read('reference-snapshot.json'), previous=read('reference-enrichment.json'), delta=read('reference-defaults-v1210.json'), recipes=read('cookiwiki-56.json')
const data=structuredClone(base)
const corrections=read('recipe-corrections-v1212.json'),extra=read('recipe-reference-v1212.json')
for(const i of extra)if(!data.official_ingredients.some((x:any)=>x.nom===i.nom))data.official_ingredients.push({...i,id:`extra-${i.nom}`})
for(const i of delta.new_ingredients)if(!data.official_ingredients.some((x:any)=>x.nom===i.nom))data.official_ingredients.push({...i,id:`new-${i.nom}`})
for(const u of previous.units)if(!data.unit_mappings.some((x:any)=>x.unite===u.unite))data.unit_mappings.push(u)
for(const [name,unit] of Object.entries(delta.reference_units)){const i=data.official_ingredients.find((i:any)=>i.nom===name);if(i)i.unite_reference=unit}
for(const row of [...previous.aliases,...delta.aliases]){
 const target=data.official_ingredients.find((i:any)=>i.nom===row.ingredient_name)
 if(target&&!data.ingredient_synonyms.some((s:any)=>cleanText(s.mot_recette)===cleanText(row.alias))&&!data.official_ingredients.some((i:any)=>cleanText(i.nom)===cleanText(row.alias)&&i.id!==target.id))data.ingredient_synonyms.push({mot_recette:row.alias,ingredient_id:target.id})
}
for(const m of delta.masses){const i=data.official_ingredients.find((i:any)=>i.nom===m.ingredient_name);if(i&&!data.ingredient_densities.some((d:any)=>d.ingredient_id===i.id&&d.unite===m.unite))data.ingredient_densities.push({ingredient_id:i.id,unite:m.unite,poids_g_approx:m.grams})}
for(const m of read('recipe-measures-v1212.json')){const i=data.official_ingredients.find((i:any)=>i.nom===m.ingredient_name);if(i&&!data.ingredient_densities.some((d:any)=>d.ingredient_id===i.id&&d.unite===m.unite))data.ingredient_densities.push({ingredient_id:i.id,unite:m.unite,poids_g_approx:m.grams})}
data.pantry_products=read('pantry-defaults.json')
const corrected=recipes.map((recipe:any)=>({...recipe,ingredients:corrections.find((c:any)=>c.id===recipe.id)?.ingredients??recipe.ingredients}))
process.env.ANTHROPIC_API_KEY='local-test';process.env.MEALIO_SESSION_SECRET='recipes-secret'
globalThis.fetch=async()=>Response.json({content:[{type:'text',text:'{"match":"AUCUN","confidence":0}'}]})
function db(){setCookies({});setDbResolver((c:any)=>({data:c.table==='recipes'?(c.single?corrected.find((r:any)=>r.id===c.filters.find((f:any)=>f[1]==='id')?.[2]):corrected):c.single?null:data[c.table]??[],error:null}))}
const context=()=>({memory:new Map(),exclusions:new Set<string>(),persistMemory:false})
const report:any[]=[]
for(const recipe of corrected)test(`recettes corrigées : ${recipe.title}`,async()=>{
 db();const ref=await loadReferenceData();const fetched=await getRecipeDetailsFromCookiwiki(recipe.id)
 assert.ok(fetched.ingredients.length>0,'Chaque recette devient exploitable');assert.ok(fetched.ingredients.every(i=>!i.inferredFromInstructions))
 const resolved=await resolveRecipeIngredients(fetched.ingredients,ref,recipe.id,recipe.title)
 const needs=aggregateRequirements([resolved]);assert.ok(needs.length)
 const empty=await compareToStock(needs,[],ref,undefined,context())
 const full=needs.filter(n=>n.ingredient_id&&!n.needs_review&&!n.quantity_unknown).map((n,i)=>({id:`full-${i}`,produit:n.produit,ingredient_id:n.ingredient_id,qte:Math.max(n.qte,1)*10,unite:n.unite}))
 const covered=await compareToStock(needs,full,ref,undefined,context())
 for(const row of covered)if(row.ingredient_id&&!row.needs_review&&!row.quantity_unknown)assert.equal(row.qte_a_acheter,0)
 const doubled=aggregateRequirements([await resolveRecipeIngredients(fetched.ingredients,ref,recipe.id,recipe.title,2)])
 for(let i=0;i<needs.length;i++)assert.ok(Math.abs(doubled[i].qte-(needs[i].quantity_mode==='presence'?1:needs[i].qte*2))<.00001)
 const bad=await compareToStock(needs,[{id:'detergent',produit:'Détergent',qte:999999,unite:'g'}],ref,undefined,context());for(const row of bad)assert.equal(row.qte_stock,0)
 const prepared=empty.map(row=>prepareShoppingRequirement(row,ref));for(const row of prepared)assert.ok(Number.isFinite(row.qte_a_acheter)&&row.qte_a_acheter>=0)
 report.push({id:recipe.id,title:recipe.title,lines:needs.length,resolved:needs.filter(n=>n.ingredient_id&&!n.needs_review).length,estimated:fetched.ingredients.filter(i=>i.quantityEstimated).length,unknown:needs.filter(n=>n.quantity_unknown).map(n=>n.produit),unresolved:needs.filter(n=>!n.ingredient_id||n.needs_review).map(n=>n.produit),conversionIssues:prepared.filter(n=>n.reference_unit_issue).map(n=>({name:n.produit,reason:n.reference_unit_issue}))})
})
test('propositions structurées valides',()=>{for(const c of corrections)validateRecipeLines(c.ingredients)})
test('mélange : olives vertes ne couvrent pas la part noire',async()=>{
 db();const ref=await loadReferenceData();ref.pantryProducts=new Map();const ingredients=parseIngredients([{name:'Mélange',qty:250,unit:'g',components:[{name:'Olive noire',qty:125,unit:'g'},{name:'Olive verte',qty:125,unit:'g'}]}]);assert.equal(ingredients.length,2)
 const needs=aggregateRequirements([await resolveRecipeIngredients(ingredients,ref,'r','r')]);const out=await compareToStock(needs,[{id:'green',produit:'Olive verte',qte:250,unite:'g'}],ref,undefined,context())
 assert.equal(out.find(n=>n.produit==='Olive noire')!.qte_stock,0);assert.equal(out.find(n=>n.produit==='Olive noire')!.qte_a_acheter,125);assert.equal(out.find(n=>n.produit==='Olive verte')!.qte_a_acheter,0)
})
test('alternative : une branche, choix absent sans IA ni stock déduit',async()=>{
 const options={name:'Alternative',selected:1,alternatives:[{name:'Farine de blé',qty:200,unit:'g'},{name:'Mélange',components:[{name:'Farine de blé',qty:150,unit:'g'},{name:"Poudre d'amande",qty:50,unit:'g'}]}]};assert.deepEqual(expandRecipeLines([options]).map(i=>i.qty),[150,50])
 db();const ref=await loadReferenceData(),trace=createMatcherTrace('alternative');const [pending]=await resolveRecipeIngredients(parseIngredients([{...options,selected:null}]),ref,'r','r',1,trace)
 assert.equal(pending.ingredient_id,null);assert.equal(pending.quantity_unknown,true);assert.equal(trace.claudeCalls,0)
 const [out]=await compareToStock(aggregateRequirements([[pending]]),[{id:'f',produit:'Farine de blé',qte:1000,unite:'g'}],ref,undefined,context());assert.equal(out.qte_stock,0)
})
test('facultatif, eau et quantité inconnue conservés sans invention',()=>{
 assert.equal(expandRecipeLines([{name:'Noix',qty:10,unit:'g',optional:true}]).length,0);assert.equal(expandRecipeLines([{name:'Noix',qty:10,unit:'g',optional:true,included:true}]).length,1)
 assert.equal(expandRecipeLines([{name:'Eau',exclude_from_shopping:true}]).length,0);assert.equal(expandRecipeLines([{name:'Beurre',qty:null}])[0].qty,0)
})
test('pas de secours instructions sur liste volontairement exclue',async()=>{db();setDbResolver(()=>({data:{id:'r',title:'r',servings:4,ingredients:[{name:'Eau',exclude_from_shopping:true}],instructions:'Pour réaliser cette recette tu auras besoin de :\n• Beurre'},error:null}));assert.equal((await getRecipeDetailsFromCookiwiki('r')).ingredients.length,0)})
test('validation : quantités invalides, profondeur, choix et ail Pièce refusés',()=>{
 for(const qty of [-1,NaN,Infinity,'12'])assert.throws(()=>validateRecipeLines([{name:'Beurre',qty}]))
 assert.throws(()=>validateRecipeLines([{name:'Ail',qty:1,unit:'Pièce'}]));assert.throws(()=>validateRecipeLines([{name:'x',alternatives:[{name:'a'}],selected:3}]))
 assert.throws(()=>validateRecipeLines([{name:'x',components:[],alternatives:[]}]))
 let rows:any=[{name:'a'}];for(let i=0;i<7;i++)rows=[{name:'mix',components:rows}];assert.throws(()=>expandRecipeLines(rows))
})
const request=(body:any)=>new Request('http://mealio.test',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
function session(){setCookies({mealio_session:createSessionValue('Famille','frosti-user')})}
test('correction recette : authentification et validation avant DB',async()=>{
 db();assert.equal((await saveRecipe(request({}))).status,401);assert.equal((await getRecipes()).status,401);assert.equal(calls.length,0)
 session();assert.equal((await saveRecipe(request({id:corrected[0].id,expectedIngredients:[],ingredients:[{name:'Ail',qty:1,unit:'Pièce'}]}))).status,400);assert.equal(calls.length,0)
})
test('correction recette : RPC atomique, conflit et erreur DB',async()=>{
 db();session();const body={id:corrected[0].id,expectedIngredients:[],ingredients:[{name:'Beurre',qty:20,unit:'g'}]}
 assert.equal((await saveRecipe(request(body))).status,200);assert.equal(calls[0].table,'mealio_update_recipe_ingredients');assert.equal(calls[0].payload.p_username,'Famille')
 setDbResolver(()=>({data:null,error:{message:'RECIPE_CONFLICT'}}));assert.equal((await saveRecipe(request(body))).status,409)
 setDbResolver(()=>({data:null,error:{message:'write failed'}}));assert.equal((await saveRecipe(request(body))).status,500)
})
test('alerte recette : lien direct vers la recette',()=>assert.equal(matcherCorrectionLink({produit:'Beurre',issue_type:'RECIPE_QUANTITY_ESTIMATED',message:'',recipe_id:'r'}),'/admin/recipes?recipe_id=r'))
test('cycle : foyer courant ou foyer de test occupé refusés avant mutation',async()=>{
 const mutations:any[]=[];const api=async(url:string,method='GET')=>{if(method!=='GET')mutations.push(url);return url==='/api/auth/me'?{username:'Famille'}:{}}
 await assert.rejects(runPurchaseCycle(api,'r','Famille',()=>{}),/foyer dédié/)
 const occupied=async(url:string,method='GET')=>{if(method!=='GET')mutations.push(url);return url==='/api/auth/me'?{username:'Famille-test'}:url==='/api/meal-plans'?{plans:[{id:'old'}]}:{}}
 await assert.rejects(runPurchaseCycle(occupied,'r','Famille-test',()=>{}),/doit être vide/);assert.equal(mutations.length,0)
})
after(()=>{const output=process.env.MEALIO_TEST_REPORT_DIR;if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'recipes-v1212-campaign.json'),JSON.stringify({recipes:report.length,scope:'56 recettes exportées + propositions v1.2.12 ; stock et Claude simulés. Pas un test Supabase réel.',resolved:report.reduce((n,r)=>n+r.resolved,0),report},null,2))}})
test('toutes les variantes corrigées : audit en quantités précises',async()=>{
 db();const ref=await loadReferenceData();ref.pantryProducts=new Map();const audit:any[]=[]
 function variants(rows:any[]):any[][]{return rows.flatMap(row=>row.alternatives?row.alternatives.flatMap((option:any)=>variants([option])):row.components?[row.components]:[[row]])}
 for(const correction of corrections){for(const group of variants(correction.ingredients)){
  const lines=parseIngredients(group.map(row=>({...row,included:true,optional:false})))
  const resolved=await resolveRecipeIngredients(lines,ref,correction.id,correction.title)
  const out=await compareToStock(aggregateRequirements([resolved]),[],ref,undefined,context())
  for(const item of out){const prepared=prepareShoppingRequirement(item,ref);if(item.quantity_unknown||item.needs_review||prepared.reference_unit_issue)audit.push({recipe:correction.title,name:item.produit,unknown:item.quantity_unknown,review:item.review_reason,conversion:prepared.reference_unit_issue})}
 }}
 const output=process.env.MEALIO_TEST_REPORT_DIR;if(output)fs.writeFileSync(path.join(output,'recipes-v1212-alternatives.json'),JSON.stringify(audit,null,2))
 assert.equal(audit.length,0,JSON.stringify(audit))
})

import { POST as lab } from '../../app/api/matcher/lab/route'
import { GET as authMe } from '../../app/api/auth/me/route'
import { GET as plansGet, POST as planCreate } from '../../app/api/meal-plans/route'
import { POST as generate } from '../../app/api/shopping-list/generate/route'
import { GET as listGet } from '../../app/api/shopping-list/route'
import { PATCH as buy } from '../../app/api/shopping-list/items/route'
import { POST as store } from '../../app/api/shopping-list/store/route'
import { POST as finish } from '../../app/api/shopping-list/finish/route'
import { POST as consume } from '../../app/api/meal-consumption/route'
import { GET as stockGet } from '../../app/api/stock/route'
import { GET as purchasesGet } from '../../app/api/purchases/route'
import { PATCH as signal } from '../../app/api/pantry/signals/route'
import { GET as replenishGet } from '../../app/api/replenishment/route'

test('intégration : vrais handlers planning → courses → achats → rangement → consommation → signal',async()=>{
 const username='Famille-test';let serial=0
 const tables:any={mealio:structuredClone(data),frosti:{},cellio:{},cookiwiki:{recipes:corrected}}
 for(const source of ['frosti','cellio']){
  const user=`${source}-test-user`,location=`${source}-location`
  tables[source]={app_users:[{id:user,username}],items:[],storage_routing_rules:[{id:`rule-${source}`,user_id:user,rule_type:source==='frosti'?'default_fridge':'default',priority:1,is_active:true,freezer_id:location,cellar_id:location}],freezers:[{id:location,user_id:user,name:'Frigo de test',is_fridge:true}],cellars:[{id:location,user_id:user,name:'Placard de test'}]}
 }
 const pantry=new Set(data.pantry_products.filter((p:any)=>p.enabled).map((p:any)=>p.ingredient_id))
 tables.mealio.official_ingredients=tables.mealio.official_ingredients.map((i:any)=>({...i,default_storage:pantry.has(i.id)?'cellio':'frosti',default_is_fridge:!pantry.has(i.id)}))
 setDbResolver((call:any)=>{
  const source=tables[call.source];source[call.table]??=[];const rows=source[call.table]
  function field(row:any,key:string){if(key==='shopping_lists.user_id')return source.shopping_lists?.find((l:any)=>l.id===row.list_id)?.user_id;return row[key]}
  const matches=(row:any)=>call.filters.every(([op,key,val]:any[])=>op==='in'?val.includes(field(row,key)):op==='neq'?field(row,key)!==val:field(row,key)===val)
  let result:any[]
  if(call.action==='insert'||call.action==='upsert'){
   const incoming=Array.isArray(call.payload)?call.payload:[call.payload];result=[]
   for(const value of incoming){
    let existing=call.action==='upsert'?rows.find((r:any)=>Object.keys(value).filter(k=>['user_id','ingredient_id','kind','shopping_item_id','recipe_id'].includes(k)).every(k=>r[k]===value[k])):null
    if(existing){Object.assign(existing,value);result.push(existing)}else{const row={id:`row-${++serial}`,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...structuredClone(value)};rows.push(row);result.push(row)}
   }
  }else if(call.action==='update'){result=rows.filter(matches);result.forEach((r:any)=>Object.assign(r,structuredClone(call.payload),{updated_at:new Date().toISOString()}))}
  else if(call.action==='delete'){result=rows.filter(matches);source[call.table]=rows.filter((r:any)=>!matches(r))}
  else result=rows.filter(matches)
  result=result.map((r:any)=>call.table==='shopping_items'?{...r,official_ingredients:source.official_ingredients?.find((i:any)=>i.id===r.ingredient_id),shopping_lists:source.shopping_lists?.find((l:any)=>l.id===r.list_id)}:r)
  return{data:structuredClone(call.single?result[0]??null:result),error:null}
 })
 setCookies({mealio_session:createSessionValue(username,'frosti-test-user')})
 const routeMap:any={
 '/api/matcher/lab':{POST:lab},'/api/auth/me':{GET:authMe},'/api/meal-plans':{GET:plansGet,POST:planCreate},'/api/shopping-list':{GET:listGet},'/api/shopping-list/generate':{POST:generate},'/api/shopping-list/items':{PATCH:buy},'/api/shopping-list/store':{POST:store},'/api/shopping-list/finish':{POST:finish},'/api/meal-consumption':{POST:consume},'/api/stock':{GET:stockGet},'/api/purchases':{GET:purchasesGet},'/api/pantry/signals':{PATCH:signal},'/api/replenishment':{GET:replenishGet},
 }
 const api=async(url:string,method='GET',body?:unknown)=>{
  const response=await routeMap[url][method](new Request(`http://mealio.test${url}`,{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})})}));const json=await response.json();assert.ok(response.ok,`${method} ${url}: ${JSON.stringify(json)}`);return json
 }
 const events:any[]=[]
 await runPurchaseCycle(api,corrected.find((r:any)=>r.title.includes('Gougères')).id,username,e=>events.push(e))
 assert.equal(events.filter(e=>e.status==='pass').length,7)
 assert.equal(tables.mealio.shopping_lists[0].status,'terminee')
 assert.ok(tables.frosti.items.length&&tables.cellio.items.length)
 assert.ok(calls.filter((c:any)=>c.table==='items'&&c.action==='update').every((c:any)=>c.filters.some((f:any)=>f[1]==='user_id'&&f[2]===`${c.source}-test-user`)))
 const output=process.env.MEALIO_TEST_REPORT_DIR;if(output)fs.writeFileSync(path.join(output,'integration-cycle-v1212.json'),JSON.stringify({scope:'Routes réelles, DB en mémoire, Claude simulé ; pas Supabase réel.',events},null,2))
})
import { recipeJsonKey } from '../../app/utils/recipe-quality-policy'
import { activeRecipeStructure } from '../../app/utils/recipe-structure-server'
test('compatibilité Cookiwiki : structure active uniquement sur sa version plate, clé jsonb stable',()=>{
 const flat=[{qty:250,name:'Olive noire',unit:'g'}],structure=[{name:'Mélange',components:flat}]
 const stored={structure,ingredients_snapshot:[{name:'Olive noire',unit:'g',qty:250}]}
 assert.equal(recipeJsonKey(flat),recipeJsonKey(stored.ingredients_snapshot));assert.deepEqual(activeRecipeStructure({ingredients:flat},stored),structure)
 const edited=[{name:'Olive noire',qty:300,unit:'g'}];assert.deepEqual(activeRecipeStructure({ingredients:edited},stored),edited)
})
test('lecteur : récupère le mélange sauvegardé à part des ingrédients plats Cookiwiki',async()=>{
 const parts=[{name:'Olive noire',qty:125,unit:'g'},{name:'Olive verte',qty:125,unit:'g'}]
 db();setDbResolver((c:any)=>({data:c.table==='recipes'?{id:'r',title:'r',servings:4,ingredients:parts}:c.table==='mealio_recipe_structures'?[{recipe_id:'r',structure:[{name:'Mélange',components:parts}],ingredients_snapshot:parts}]:[],error:null}))
 assert.equal((await getRecipeDetailsFromCookiwiki('r')).ingredients.length,2)
 setDbResolver((c:any)=>({data:c.table==='recipes'?{id:'r',title:'r',servings:4,ingredients:parts}:null,error:c.table==='mealio_recipe_structures'?{code:'42P01',message:'table absent'}:null}))
 assert.equal((await getRecipeDetailsFromCookiwiki('r')).ingredients.length,2)
})

test('association Saucisse/Saucisses : priorité sur ancienne proposition IA, conversion 120 g et exclusions',async()=>{
 db();const ref=await loadReferenceData();ref.pantryProducts=new Map()
 const sausage=ref.officialList.find(i=>i.nom==='Saucisse fraîche')!
 assert.ok(sausage);ref.synonymMap.set(cleanText('Saucisse'),sausage.id)
 ref.densities=ref.densities.filter(d=>d.ingredient_id!==sausage.id||cleanText(d.unite)!=='piece');ref.densities.push({ingredient_id:sausage.id,unite:'Pièce',poids_g_approx:120})
 const resolved=await resolveRecipeIngredients([{name:'Saucisse fraîche',qty:4,unit:'piece'}],ref,'r','r')
 const needs=aggregateRequirements([resolved]);const trace=createMatcherTrace('Saucisse fraîche')
 const stock=[{id:'s',produit:'Saucisses',qte:870,unite:'g'}]
 const memory=new Map([[cleanText('Saucisse fraîche'),[{stock_item_id:'s',confidence:0.7,validated:false}]]])
 const [out]=await compareToStock(needs,stock,ref,trace,{memory:memory as any,exclusions:new Set(),persistMemory:false})
 assert.equal(out.qte_a_acheter,0);assert.equal(out.needs_review,false);assert.equal(Boolean(out.stock_match_review),false);assert.equal(trace.claudeCalls,0)
 const [excluded]=await compareToStock(needs,stock,ref,undefined,{memory:new Map(),exclusions:new Set([`${cleanText('Saucisse fraîche')}::s`]),persistMemory:false})
 assert.equal(excluded.qte_stock,0)
})


test('liens sources : adresses par défaut, identifiants encodés et même origine',()=>{
 const oldBase=process.env.NEXT_PUBLIC_FROSTI_APP_URL,oldPath=process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH
 try {
  delete process.env.NEXT_PUBLIC_FROSTI_APP_URL;delete process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH;assert.deepEqual(stockSourceLink({source:'frosti',id:'a'}),{url:'https://frosti-ten.vercel.app/',precise:false})
  process.env.NEXT_PUBLIC_FROSTI_APP_URL='https://frosti.example';process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH='/stock/{id}?lieu={location_id}'
  const link=stockSourceLink({source:'frosti',id:'a/b',location_id:'c&d'})!;assert.equal(link.url,'https://frosti.example/stock/a%2Fb?lieu=c%26d');assert.equal(link.precise,true)
  assert.equal(stockSourceLink({source:'frosti',id:'a'}),null)
  process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH='https://other.example/{id}';assert.equal(stockSourceLink({source:'frosti',id:'a'}),null)
  process.env.NEXT_PUBLIC_FROSTI_APP_URL='javascript:alert(1)';assert.equal(stockSourceLink({source:'frosti',id:'a'}),null)
 } finally {if(oldBase===undefined)delete process.env.NEXT_PUBLIC_FROSTI_APP_URL;else process.env.NEXT_PUBLIC_FROSTI_APP_URL=oldBase;if(oldPath===undefined)delete process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH;else process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH=oldPath}
})
