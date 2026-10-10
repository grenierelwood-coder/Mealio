import test from 'node:test'
import { NextRequest } from 'next/server'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createSessionValue, verifySessionValue } from '../../app/utils/auth-server'
import { getHouseholdStock } from '../../app/utils/stock-fetcher'
import { POST as lab } from '../../app/api/matcher/lab/route'
import { POST as matcherTest } from '../../app/api/matcher/test/route'
import { POST as resolve } from '../../app/api/matcher/resolve/route'
import { POST as feedback } from '../../app/api/matcher/feedback/route'
import { makeReferenceData, IDS } from '../../scripts/matcher-test-fixtures'
// @ts-expect-error local I/O doubles are supplied by scripts/test-offline.mjs
import { setCookies } from '../../test-support/headers.mjs'
// @ts-expect-error local I/O doubles are supplied by scripts/test-offline.mjs
import { calls, setDbResolver } from '../../test-support/db.mjs'

process.env.MEALIO_SESSION_SECRET='lot1-offline-secret---------------------'
globalThis.fetch=async()=>{throw new Error('Network forbidden in offline API tests')}
const routes={lab,matcherTest,resolve,feedback}
const request=(body:unknown)=>new NextRequest('http://mealio.test/api/matcher',{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}})
function validSession(){setCookies({mealio_session:createSessionValue('Famille','frosti-user')})}
function referenceDb(call:any){
  const ref=makeReferenceData()
  const tables:Record<string,unknown>={
    official_ingredients:ref.officialList,
    ingredient_synonyms:Array.from(ref.synonymMap,([mot_recette,ingredient_id])=>({mot_recette,ingredient_id})),
    unit_mappings:ref.unitMappings,ingredient_densities:ref.densities,
    ignored_words:[],ai_resolution_log:[],matcher_memory:[],matcher_exclusions:[],
  }
  if(call.table==='app_users')return{data:{id:`${call.source}-user`,username:'Famille'},error:null}
  if(call.table==='items')return{data:call.source==='frosti'?[{id:'stock-1',produit:'Farine de blé',qte:1000,unite:'g',categorie:'Épicerie'}]:[],error:null}
  return{data:call.single?null:(tables[call.table]??[]),error:null}
}

for(const [name,route]of Object.entries(routes)){
  for(const variant of ['absent','old','tampered','expired']){
    test(`${name} refuse une session ${variant} avant accès aux données`,async()=>{
      setDbResolver(referenceDb)
      if(variant==='absent')setCookies({})
      if(variant==='old')setCookies({congelo_username:'Famille',congelo_user_id:'fake'})
      if(variant==='tampered'){
        const [payload,signature]=createSessionValue('Famille','frosti-user').split('.')
        setCookies({mealio_session:`${payload}.${signature[0]==='A'?'B':'A'}${signature.slice(1)}`})
      }
      if(variant==='expired'){
        const payload=Buffer.from(JSON.stringify({username:'Famille',frostiUserId:'frosti-user',exp:1})).toString('base64url')
        const signature=createHmac('sha256',process.env.MEALIO_SESSION_SECRET!).update(payload).digest('base64url')
        setCookies({mealio_session:`${payload}.${signature}`})
      }
      const result=await route(request({mode:'inventory',name:'Farine de blé'}))
      assert.equal(result.status,401);assert.equal(calls.length,0)
    })
  }
}

test('la session conserve le nom du foyer et son UUID Frosti distinct',()=>{
  const session=verifySessionValue(createSessionValue(' Famille ',' frosti-user '))
  assert.equal(session?.username,'Famille');assert.equal(session?.frostiUserId,'frosti-user')
})

test('resolve accepte mealio_session et résout un ingrédient exact',async()=>{
  setDbResolver(referenceDb);validSession()
  const response=await resolve(request({name:'Farine de blé'}))
  assert.equal(response.status,200);assert.equal((await response.json()).result.id,IDS.farine)
})

test('lab inventaire utilise le foyer signé et les UUID de chaque application',async()=>{
  setDbResolver(referenceDb);validSession()
  const response=await lab(request({mode:'inventory',username:'Autre foyer'}))
  assert.equal(response.status,200)
  const body=await response.json();assert.equal(body.stock.username,'Famille')
  assert.equal(body.stock.frostiUserId,'frosti-user');assert.equal(body.stock.cellioUserId,'cellio-user')
  assert.equal(body.stock.items[0].id,'frosti:stock-1')
  const lookups=calls.filter((call:any)=>call.table==='app_users')
  assert.ok(lookups.every((call:any)=>call.filters.some((filter:any[])=>filter[1]==='username'&&filter[2]==='Famille')))
})

test('feedback refuse un identifiant de stock extérieur au foyer',async()=>{
  setDbResolver(referenceDb);validSession()
  const response=await feedback(request({action:'validate',ingredientName:'Farine de blé',stockItem:{id:'frosti:other-stock',produit:'Farine de blé'}}))
  assert.equal(response.status,404);assert.equal(calls.filter((call:any)=>call.action!=='select').length,0)
})

test('feedback refuse une validation entre deux ingrédients officiels différents',async()=>{
  setDbResolver(referenceDb);validSession()
  const response=await feedback(request({action:'validate',ingredientName:'Farine de riz',stockItem:{id:'frosti:stock-1',produit:'Farine de riz'}}))
  assert.equal(response.status,409);assert.equal(calls.filter((call:any)=>call.action!=='select').length,0)
})

test('feedback utilise la vraie ligne du foyer, pas le produit envoyé par le navigateur',async()=>{
  setDbResolver(referenceDb);validSession()
  const response=await feedback(request({action:'validate',ingredientName:'Farine de blé',stockItem:{id:'frosti:stock-1',produit:'Produit falsifié'}}))
  assert.equal(response.status,200)
  const write=calls.find((call:any)=>call.table==='matcher_memory'&&call.action==='insert')
  assert.equal(write.payload.stock_item_id,'frosti:stock-1');assert.equal(write.payload.validated,true)
})

test('lecture Frosti indisponible : aucune réponse de stock vide',async()=>{
  setDbResolver((call:any)=>call.source==='frosti'&&call.table==='items'?{data:null,error:{message:'offline'}}:referenceDb(call))
  await assert.rejects(getHouseholdStock('Famille'),/Erreur lecture stock Frosti/)
})

test('lookup Cellio indisponible : le laboratoire remonte une erreur',async()=>{
  setDbResolver((call:any)=>call.source==='cellio'&&call.table==='app_users'?{data:null,error:{message:'offline'}}:referenceDb(call));validSession()
  const response=await lab(request({mode:'inventory'}))
  assert.equal(response.status,500);assert.match((await response.json()).error,/Cellio/)
})

for(const [name,route]of Object.entries(routes)){
  test(`${name} renvoie 400 pour un corps invalide avec une session valide`,async()=>{
    validSession();setDbResolver(referenceDb)
    const response=await route(new NextRequest('http://mealio.test',{method:'POST',body:'null'}))
    assert.equal(response.status,400);assert.equal(calls.length,0)
  })
}
