import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReferenceData, resolveIngredientDecision, cleanText, convertQuantityToUnit, resolveRecipeIngredients, aggregateRequirements, compareToStock, validateMatcherDecision, rejectMatcherDecision, forgetMatcherDecision } from '../../app/utils/matcher'
import { getRecipeDetailsFromCookiwiki, parseIngredients } from '../../app/utils/cookiwiki-fetcher'
import { prepareShoppingRequirement } from '../../app/utils/shopping-requirement-policy'
import { matcherCorrectionLink } from '../../app/utils/matcher-correction-link'
import { addReplenishmentToActiveList } from '../../app/utils/replenishment-server'
import { POST as association } from '../../app/api/matcher/association/route'
import { PATCH as inventory } from '../../app/api/point-frigo/route'
import { createSessionValue } from '../../app/utils/auth-server'
// @ts-expect-error local doubles
import { calls, setDbResolver } from '../../test-support/db.mjs'
// @ts-expect-error local doubles
import { setCookies } from '../../test-support/headers.mjs'
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures')
const read=(f:string)=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))
const base=read('reference-snapshot.json'), previous=read('reference-enrichment.json'), delta=read('reference-defaults-v1210.json'), recipes=read('cookiwiki-56.json')
const data=structuredClone(base)
for(const i of delta.new_ingredients)if(!data.official_ingredients.some((x:any)=>x.nom===i.nom))data.official_ingredients.push({...i,id:`new-${i.nom}`})
for(const u of previous.units)if(!data.unit_mappings.some((x:any)=>x.unite===u.unite))data.unit_mappings.push(u)
for(const [name,unit] of Object.entries(delta.reference_units)){const i=data.official_ingredients.find((i:any)=>i.nom===name);if(i)i.unite_reference=unit}
for(const row of [...previous.aliases,...delta.aliases]){
 const target=data.official_ingredients.find((i:any)=>i.nom===row.ingredient_name)
 if(target&&!data.ingredient_synonyms.some((s:any)=>cleanText(s.mot_recette)===cleanText(row.alias))&&!data.official_ingredients.some((i:any)=>cleanText(i.nom)===cleanText(row.alias)&&i.id!==target.id))data.ingredient_synonyms.push({mot_recette:row.alias,ingredient_id:target.id})
}
for(const m of delta.masses){const i=data.official_ingredients.find((i:any)=>i.nom===m.ingredient_name);if(i&&!data.ingredient_densities.some((d:any)=>d.ingredient_id===i.id&&d.unite===m.unite))data.ingredient_densities.push({ingredient_id:i.id,unite:m.unite,poids_g_approx:m.grams})}
const ail=data.official_ingredients.find((i:any)=>i.nom==='Ail')
data.ingredient_densities=data.ingredient_densities.filter((d:any)=>d.ingredient_id!==ail.id||cleanText(d.unite)!=='piece')
data.ingredient_densities.find((d:any)=>d.ingredient_id===ail.id&&d.unite==='Gousse').poids_g_approx=5
data.pantry_products=read('pantry-defaults.json')
process.env.MEALIO_SESSION_SECRET='defaults-secret';process.env.ANTHROPIC_API_KEY='local-test'
globalThis.fetch=async()=>Response.json({content:[{type:'text',text:'{"match":"AUCUN","confidence":0}'}]})
function session(){setCookies({mealio_session:createSessionValue('Famille','frosti-user')})}
function db(errorTable?:string){setDbResolver((c:any)=>{
 if(c.table===errorTable)return{data:null,error:{message:'write failed'}}
 if(c.table==='official_ingredients'&&c.single)return{data:data.official_ingredients.find((i:any)=>i.id===c.filters.find((f:any)=>f[1]==='id')?.[2])||null,error:null}
 if(c.table==='shopping_lists')return{data:{id:'list'},error:null}
 if(c.table==='shopping_items'&&c.action==='insert')return{data:{...c.payload,id:'new-item'},error:null}
 if(c.table==='recipes'){const id=c.filters.find((f:any)=>f[1]==='id')?.[2];return{data:recipes.find((r:any)=>r.id===id)||null,error:null}}
 if(c.table==='app_users')return{data:{id:`${c.source}-user`,username:'Famille'},error:null}
 if(c.table==='items'){
  const rows=c.source==='frosti'?[{id:'a',produit:'Ail',qte:1,unite:'Pièce',congelo_id:'cold'},{id:'b',produit:'Oignon',qte:2,unite:'Pièce',congelo_id:'other'}]:[{id:'c',produit:'Oignon',qte:1,unite:'Pièce',cellar_id:'dry'}]
  return{data:c.action==='update'?{...rows.find(r=>r.id===c.filters.find((f:any)=>f[1]==='id')?.[2]),...c.payload}:rows,error:null}
 }
 return{data:c.single?null:data[c.table]??[],error:null}
})}
const req=(body:any)=>new Request('http://mealio.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const stockContext=()=>({memory:new Map(),exclusions:new Set<string>()})
const report:any[]=[]
for(const recipe of recipes)test(`moyennes : recette ${recipe.title}`,async()=>{
 db();setCookies({});const ref=await loadReferenceData()
 const cooked=await getRecipeDetailsFromCookiwiki(recipe.id);assert.ok(cooked)
 const needs=aggregateRequirements([await resolveRecipeIngredients(cooked!.ingredients,ref,recipe.id,recipe.title)])
 const out=await compareToStock(needs,[],ref,undefined,stockContext())
 const prepared=out.map(n=>prepareShoppingRequirement(n,ref))
 assert.equal(out.length,needs.length)
 for(const n of out)assert.ok(Number.isFinite(n.qte_a_acheter)&&n.qte_a_acheter>=0)
 // Matching full stock must cover all trusted quantities, not pending identities.
 const full=needs.filter(n=>n.ingredient_id&&!n.needs_review&&!n.quantity_unknown).map((n,i)=>({id:`f-${i}`,produit:n.produit,qte:n.qte,unite:n.unite}))
 const covered=await compareToStock(needs,full,ref,undefined,stockContext())
 for(const n of covered.filter(n=>n.ingredient_id&&!n.needs_review&&!n.quantity_unknown))assert.ok(n.qte_a_acheter<.000001)
 report.push({recipe:recipe.title,lines:needs.length,resolved:needs.filter(n=>n.ingredient_id&&!n.needs_review).length,remaining:needs.filter(n=>n.needs_review||n.quantity_unknown).map(n=>({name:n.produit,reason:n.review_reason,unknown:n.quantity_unknown})),conversions:prepared.filter(n=>n.reference_unit_issue).map(n=>({name:n.produit,reason:n.reference_unit_issue}))})
})
test('moyennes initiales : masses positives et conversions réversibles',async()=>{
 db();setCookies({});const ref=await loadReferenceData();ref.pantryProducts=new Map()
 for(const m of delta.masses){const i=ref.officialList.find(i=>i.nom===m.ingredient_name)!;assert.ok(m.grams>0)
 const grams=convertQuantityToUnit(ref,i.id,2,m.unite,'Gramme');assert.ok(grams,`${m.ingredient_name}/${m.unite} → g`)
 const back=convertQuantityToUnit(ref,i.id,grams!.qty,'Gramme',m.unite);assert.ok(back,`${m.ingredient_name}/${m.unite} ← g`);assert.ok(Math.abs(back!.qty-2)<.000001)
 }
})
test('ail : 2 gousses = 10 g ; Pièce interdite même avec une densité ancienne',async()=>{
 db();const ref=await loadReferenceData();ref.densities.push({ingredient_id:ail.id,unite:'Pièce',poids_g_approx:50})
 assert.equal(convertQuantityToUnit(ref,ail.id,2,'Gousse','Gramme')?.qty,10)
 assert.equal(convertQuantityToUnit(ref,ail.id,1,'Pièce','Gramme'),null)
 assert.deepEqual(parseIngredients([{name:"Gousses d'ail",qty:2,unit:'pièces'}]),[{name:'Ail',qty:2,unit:'gousse'}])
 const [r]=await resolveRecipeIngredients([{name:'Ail',qty:2,unit:'Pièce'}],ref,'r','r');assert.equal(r.needs_review,true);assert.equal(r.ingredient_id,null)
})
test('formats : deux masses explicites permettent tête/gousse et bouteille/mL',async()=>{
 db();const ref=await loadReferenceData();assert.equal(convertQuantityToUnit(ref,ail.id,1,'Tête','Gousse')?.qty,10)
 const vin=ref.officialList.find(i=>i.nom==='Vin rouge (cuisine)')!;assert.equal(convertQuantityToUnit(ref,vin.id,1,'Bouteille','Millilitre')?.qty,750)
})
test('oignon : 100 g couvrent 2/3 pièce avec moyenne de 150 g',async()=>{
 db();const ref=await loadReferenceData();const i=ref.officialList.find(i=>i.nom==='Oignon')!
 assert.ok(Math.abs(convertQuantityToUnit(ref,i.id,100,'Gramme','Pièce')!.qty-2/3)<.000001)
 const [need]=await resolveRecipeIngredients([{name:'Oignon',qty:2,unit:'Pièce'}],ref,'r','r')
 const [compared]=await compareToStock(aggregateRequirements([[need]]),[{id:'o',produit:'Oignon',qte:100,unite:'g'}],ref,undefined,stockContext())
 const prepared=prepareShoppingRequirement(compared,ref);assert.equal(prepared.qte_a_acheter,2);assert.ok(Math.abs(prepared.qte_stock!-2/3)<.000001)
})
test('réappro : une ancienne règle de 300 g d’oignon devient 2 Pièces',async()=>{db();session();const onion=data.official_ingredients.find((i:any)=>i.nom==='Oignon');await addReplenishmentToActiveList('Famille',{produit:'Oignon',ingredient_id:onion.id,quantity:300,unite:'Gramme',source:'threshold'});const write=calls.find((c:any)=>c.table==='shopping_items'&&c.action==='insert');assert.equal(write.payload.unite,'Pièce');assert.equal(write.payload.qte_achat,2)})
test('association : session obligatoire sans accès DB',async()=>{setCookies({});db();assert.equal((await association(req({name:'a',ingredient_id:'b'}))).status,401);assert.equal(calls.length,0)})
test('association : conflit officiel refusé',async()=>{db();session();assert.equal((await association(req({name:'Ail',ingredient_id:data.official_ingredients.find((i:any)=>i.nom==='Oignon').id}))).status,409)})
test('association : DB en erreur ne produit aucun succès',async()=>{db();session();const original=(c:any)=>({data:c.single?null:data[c.table]??[],error:c.action==='rpc'?{message:'write failed'}:null});setDbResolver(original);assert.equal((await association(req({name:'Libellé neuf',ingredient_id:ail.id}))).status,500)})
test('association : enregistrée puis réutilisée sans IA',async()=>{
 db();session();const response=await association(req({name:'Libellé neuf',ingredient_id:ail.id}));assert.equal(response.status,200)
 const saved=calls.find((c:any)=>c.table==='save_matcher_association'&&c.action==='rpc');assert.ok(saved)
 const aliases=[...data.ingredient_synonyms,{mot_recette:saved.payload.p_name,ingredient_id:saved.payload.p_ingredient_id}]
 setDbResolver((c:any)=>({data:c.table==='ingredient_synonyms'?aliases:c.single?null:data[c.table]??[],error:null}))
 const ref=await loadReferenceData();const remembered=await resolveIngredientDecision('Libellé neuf',ref);assert.equal(remembered.id,ail.id);assert.equal(remembered.decision.source,'synonym');assert.equal(remembered.aiProposed,false)
 assert.equal((await association(req({name:'Libellé neuf',ingredient_id:ail.id}))).status,200)
 assert.ok(!calls.some((c:any)=>c.action==='rpc'))
})
for(const fn of [validateMatcherDecision,rejectMatcherDecision,forgetMatcherDecision])test(`mémoire : ${fn.name} remonte les erreurs DB`,async()=>{db(fn===rejectMatcherDecision?'matcher_exclusions':'matcher_memory');await assert.rejects(fn('Ail',{id:'frosti:a',produit:'Ail',qte:2,unite:'Gousse'}),/write failed/)})
test('liens : proposition stock ouvre son libellé, conversion ouvre Admin',()=>{
 assert.ok(matcherCorrectionLink({produit:'Oignon',issue_type:'STOCK_MATCH_REVIEW',message:'Proposition IA à valider : « Oignons frais ». Le stock non déduit.'}).includes(encodeURIComponent('Oignons frais')))
 assert.ok(matcherCorrectionLink({produit:'Oignon',issue_type:'STOCK_CONVERSION_MISSING',message:''}).startsWith('/admin/ingredients?'))
 assert.ok(matcherCorrectionLink({produit:'Saucisses',issue_type:'STOCK_MATCH_REVIEW',message:'Proposition « Saucisse fraîche » pour « Saucisses bretonnes (ou saucisses fraîches) » à valider.'}).includes(encodeURIComponent('Saucisses bretonnes (ou saucisses fraîches)')))
})
const correction={id:'a',source:'frosti',qte:10,unite:'Gousse',expected_qte:1,expected_unite:'Pièce'}
test('inventaire : corrige ail en Gousse dans le lieu choisi',async()=>{db();session();assert.equal((await inventory(req({source:'frosti',location_id:'cold',items:[correction]}))).status,200);const write=calls.find((c:any)=>c.table==='items'&&c.action==='update');assert.ok(write.filters.some((f:any)=>f[1]==='user_id'&&f[2]==='frosti-user'));assert.equal(write.payload.unite,'Gousse')})
test('inventaire : lot multi-lieux refusé avant toute écriture',async()=>{db();session();const response=await inventory(req({source:'frosti',location_id:'cold',items:[correction,{id:'b',source:'frosti',qte:3,unite:'Pièce',expected_qte:2,expected_unite:'Pièce'}]}));assert.equal(response.status,409);assert.ok(!calls.some((c:any)=>c.action==='update'))})
test('inventaire : source extérieure, stock modifié et ail Pièce refusés',async()=>{
 for(const body of [{source:'cellio',location_id:'dry',items:[correction]},{source:'frosti',location_id:'cold',items:[{...correction,expected_qte:8}]},{source:'frosti',location_id:'cold',items:[{...correction,unite:'Pièce'}]}]){db();session();assert.ok((await inventory(req(body))).status>=400);assert.ok(!calls.some((c:any)=>c.action==='update'))}
})
test('inventaire Cellio : UUID propre à Cellio pour son placard',async()=>{db();session();assert.equal((await inventory(req({source:'cellio',location_id:'dry',items:[{id:'c',source:'cellio',qte:2,unite:'Pièce',expected_qte:1,expected_unite:'Pièce'}]}))).status,200);assert.ok(calls.find((c:any)=>c.table==='items'&&c.action==='update').filters.some((f:any)=>f[1]==='user_id'&&f[2]==='cellio-user'))})
after(()=>{const output=process.env.MEALIO_TEST_REPORT_DIR;if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'defaults-v1210-campaign.json'),JSON.stringify({recipes:report.length,resolved:report.reduce((n,r)=>n+r.resolved,0),report},null,2))}})
