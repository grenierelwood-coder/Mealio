import test from 'node:test'
import assert from 'node:assert/strict'
import { forecastPurchases, activeAlmostFinished, parisDate, type PantryPurchase } from '../../app/utils/pantry-history-policy'
import { loadHouseholdPurchases, setPantrySignal } from '../../app/utils/pantry-signals-server'
import { getReplenishmentSuggestions, addReplenishmentToActiveList, processReplenishmentForCourses } from '../../app/utils/replenishment-server'
import { PATCH as signalPatch } from '../../app/api/pantry/signals/route'
import { POST as addPost } from '../../app/api/replenishment/add/route'
import { createSessionValue } from '../../app/utils/auth-server'
// @ts-expect-error local I/O doubles
import { calls, setDbResolver } from '../../test-support/db.mjs'
// @ts-expect-error local I/O doubles
import { setCookies } from '../../test-support/headers.mjs'
const id='988905da-104f-4c15-875f-1dacc479cac3'
const policy={ingredient_id:id,enabled:true,default_quantity:1000,default_unit:'Gramme'}
const now=new Date('2026-10-07T12:00:00Z')
const events:PantryPurchase[]=['2026-09-07','2026-09-14','2026-09-21','2026-09-28'].map(d=>({ingredient_id:id,quantity:1000,unite:'Gramme',purchased_at:d+'T10:00:00Z',status:'range'}))
const flag={ingredient_id:id,kind:'almost_finished' as const,signaled_at:'2026-10-06T10:00:00Z',until_date:null}
function session(){process.env.MEALIO_SESSION_SECRET='history-test';setCookies({mealio_session:createSessionValue('Famille','frosti-user')})}
function db(options:{signals?:any[],events?:any[],enabled?:boolean,candidates?:any[],stock?:boolean}={}){
  setDbResolver((call:any)=>{
    if(call.action==='rpc')return {data:{item:options.candidates?.[0] ?? {id:'new',qte_achat:call.payload.p_quantity},merged:Boolean(options.candidates?.length)},error:null}
    if(call.action!=='select') return {data:call.single?{id:'new',...call.payload}:[],error:null}
    if(call.table==='pantry_products') return {data:[policy],error:null}
    if(call.table==='household_pantry_products')return {data:[{...policy,enabled:options.enabled!==false}],error:null}
    if(call.table==='household_pantry_signals')return {data:options.signals ?? [],error:null}
    if(call.table==='shopping_lists')return {data:call.single?{id:'own'}:[{id:'own'}],error:null}
    if(call.table==='shopping_purchase_events')return {data:options.events ?? events,error:null}
    if(call.table==='official_ingredients')return {data:call.single?{id,nom:'Farine de blé',unite_reference:'Gramme'}:[{id,nom:'Farine de blé'}],error:null}
    if(call.table==='unit_mappings')return {data:[{unite:'Gramme',abreviation:'g'}],error:null}
    if(call.table==='app_users')return {data:{id:'stock-user'},error:null}
    if(call.table==='items')return {data:options.stock?[{id:'flour-stock',produit:'Farine de blé',qte:1,unite:'Pièce'}]:[],error:null}
    if(call.table==='shopping_items')return {data:options.candidates ?? [],error:null}
    return {data:[],error:null}
  })
}
test('4 jours d’achat : intervalle médian 7 jours, alerte anticipée de 2 jours',()=>{
  assert.deepEqual(forecastPurchases(events,id,now),{ingredient_id:id,purchases:4,interval_days:7,due_date:'2026-10-05',alert_date:'2026-10-03',last_purchased_at:'2026-09-28T10:00:00Z'})
})
for(const count of [0,1,2,3])test(`${count} achats espacés : apprentissage insuffisant`,()=>assert.equal(forecastPurchases(events.slice(0,count),id,now),null))
test('plusieurs paquets le même jour : une seule observation',()=>{
  const duplicate=[...events,...events.map(e=>({...e,quantity:3000,purchased_at:e.purchased_at.replace('10:','18:')}))]
  assert.equal(forecastPurchases(duplicate,id,now)!.purchases,4)
})
for(const invalid of [0,-1,NaN,Infinity])test(`achat ${invalid} exclu`,()=>{
  assert.equal(forecastPurchases(events.map(e=>({...e,quantity:invalid})),id,now),null)
})
test('achats annulés ou futurs exclus',()=>{
  assert.equal(forecastPurchases(events.map(e=>({...e,status:'cancelled'})),id,now),null)
  assert.equal(forecastPurchases(events,id,new Date('2026-08-01')),null)
})
test('intervalles irréguliers : pas de suggestion prédictive',()=>{
  assert.equal(forecastPurchases(['2026-01-01','2026-01-04','2026-03-01','2026-09-01'].map(d=>({...events[0],purchased_at:d})),id,now),null)
})
test('historique isolé par ingrédient, sans estimation de consommation',()=>{
  assert.equal(forecastPurchases(events,'autre',now),null)
  assert.equal('weekly_consumption' in forecastPurchases(events,id,now)!,false)
})
test('jour d’achat calculé en Europe/Paris',()=>assert.equal(parisDate('2026-10-06T23:30:00Z'),'2026-10-07'))
test('nouvel achat acquitte le signal ; ancien achat ne le masque pas',()=>{
  assert.equal(activeAlmostFinished(flag,'2026-10-07T10:00:00Z'),false)
  assert.equal(activeAlmostFinished(flag,'2026-10-05T10:00:00Z'),true)
  assert.equal(activeAlmostFinished(flag,null),true)
})
test('historique lu uniquement par les listes du foyer',async()=>{
  db();await loadHouseholdPurchases('Famille')
  assert.ok(calls.find((c:any)=>c.table==='shopping_lists').filters.some((f:any)=>f[1]==='user_id'&&f[2]==='Famille'))
  assert.deepEqual(calls.find((c:any)=>c.table==='shopping_purchase_events').filters,[['in','list_id',['own']]])
})
test('lecture des listes en erreur : pas d’historique vide inventé',async()=>{
  setDbResolver(()=>({data:[],error:{message:'offline'}}));await assert.rejects(loadHouseholdPurchases('Famille'),/indisponible/)
})
test('signal manuel : proposition même avec stock, format du foyer, pas de modification stock',async()=>{
  db({signals:[flag],stock:true});const s=await getReplenishmentSuggestions('Famille')
  assert.equal(s.length,1);assert.equal(s[0].source,'almost_finished');assert.equal(s[0].quantity,1000);assert.equal(s[0].mode,'suggestion')
  assert.ok(calls.every((c:any)=>c.action==='select'))
})
test('historique : proposition même si présence ; aucune création automatique',async()=>{
  db({stock:true});const result=await processReplenishmentForCourses('Famille')
  assert.equal(result.suggestions[0].source,'history');assert.deepEqual(result.systematicAdded,[])
  assert.ok(!calls.some((c:any)=>c.action!=='select'))
})
test('mode quantitatif : signaux et prévisions épicerie ignorés',async()=>{
  db({signals:[flag],enabled:false});assert.deepEqual(await getReplenishmentSuggestions('Famille'),[])
})
test('report 7 jours : masque uniquement la prévision, pas le signal manuel',async()=>{
  const snooze={ingredient_id:id,kind:'history_snooze',signaled_at:'2026-10-06',until_date:'2030-01-01'}
  db({signals:[snooze]});assert.deepEqual(await getReplenishmentSuggestions('Famille'),[])
  db({signals:[snooze,flag]});assert.equal((await getReplenishmentSuggestions('Famille'))[0].source,'almost_finished')
})
test('signal acquitté par achat récent : aucun ancien signal dans les propositions',async()=>{
  db({signals:[flag],events:[...events,{...events[0],purchased_at:'2026-10-07T00:00:00Z'}]})
  assert.ok(!(await getReplenishmentSuggestions('Famille')).some(s=>s.source==='almost_finished'))
})
test('signal : session obligatoire avant tout accès DB',async()=>{
  setCookies({});db();assert.equal((await signalPatch(new Request('http://test',{method:'PATCH',body:'{}'}))).status,401);assert.equal(calls.length,0)
})
test('signal : foyer injecté ignoré, aucune modification des stocks',async()=>{
  session();db();const result=await signalPatch(new Request('http://test',{method:'PATCH',body:JSON.stringify({ingredient_id:id,action:'almost_finished',user_id:'Autre foyer'})}))
  assert.equal(result.status,200)
  const writes=calls.filter((c:any)=>c.action!=='select');assert.equal(writes.length,1);assert.equal(writes[0].table,'household_pantry_signals');assert.equal(writes[0].payload.user_id,'Famille')
})
test('signal invalide et produit quantitatif refusés',async()=>{
  session();db();assert.equal((await signalPatch(new Request('http://test',{method:'PATCH',body:JSON.stringify({ingredient_id:'bad',action:'almost_finished'})}))).status,400)
  db({enabled:false});await assert.rejects(setPantrySignal('Famille',id,'almost_finished'),/présence/)
})
test('annulation isolée au foyer et au produit',async()=>{
  db();await setPantrySignal('Famille',id,'cancel')
  const write=calls.find((c:any)=>c.action==='delete');assert.deepEqual(write.filters,[['eq','user_id','Famille'],['eq','ingredient_id',id],['eq','kind','almost_finished']])
})
test('double ajout d’alerte : ne multiplie pas une ligne déjà aux courses',async()=>{
  db({candidates:[{id:'existing',ingredient_id:id,produit:'Farine de blé',qte:1000,qte_achat:1000,unite:'Gramme'}]})
  const result=await addReplenishmentToActiveList('Famille',{produit:'Farine de blé',ingredient_id:id,quantity:1000,unite:'Gramme',source:'history'})
  assert.equal(result.merged,true);assert.equal(result.item.qte_achat,1000);assert.equal(calls.filter((c:any)=>c.action==='rpc').length,1);assert.ok(!calls.some((c:any)=>['insert','update'].includes(c.action)))
})
test('API ajout : format historique recalculé côté serveur, quantité injectée ignorée',async()=>{
  session();db();const result=await addPost(new Request('http://test',{method:'POST',body:JSON.stringify({source:'history',ingredient_id:id,quantity:999999,unite:'Pièce',produit:'Injection'})}))
  assert.equal(result.status,200)
  const write=calls.find((c:any)=>c.action==='rpc');assert.equal(write.payload.p_quantity,1000);assert.equal(write.payload.p_produit,'Farine de blé');assert.equal(write.payload.p_unite,'Gramme');assert.equal(write.payload.p_user_id,'Famille')
})

import { GET as stockGet } from '../../app/api/stock/route'
test('Stock : bouton exposé pour un produit présent du foyer, signal partagé entre lignes',async()=>{
  session();db({signals:[flag],stock:true});const result=await stockGet();const body=await result.json()
  assert.equal(result.status,200);assert.ok(body.items.length>0)
  assert.ok(body.items.every((i:any)=>i.pantry_ingredient_id===id && i.almost_finished===true))
})
test('Stock : bouton absent pour le mode quantitatif',async()=>{
  session();db({signals:[flag],stock:true,enabled:false});const result=await stockGet();const body=await result.json()
  assert.equal(result.status,200);assert.ok(body.items.every((i:any)=>i.pantry_ingredient_id===null))
})
test('Stock : achat récent acquitte visuellement le signal',async()=>{
  session();db({signals:[flag],stock:true,events:[{...events[0],purchased_at:'2026-10-07T00:00:00Z'}]})
  const result=await stockGet();const body=await result.json();assert.equal(result.status,200)
  assert.ok(body.items.every((i:any)=>i.almost_finished===false))
})
test('Stock : session obligatoire avant les nouveaux historiques',async()=>{
  setCookies({});db();assert.equal((await stockGet()).status,401);assert.equal(calls.length,0)
})
test('ajout d’une alerte périmée : refus avant toute écriture courses',async()=>{
  session();db({enabled:false});const result=await addPost(new Request('http://test',{method:'POST',body:JSON.stringify({source:'history',ingredient_id:id,quantity:1000,unite:'Gramme',produit:'Farine'})}))
  assert.equal(result.status,400);assert.ok(calls.every((c:any)=>c.action==='select'))
})

test('historique paginé : conserve les achats au-delà de 1000 lignes',async()=>{
  setDbResolver((call:any)=>{
    if(call.table==='shopping_lists')return {data:[{id:'own'}],error:null}
    const offset=call.range[0]
    return {data:offset===0?Array.from({length:1000},()=>events[0]):[events[1]],error:null}
  })
  const rows=await loadHouseholdPurchases('Famille');assert.equal(rows.length,1001)
  assert.deepEqual(calls.filter((c:any)=>c.table==='shopping_purchase_events').map((c:any)=>c.range),[[0,999],[1000,1999]])
})

test('transaction d’ajout indisponible : erreur explicite, pas de repli non atomique',async()=>{
  setDbResolver((call:any)=>call.action==='rpc'?{data:null,error:{message:'rpc offline'}}:
    {data:call.table==='pantry_products'?[policy]:call.table==='official_ingredients'?{id,unite_reference:'Gramme'}:call.table==='unit_mappings'?[{unite:'Gramme',abreviation:'g'}]:[],error:null})
  await assert.rejects(addReplenishmentToActiveList('Famille',{produit:'Farine de blé',ingredient_id:id,quantity:1000,unite:'Gramme',source:'history'}),/rpc offline/)
  assert.ok(!calls.some((c:any)=>['insert','update'].includes(c.action)))
})

test('Stock : noms précis Frosti et Cellio filtrés sur leurs utilisateurs distincts',async()=>{
  session();setDbResolver((call:any)=>{
    if(call.table==='app_users')return {data:{id:`${call.source}-household`},error:null}
    if(call.table==='items')return {data:call.source==='frosti'?[{id:'f',produit:'Carotte',qte:2,unite:'Pièce',congelo_id:'fridge'}]:[{id:'c',produit:'Farine',qte:1,unite:'Pièce',cellar_id:'cupboard'}],error:null}
    if(call.table==='freezers')return {data:[{id:'fridge',name:'Frigo cuisine',is_fridge:true}],error:null}
    if(call.table==='cellars')return {data:[{id:'cupboard',name:'Placard du couloir',is_secondary:false}],error:null}
    return {data:[],error:null}
  })
  const response=await stockGet();const body=await response.json();assert.equal(response.status,200)
  assert.equal(body.frosti[0].location_name,'Frigo cuisine');assert.equal(body.frosti[0].location_is_fridge,true)
  assert.equal(body.cellio[0].location_name,'Placard du couloir')
  for(const table of ['freezers','cellars']){
    const call=calls.find((c:any)=>c.table===table)
    assert.ok(call.filters.some((f:any)=>f[1]==='user_id'&&f[2]===`${call.source}-household`))
  }
})
