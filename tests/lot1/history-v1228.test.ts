import test from 'node:test'
import assert from 'node:assert/strict'
import { analyseHistory,isPastMeal,type HistoryMeal,type HistoryPurchase } from '../../app/utils/household-history-policy'
import { getHouseholdHistory } from '../../app/utils/household-history-server'
import { GET } from '../../app/api/history/route'
import { POST } from '../../app/api/history/recommendations/route'
import { createSessionValue } from '../../app/utils/auth-server'
import { makeReferenceData,IDS } from '../../scripts/matcher-test-fixtures'
// @ts-expect-error local I/O double
import { setDbResolver,calls } from '../../test-support/db.mjs'
// @ts-expect-error local session double
import { setCookies } from '../../test-support/headers.mjs'
const today='2026-10-09'
const dates=['2026-09-04','2026-09-11','2026-09-18','2026-09-25','2026-10-02']
const products=[{id:IDS.farine,nom:'Farine de blé',unite:'Gramme',presence:false,pack:1000,packUnit:'Gramme'},{id:IDS.sel,nom:'Sel fin',unite:'Pièce',presence:true,pack:250,packUnit:'Gramme'}]
const meal=(d:string,id=d,origin:HistoryMeal['origin']='planning'):HistoryMeal=>({id,recipe_id:'recipe',recipe_nom:'Pain',scheduled_date:d,servings:4,meal_type:'midi',origin,needs:[{ingredient_id:IDS.farine,produit:'Farine de blé',quantity:500,unite:'Gramme',presence:false},{ingredient_id:IDS.sel,produit:'Sel fin',quantity:null,unite:'Présence',presence:true}]})
const purchase=(d:string,id=d):HistoryPurchase=>({id,list_id:'list',produit:'Sel fin',ingredient_id:IDS.sel,quantity:250,unite:'Gramme',purchased_at:d+'T12:00:00Z',status:'range',storage:'cellio',location_name:'Placard'})
const analysis=(meals=dates.map(d=>meal(d)),purchases:HistoryPurchase[]=[],existing=new Set<string>(),hidden=new Set<string>())=>analyseHistory(meals,purchases,today,products,existing,hidden)
test('historique : lendemain Paris seulement, dates impossibles et repas du jour exclus',()=>{assert.equal(isPastMeal('2026-10-08',today),true);for(const day of ['2026-10-09','2026-10-10','2026-02-30','inconnue'])assert.equal(isPastMeal(day,today),false)})
test('moyennes : semaines sans repas incluses, présence sans grammes et seuil proposé',()=>{const a=analysis();assert.equal(a.weeks,5);assert.equal(a.needs.find(n=>n.ingredient_id===IDS.farine)!.weekly,500);assert.equal(a.needs.find(n=>n.ingredient_id===IDS.sel)!.total,0);assert.equal(a.recommendations.length,1);assert.equal(a.recommendations[0].minimum,500);assert.equal(a.recommendations[0].quantity,1000);assert.equal(a.recipes[0].count,5);assert.equal(a.recipes[0].interval_days,7)})
test('prudence : une semaine, quatre repas le même jour, ou dose incomplète ne créent pas de seuil',()=>{assert.equal(analysis([meal('2026-10-02')]).recommendations.length,0);assert.equal(analysis(dates.map((_,i)=>meal('2026-09-04',String(i)))).recommendations.length,0);const rows=dates.map(d=>meal(d));rows[0].needs[0].quantity=null;rows[0].needs[0].warning='Dose à vérifier';const a=analysis(rows);assert.equal(a.recommendations.length,0);assert.equal(a.needs[0].incomplete,true)})
test('les besoins sont recalculés après suppression ou modification ; non-cuisinés et traitements incomplets exclus',()=>{const a=analysis([meal(dates[0]),meal(dates[1],'skip','skipped'),meal(dates[2],'process','processing')]);assert.equal(a.recipes[0].count,1);const changed=meal(dates[0]);changed.needs[0].quantity=1000;assert.equal(analysis([changed]).needs[0].total,1000);assert.equal(analysis([]).needs.length,0)})
test('présence : fréquence d’achat apprise, format du foyer, jamais dose de recette',()=>{const a=analysis([],dates.map(d=>purchase(d)));assert.equal(a.recommendations.length,1);assert.equal(a.recommendations[0].kind,'recurring');assert.equal(a.recommendations[0].quantity,250);assert.equal(a.recommendations[0].unite,'Gramme');assert.equal(a.recommendations[0].interval_days,7)})
test('historique achats : doublons le même jour, statut historique et rythme irrégulier non prédictifs',()=>{assert.equal(analysis([],Array.from({length:6},(_,i)=>purchase('2026-09-04',String(i)))).recommendations.length,0);assert.equal(analysis([],dates.map(d=>({...purchase(d),status:'historique'}))).recommendations.length,0);assert.equal(analysis([],['2026-07-01','2026-07-02','2026-07-03','2026-10-01'].map(d=>purchase(d))).recommendations.length,0)})
test('règles existantes et reports masquent les propositions sans écraser les réglages',()=>{assert.equal(analysis(undefined,dates.map(d=>purchase(d)),new Set([IDS.farine,IDS.sel])).recommendations.length,0);assert.equal(analysis(undefined,[],new Set(),new Set([`threshold:${IDS.farine}`])).recommendations.length,0)})
function session(username='Alpha'){process.env.MEALIO_SESSION_SECRET='history-test----------------------------';setCookies({mealio_session:createSessionValue(username,'uuid-'+username)})}
function setup(options:{missing?:boolean;removed?:boolean;servings?:number;pages?:boolean;estimated?:boolean;existing?:boolean;legacy?:boolean}={}){
 const ref=makeReferenceData()
 const tables:Record<string,any[]>={
  meal_plans:['Alpha','Beta'].flatMap(user_id=>dates.map((scheduled_date,i)=>({id:user_id+'-'+i,user_id,recipe_id:'recipe',scheduled_date,servings:options.servings||4,meal_type:'midi'}))),
  meal_consumption_events:[{user_id:'Alpha',meal_plan_id:'Alpha-0',recipe_id:'recipe',recipe_nom:'Pain',scheduled_date:dates[0],servings:4,status:'confirmed',consumed_items:[{produit:'Farine',qte:200,unite:'g',source:'cellio'}]},{user_id:'Beta',meal_plan_id:'Beta-0',recipe_id:'recipe',recipe_nom:'Pain',scheduled_date:dates[0],servings:4,status:'skipped',consumed_items:[]}],
  shopping_lists:['Alpha','Beta'].map(user_id=>({id:user_id+'-list',user_id})),
  shopping_purchase_events:['Alpha','Beta'].flatMap(user_id=>dates.map((d,i)=>({...purchase(d,user_id+'-purchase-'+i),list_id:user_id+'-list'}))),
  official_ingredients:ref.officialList,ingredient_synonyms:[...ref.synonymMap].map(([mot_recette,ingredient_id])=>({mot_recette,ingredient_id})),unit_mappings:ref.unitMappings,ingredient_densities:ref.densities,
  pantry_products:[{ingredient_id:IDS.sel,default_quantity:250,default_unit:'Gramme',enabled:true}],
  household_pantry_products:[{user_id:'Beta',ingredient_id:IDS.sel,default_quantity:250,default_unit:'Gramme',enabled:false}],
  recipes:[{id:'recipe',title:'Pain',servings:4,ingredients:[{name:'Farine de blé',qty:500,unit:'g',...(options.estimated?{quantity_source:'estimated'}:{})},{name:'Sel fin',qty:0,unit:''}]}],
  recurring_purchase_rules:options.legacy?[{id:'legacy',user_id:'Alpha',ingredient_id:null,produit:'Farine de blé'}]:[],
  stock_replenishment_thresholds:options.existing?[{id:'rule',user_id:'Alpha',ingredient_id:IDS.farine}]:[],
 }
 if(options.removed)tables.meal_plans=tables.meal_plans.filter(p=>p.id!=='Alpha-1')
 if(options.pages)tables.shopping_purchase_events=Array.from({length:501},(_,i)=>({...purchase('2026-09-04',String(i)),list_id:'Alpha-list'}))
 setDbResolver((c:any)=>{
  if(c.table==='household_history_decisions'&&options.missing)return{data:null,error:{code:'42P01',message:'missing'}}
  if(c.action==='rpc')return {data:{rule_id:'new-rule',already_exists:false},error:null}
  if(c.action!=='select')return {data:c.payload,error:null}
  let rows=(tables[c.table]||[]).filter(r=>c.filters.every(([op,key,value]:any[])=>op==='in'?value.includes(r[key]):op==='neq'?r[key]!==value:r[key]===value))
  if(c.range)rows=rows.slice(c.range[0],c.range[1]+1)
  return{data:c.single?rows[0]||null:rows,error:null}
 })
}
test('API historique : authentification avant toute lecture',async()=>{setCookies({});setup();assert.equal((await GET()).status,401);assert.equal((await POST(new Request('http://local',{method:'POST',body:'{}'}))).status,401);assert.equal(calls.length,0)})
test('lecture seule : aucun Claude ni stock, repas confirmé compté une fois et besoins distincts des déductions',async()=>{setup();globalThis.fetch=async()=>{throw Error('HTTP/Claude interdit')};const h=await getHouseholdHistory('Alpha',new Date(today+'T10:00:00Z'));assert.equal(h.meals.length,5);assert.equal(h.meals.filter(m=>m.origin==='confirmed').length,1);assert.equal(h.consumptions.length,1);assert.equal(h.consumptions[0].quantity,200);assert.equal(h.analysis.needs.find(n=>n.ingredient_id===IDS.farine)!.total,2500);assert.ok(calls.every((c:any)=>c.action==='select'&&!['items','matcher_stock_analysis_cache'].includes(c.table)))})
test('isolation : achats par listes possédées et modes de suivi propres au foyer',async()=>{setup();const a=await getHouseholdHistory('Alpha',new Date(today)),b=await getHouseholdHistory('Beta',new Date(today));assert.ok(a.purchases.every(p=>p.id.startsWith('Alpha-')));assert.ok(b.purchases.every(p=>p.id.startsWith('Beta-')));assert.equal(a.analysis.needs.find(n=>n.ingredient_id===IDS.sel)!.presence,true);assert.equal(b.analysis.needs.find(n=>n.ingredient_id===IDS.sel)!.presence,false);assert.equal(b.meals.filter(m=>m.origin==='skipped').length,1);assert.equal(b.consumptions.length,0)})
test('pagination : aucun achat perdu au-delà de 500 lignes',async()=>{setup({pages:true});const h=await getHouseholdHistory('Alpha',new Date(today));assert.equal(h.purchases.length,501);assert.ok(calls.some((c:any)=>c.table==='shopping_purchase_events'&&c.range[0]===500))})
test('suppression planning et portions : besoins déduits mis à jour, journal confirmé inchangé',async()=>{setup({removed:true,servings:8});const h=await getHouseholdHistory('Alpha',new Date(today));assert.equal(h.meals.length,4);assert.equal(h.consumptions[0].quantity,200);assert.equal(h.analysis.needs.find(n=>n.ingredient_id===IDS.farine)!.total,3500)})
test('estimations non confirmées : affichées mais pas de recommandation quantitative',async()=>{setup({estimated:true});const h=await getHouseholdHistory('Alpha',new Date(today));assert.equal(h.analysis.needs.find(n=>n.ingredient_id===IDS.farine)!.incomplete,true);assert.ok(!h.analysis.recommendations.some(r=>r.kind==='threshold'))})
test('SQL absent : consultation possible, activation indisponible et warning explicite',async()=>{setup({missing:true});const h=await getHouseholdHistory('Alpha',new Date(today));assert.equal(h.canActivate,false);assert.ok(h.warnings.some(w=>w.includes('SQL Mealio 1.2.28')))})
const request=(body:unknown)=>new Request('http://local/api/history/recommendations',{method:'POST',body:JSON.stringify(body)})
test('activation : proposition recalculée côté serveur, foyer de session, suggestion et paramètres modifiables',async()=>{setup();session();const r=await POST(request({action:'accept',key:`threshold:${IDS.farine}`,quantity:1200,minimum:600,user_id:'Beta',ingredient_id:IDS.sel,unite:'Pièce'}));assert.equal(r.status,200);const rpc=calls.find((c:any)=>c.action==='rpc');assert.equal(rpc.table,'activate_history_replenishment');assert.equal(rpc.payload.p_user_id,'Alpha');assert.equal(rpc.payload.p_ingredient_id,IDS.farine);assert.equal(rpc.payload.p_unite,'Gramme');assert.equal(rpc.payload.p_quantity,1200);assert.equal(rpc.payload.p_minimum,600);assert.ok(!calls.some((c:any)=>c.table==='items'))})
test('activation : règle existante, clé inventée et valeurs invalides refusées sans écriture',async()=>{setup({existing:true});session();assert.equal((await POST(request({action:'accept',key:`threshold:${IDS.farine}`,quantity:1000}))).status,409);assert.ok(!calls.some((c:any)=>c.action!=='select'));setup();assert.equal((await POST(request({action:'accept',key:'forged',quantity:1000}))).status,409);assert.equal((await POST(request({action:'accept',key:`threshold:${IDS.farine}`,quantity:100,minimum:200}))).status,400);assert.equal((await POST(request({action:'accept',key:`recurring:${IDS.sel}`,quantity:250,interval_days:0}))).status,400);assert.ok(!calls.some((c:any)=>c.action!=='select'))})
test('report : trente jours, décision du seul foyer connecté',async()=>{setup();session();const r=await POST(request({action:'snooze',key:`recurring:${IDS.sel}`,user_id:'Beta'}));assert.equal(r.status,200);const write=calls.find((c:any)=>c.action==='upsert');assert.equal(write.payload.user_id,'Alpha');assert.equal(write.payload.decision,'snoozed');assert.match(write.payload.until_date,/^\d{4}-\d{2}-\d{2}$/);setCookies({})})

test('ancienne règle sans ID officiel : reconnue par son libellé, aucune proposition en doublon',async()=>{setup({legacy:true});const h=await getHouseholdHistory('Alpha',new Date(today));assert.ok(!h.analysis.recommendations.some(r=>r.ingredient_id===IDS.farine))})

test('recettes mensuelles : rythme détecté sur douze mois, indépendant des douze semaines des besoins',()=>{const a=analysis(['2026-06-01','2026-07-01','2026-08-01','2026-09-01','2026-10-01'].map(d=>meal(d)));assert.equal(a.recipes[0].count,5);assert.ok(a.recipes[0].interval_days!>=30&&a.recipes[0].interval_days!<=31);assert.ok(a.weeks<=12)})
