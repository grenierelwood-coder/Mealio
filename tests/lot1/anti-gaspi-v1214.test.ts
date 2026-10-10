import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchRecipesForSelection, searchCookiwikiIngredientLabels, getAntiGaspiTonight } from '../../app/utils/anti-gaspi-server'
import { GET as getStock } from '../../app/api/stock/route'
import { GET, POST } from '../../app/api/anti-gaspi/route'
import { makeReferenceData, IDS } from '../../scripts/matcher-test-fixtures'
import { parseIngredients } from '../../app/utils/cookiwiki-fetcher'
import { createSessionValue } from '../../app/utils/auth-server'
// @ts-expect-error offline doubles
import { setDbResolver, calls } from '../../test-support/db.mjs'
// @ts-expect-error offline doubles
import { setCookies } from '../../test-support/headers.mjs'
process.env.MEALIO_SESSION_SECRET='anti-gaspi-secret-----------------------'
globalThis.fetch=async()=>{throw new Error('Claude/network forbidden in deterministic search')}
const recipe=(id:string,names:string[])=>({id,title:id,ingredients:names.map(name=>({name,qty:1,unit:'g'}))})
function setup(recipes:any[],stock:any[]=[],structures:any[]=[]) {
 const ref=makeReferenceData()
 setCookies({mealio_session:createSessionValue('Famille','frosti-user')})
 setDbResolver((c:any)=>{
  if(c.table==='app_users')return {data:{id:`${c.source}-user`,username:'Famille'},error:null}
  if(c.table==='items')return {data:stock.filter(i=>i.source===c.source),error:null}
  if(c.table==='recipes')return {data:recipes,error:null}
  if(c.table==='mealio_recipe_structures')return {data:structures,error:null}
  const tables:any={official_ingredients:ref.officialList,ingredient_synonyms:[...ref.synonymMap].map(([mot_recette,ingredient_id])=>({mot_recette,ingredient_id})),unit_mappings:ref.unitMappings,ingredient_densities:ref.densities}
  return {data:c.single?null:tables[c.table]??[],error:null}
 })
}
const post=(body:unknown)=>POST(new Request('http://mealio.test/api/anti-gaspi',{method:'POST',body:JSON.stringify(body)}))
test('Cookiwiki sans ID officiel : résultat proposé puis sélectionné via label: reste recherchable',async()=>{
 setup([recipe('citron',["Thym citronné"])])
 const response=await GET(new Request('http://mealio.test/api/anti-gaspi?q=thym'))
 const found=(await response.json()).ingredients.find((i:any)=>i.nom==='Thym citronné');assert.equal(found.id,'label:Thym citronné')
 const out=await (await post({selectedIngredientIds:[found.id],selectedLabels:[found.nom]})).json()
 assert.deepEqual(out.recipes.map((r:any)=>r.id),['citron']);assert.equal(out.selectionCount,1)
})
test('OU : au moins un ; ET : tous, avec pluriels et synonymes',async()=>{
 setup([recipe('courgette',['Zucchini']),recipe('tomate',['Tomates']),recipe('ensemble',['Courgettes','Tomates'])])
 const any=await searchRecipesForSelection('Famille',{selectedIngredientIds:[IDS.courgette,IDS.tomate],matchMode:'any'})
 assert.equal(any.recipes.length,3);assert.equal(any.recipes[0].id,'ensemble')
 const all=await searchRecipesForSelection('Famille',{selectedIngredientIds:[IDS.courgette,IDS.tomate],matchMode:'all'})
 assert.deepEqual(all.recipes.map(r=>r.id),['ensemble'])
})
test('sélection mixte stock + référentiel : aucun choix ignoré, foyer isolé par username',async()=>{
 setup([recipe('ensemble',['Courgettes','Tomates']),recipe('tomate',['Tomates'])],[{id:'s',source:'frosti',produit:'Courgettes',qte:2,unite:'Pièce'}])
 const out=await (await post({selectedKeys:['frosti:s'],selectedIngredientIds:[IDS.tomate],matchMode:'all'})).json()
 assert.deepEqual(out.recipes.map((r:any)=>r.id),['ensemble']);assert.equal(out.selectedStock.length,1)
 for(const c of calls.filter((c:any)=>c.table==='app_users'))assert.ok(c.filters.some((f:any)=>f[1]==='username'&&f[2]==='Famille'))
 for(const c of calls.filter((c:any)=>c.table==='items'))assert.ok(c.filters.some((f:any)=>f[1]==='user_id'&&f[2]===`${c.source}-user`))
})
test('la farine de riz et un titre contenant blé ne deviennent pas des ingrédients farine de blé',async()=>{
 setup([recipe('Blé au riz',['Farine de riz']),recipe('pain',['Farine de blé'])])
 const out=await searchRecipesForSelection('Famille',{selectedIngredientIds:[IDS.farine]})
 assert.deepEqual(out.recipes.map(r=>r.id),['pain'])
})
test('Cookiwiki : choix actif uniquement, facultatif exclu et structure périmée ignorée',async()=>{
 const flat=[{name:'Tomates',qty:2,unit:'piece'}]
 const structure=[{name:'Choix',selected:1,alternatives:[{name:'Courgette',qty:1},{name:'Tomate',qty:2}]},{name:'Poireau',qty:1,optional:true,included:false}]
 setup([{id:'structured',title:'structured',ingredients:flat}],[],[{recipe_id:'structured',structure,ingredients_snapshot:flat}])
 assert.equal((await searchRecipesForSelection('Famille',{selectedIngredientIds:[IDS.courgette,IDS.poireau]})).recipes.length,0)
 assert.equal((await searchRecipesForSelection('Famille',{selectedIngredientIds:[IDS.tomate]})).recipes.length,1)
 setup([{id:'structured',title:'structured',ingredients:[{name:'Courgette',qty:1}]}],[],[{recipe_id:'structured',structure,ingredients_snapshot:flat}])
 assert.equal((await searchRecipesForSelection('Famille',{selectedIngredientIds:[IDS.courgette]})).recipes.length,1)
})
test('produit urgent sans association officielle : recherche exacte sans Claude',async()=>{
 setup([recipe('herbe',['Thym citronné'])],[{id:'s',source:'cellio',produit:'Thym citronné',qte:1,unite:'Pièce',date_peremption:'2020-01-01'}])
 assert.equal((await getAntiGaspiTonight('Famille')).suggestions[0].id,'herbe')
})
test('mode invalide refusé ; session absente refusée avant lecture DB',async()=>{
 setup([]);assert.equal((await post({matchMode:'xor'})).status,400);assert.equal(calls.length,0)
 setCookies({});assert.equal((await post({})).status,401);assert.equal(calls.length,0)
})
test('erreur Cookiwiki remontée plutôt que présentée comme aucune recette',async()=>{
 setup([]);setDbResolver((c:any)=>c.table==='recipes'?{data:null,error:{message:'offline'}}:{data:c.single?{id:'u'}:[],error:null})
 await assert.rejects(searchCookiwikiIngredientLabels('tomate'),/offline/)
})
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures')
const source=JSON.parse(fs.readFileSync(path.join(dir,'cookiwiki-56.json'),'utf8'))
const corrections=JSON.parse(fs.readFileSync(path.join(dir,'recipe-corrections-v1212.json'),'utf8'))
for(const original of source)test(`Anti-gaspi : ingrédients actifs de ${original.title}`,async()=>{
 const current={...original,ingredients:corrections.find((c:any)=>c.id===original.id)?.ingredients??original.ingredients}
 setup([current]);const names=parseIngredients(current.ingredients).filter(i=>!i.preparationIssue).map(i=>i.name)
 assert.ok(names.length>0)
 const out=await searchRecipesForSelection('Famille',{selectedLabels:names,matchMode:'all'})
 assert.deepEqual(out.recipes.map(r=>r.id),[original.id])
})


test('Inventaire : nom officiel et synonymes exposés pour retrouver tous les lieux',async()=>{
 setup([],[{id:'f',source:'frosti',produit:'Zucchini',qte:2,unite:'Pièce'},{id:'c',source:'cellio',produit:'Courgettes',qte:0,unite:'Pièce'}])
 const out=await (await getStock()).json();assert.equal(out.items.length,2)
 for(const row of out.items){assert.equal(row.ingredient_id,IDS.courgette);assert.equal(row.ingredient_name,'Courgette');assert.ok(row.ingredient_aliases.includes('zucchini'))}
})
