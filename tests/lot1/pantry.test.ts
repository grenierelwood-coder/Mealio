import test from 'node:test'
import assert from 'node:assert/strict'
import { makeReferenceData, IDS, stockItem } from '../../scripts/matcher-test-fixtures'
import { resolveRecipeIngredients, aggregateRequirements, compareToStock, createMatcherTrace, loadReferenceData, convertQuantityToUnit } from '../../app/utils/matcher'
import { prepareShoppingRequirement } from '../../app/utils/shopping-requirement-policy'
import { loadPantryProducts } from '../../app/utils/pantry-server'
import { getQuantityMode } from '../../app/utils/quantity-policy'
import { parseIngredients } from '../../app/utils/cookiwiki-fetcher'
import { assertOfficialIngredientUnit } from '../../app/utils/official-unit-policy'
import { createSessionValue } from '../../app/utils/auth-server'
import { GET as shoppingGet } from '../../app/api/shopping-list/route'
import { PATCH as shoppingPatch } from '../../app/api/shopping-list/items/route'
import { GET as pantryGet, PATCH as pantryPatch } from '../../app/api/admin/pantry/route'
// @ts-expect-error local I/O doubles
import { calls, setDbResolver } from '../../test-support/db.mjs'
// @ts-expect-error local I/O doubles
import { setCookies } from '../../test-support/headers.mjs'

process.env.MEALIO_SESSION_SECRET='pantry-tests-secret'
globalThis.fetch=async()=>{throw new Error('Claude/network forbidden')}
const context=()=>({stopWords:new Set<string>(),memory:new Map(),exclusions:new Set<string>(),persistMemory:false})
const policy={ingredient_id:IDS.farine,default_quantity:1000,default_unit:'Gramme',enabled:true}
function setup(){const ref=makeReferenceData();ref.pantryProducts=new Map([[IDS.farine,{...policy}]]);return ref}
function session(){setCookies({mealio_session:createSessionValue('Famille','frosti-user')})}
async function need(ref=setup()){
  return resolveRecipeIngredients([{name:'Farine de blé',qty:500,unit:'g'}],ref,'r','Recette')
}
for(const qty of [1,0,-1,NaN,Infinity]){
  test(`épicerie : farine compatible en pièce, quantité ${qty}`,async()=>{
    const ref=setup();const rows=await need(ref)
    const [result]=await compareToStock(aggregateRequirements([rows]),[stockItem('s','Farine de blé',qty,'Pièce',IDS.farine)],ref,undefined,context())
    assert.equal(rows[0].quantity_mode,'presence')
    assert.equal(result.qte_a_acheter,qty===1?0:1)
    assert.equal(result.stock_match_review,null)
    if(qty!==1){const buy=prepareShoppingRequirement(result,ref);assert.equal(buy.qte_a_acheter,1000);assert.equal(buy.unite,'Gramme')}
  })
}
test('épicerie : farine de riz ne couvre jamais farine de blé',async()=>{
  const ref=setup();const [result]=await compareToStock(aggregateRequirements([await need(ref)]),
    [stockItem('s','Farine de riz',2000,'g',IDS.farineRiz)],ref,undefined,context())
  assert.equal(prepareShoppingRequirement(result,ref).qte_a_acheter,1000)
})
test('épicerie : plusieurs recettes = un format, indépendamment des portions',async()=>{
  const ref=setup();const raw=[{name:'Farine de blé',qty:0,unit:'unité inconnue'}]
  const first=await resolveRecipeIngredients(raw,ref,'r1','Pain',20)
  const second=await resolveRecipeIngredients(raw,ref,'r2','Gâteau',2)
  const aggregated=aggregateRequirements([first,second]);assert.equal(aggregated.length,1);assert.equal(aggregated[0].qte,1)
  const [compared]=await compareToStock(aggregated,[],ref,undefined,context())
  assert.equal(prepareShoppingRequirement(compared,ref).qte_a_acheter,1000)
})
test('mode épicerie désactivé : retour au calcul du manque',async()=>{
  const ref=setup();ref.pantryProducts!.get(IDS.farine)!.enabled=false
  const [result]=await compareToStock(aggregateRequirements([await need(ref)]),[stockItem('s','Farine de blé',200,'g',IDS.farine)],ref,undefined,context())
  assert.equal(result.quantity_mode,'quantity');assert.equal(result.qte_a_acheter,300)
  assert.equal(getQuantityMode({nom:'Sel fin',quantity_mode:'quantity'}),'quantity')
})
test('lecture épicerie en panne : interruption, aucun stock vide inventé',async()=>{
  setDbResolver((call:any)=>({data:[],error:call.table==='pantry_products'?{message:'offline'}:null}))
  await assert.rejects(loadReferenceData(),/épicerie indisponible/)
})
test('format épicerie invalide : interruption',async()=>{
  setDbResolver(()=>({data:[{...policy,default_quantity:0}],error:null}))
  await assert.rejects(loadPantryProducts(),/invalide/)
})
test('sel et poivre : deux identités de présence, aucune déduction partagée',()=>{
  assert.deepEqual(parseIngredients([{name:'Sel et poivre',qty:0,unit:''}]).map(r=>r.name),['Sel fin','Poivre noir'])
  assert.equal(parseIngredients([{name:'Sel et poivre',qty:30,unit:'g'}]).length,1)
})
test('unité achat épicerie approuvée : autorisée sans conversion de recette',async()=>{
  setDbResolver((call:any)=>({data:call.table==='official_ingredients'?{id:IDS.farine,nom:'Herbes',unite_reference:'Cuillère à soupe'}:
    call.table==='unit_mappings'?[{unite:'Gramme',abreviation:'g'}]:[{...policy}],error:null}))
  assert.equal(await assertOfficialIngredientUnit(IDS.farine,'g'),'Gramme')
})
test('une autre unité non approuvée reste refusée',async()=>{
  setDbResolver((call:any)=>({data:call.table==='official_ingredients'?{id:IDS.farine,nom:'Herbes',unite_reference:'Cuillère à soupe'}:
    call.table==='unit_mappings'?[{unite:'Millilitre',abreviation:'mL'}]:[{...policy}],error:null}))
  await assert.rejects(assertOfficialIngredientUnit(IDS.farine,'mL'),/Unité refusée/)
})
for(const route of [pantryGet,pantryPatch]){
  test(`administration épicerie ${route.name} : session obligatoire`,async()=>{
    setCookies({});setDbResolver(()=>({data:[],error:null}))
    const result=await route(new Request('http://test',{method:'PATCH',body:'{}'}))
    assert.equal(result.status,401);assert.equal(calls.length,0)
  })
}
test('administration : quantité zéro refusée avant écriture',async()=>{
  session();setDbResolver(()=>({data:[],error:null}))
  const result=await pantryPatch(new Request('http://test',{method:'PATCH',body:JSON.stringify({...policy,ingredient_id:'988905da-104f-4c15-875f-1dacc479cac3',default_quantity:0})}))
  assert.equal(result.status,400);assert.equal(calls.length,0)
})
test('Courses : lecture du format et progression fondée sur ×2',async()=>{
  session();setDbResolver((call:any)=>{
    if(call.table==='shopping_lists')return{data:{id:'l',name:'Courses',user_id:'Famille'},error:null}
    if(call.table==='shopping_items')return{data:[{id:'i',list_id:'l',produit:'Farine de blé',ingredient_id:IDS.farine,qte:1000,qte_achat:2000,qte_achetee:1000,
      pantry_pack_quantity:1000,stock_stored_quantity:0,unite:'Gramme',is_checked:false,is_manual:false,official_ingredients:{nom:'Farine de blé',rayon:'Épicerie',categorie:'Céréales'}}],error:null}
    return{data:call.table==='pantry_products'?[policy]:[],error:null}
  })
  const response=await shoppingGet();const result=await response.json()
  assert.equal(response.status,200);assert.equal(result.items[0].pantry_pack_quantity,1000)
  assert.equal(result.items[0].quantity_mode,'presence');assert.equal(result.checked,0);assert.equal(result.unchecked,1)
})
test('Courses : cocher ×2 enregistre la quantité physique 2000 g',async()=>{
  session();setDbResolver((call:any)=>({data:call.action==='update'?{id:'i',qte:1000,qte_achat:2000,qte_achetee:2000,is_checked:true}:
    {id:'i',list_id:'l',qte:1000,qte_achat:2000,qte_achetee:0,shopping_lists:{user_id:'Famille'}},error:null}))
  const response=await shoppingPatch(new Request('http://test',{method:'PATCH',body:JSON.stringify({id:'i',is_checked:true})}) as any)
  assert.equal(response.status,200)
  const write=calls.find((call:any)=>call.action==='update')
  assert.equal(write.payload.qte_achetee,2000)
  assert.ok(calls.find((call:any)=>call.filters.some((f:any[])=>f[1]==='shopping_lists.user_id'&&f[2]==='Famille')))
})

for(const present of [false,true]){
  test(`générateur réel épicerie : huile ${present?'disponible en pièce':'absente'}, sans conversion`,async()=>{
    const ref=makeReferenceData()
    const oil={id:'913542ae-abed-45d6-b8ae-51b8f2118571',nom:"Huile d'olive",rayon:'Épicerie',default_storage:'cellio',categorie:'Matières grasses',unite_reference:'Millilitre'}
    const pack={ingredient_id:oil.id,default_quantity:750,default_unit:'Millilitre',enabled:true}
    setDbResolver((call:any)=>{
      if(call.action!=='select')return{data:call.single?{id:'new-oil',...call.payload}:[],error:null}
      if(call.table==='meal_plans')return{data:[{recipe_id:'recipe-oil',servings:8},{recipe_id:'recipe-oil',servings:4}],error:null}
      if(call.table==='shopping_lists')return{data:[{id:'list-1',period_start:'2026-10-07',period_end:'2026-10-13'}],error:null}
      if(call.table==='recipes')return{data:{id:'recipe-oil',title:'Cassoulet test',servings:4,ingredients:[{name:oil.nom,qty:1,unit:'cs'}]},error:null}
      if(call.table==='app_users')return{data:{id:`${call.source}-user`,username:'Famille'},error:null}
      if(call.table==='items')return{data:present&&call.source==='cellio'?[{id:'stock-oil',produit:oil.nom,qte:1,unite:'Pièce',ingredient_id:oil.id,categorie:'Huiles'}]:[],error:null}
      if(call.table==='pantry_products')return{data:[pack],error:null}
      if(call.table==='official_ingredients')return{data:call.single?oil:[...ref.officialList,oil],error:null}
      if(call.table==='unit_mappings')return{data:ref.unitMappings,error:null}
      if(call.table==='ingredient_densities')return{data:[{ingredient_id:oil.id,unite:'Cuillère à soupe',poids_g_approx:14}],error:null}
      return{data:call.single?null:[],error:null}
    })
    const {generateShoppingListForPeriod}=await import('../../app/utils/shopping-list-generator')
    const result=await generateShoppingListForPeriod('frosti-user','Famille','2026-10-07','2026-10-13','Test')
    assert.equal(result.itemCount,present?0:1);assert.equal(result.issueCount,0)
    const writes=calls.filter((call:any)=>call.table==='shopping_items'&&call.action==='insert')
    if(!present){assert.equal(writes.length,1);assert.equal(writes[0].payload.qte_achat,750);assert.equal(writes[0].payload.pantry_pack_quantity,750);assert.equal(writes[0].payload.unite,'Millilitre')}
    else assert.equal(writes.length,0)
  })
}

test('épice désactivée en présence : une densité explicite redevient utilisable',async()=>{
  const ref=makeReferenceData();ref.pantryProducts=new Map([[IDS.sel,{ingredient_id:IDS.sel,default_quantity:250,default_unit:'Gramme',enabled:false}]])
  ref.densities.push({ingredient_id:IDS.sel,unite:'Cuillère à soupe',poids_g_approx:18})
  const [row]=await resolveRecipeIngredients([{name:'Sel fin',qty:1,unit:'cs'}],ref,'r','Salaison')
  assert.equal(row.quantity_mode,'quantity');assert.equal(row.qte,18);assert.equal(row.unite,'g')
})

test('régénération : conserve ×2 et le format de la ligne après changement du défaut',async()=>{
  const ref=makeReferenceData()
  const previous={id:'old-flour',produit:'Farine de blé',ingredient_id:IDS.farine,qte:1000,qte_achat:2000,qte_achetee:0,
    pantry_pack_quantity:1000,stock_stored_quantity:0,unite:'Gramme',is_checked:false,is_manual:false}
  setDbResolver((call:any)=>{
    if(call.action!=='select')return{data:call.single?{id:'new',...call.payload}:[],error:null}
    if(call.table==='meal_plans')return{data:[{recipe_id:'r',servings:4}],error:null}
    if(call.table==='shopping_lists')return{data:[{id:'l',period_start:'2026-10-07',period_end:'2026-10-13'}],error:null}
    if(call.table==='recipes')return{data:{id:'r',title:'Pain',servings:4,ingredients:[{name:'Farine de blé',qty:300,unit:'g'}]},error:null}
    if(call.table==='app_users')return{data:{id:`${call.source}-user`,username:'Famille'},error:null}
    if(call.table==='shopping_items')return{data:[previous],error:null}
    if(call.table==='pantry_products')return{data:[{...policy,default_quantity:500}],error:null}
    if(call.table==='official_ingredients')return{data:call.single?ref.officialById.get(IDS.farine):ref.officialList,error:null}
    if(call.table==='unit_mappings')return{data:ref.unitMappings,error:null}
    return{data:[],error:null}
  })
  const {generateShoppingListForPeriod}=await import('../../app/utils/shopping-list-generator')
  const result=await generateShoppingListForPeriod('frosti-user','Famille','2026-10-07','2026-10-13','Test')
  assert.equal(result.issueCount,0)
  const write=calls.find((call:any)=>call.table==='shopping_items'&&call.action==='update')
  assert.equal(write.payload.pantry_pack_quantity,1000);assert.equal(write.payload.qte_achat,2000)
})

test('administration épicerie : liste enrichie avec les noms officiels',async()=>{
  session();setDbResolver((call:any)=>({data:call.table==='pantry_products'?[policy]:call.table==='official_ingredients'?[{id:IDS.farine,nom:'Farine de blé',categorie:'Farines'}]:call.table==='household_pantry_products'?[]:[{unite:'Gramme'}],error:null}))
  const response=await pantryGet(),result=await response.json()
  assert.equal(response.status,200);assert.equal(result.products[0].nom,'Farine de blé');assert.equal(result.products[0].default_quantity,1000)
})
test('administration épicerie : modification du format sans toucher au stock',async()=>{
  const id='988905da-104f-4c15-875f-1dacc479cac3'
  session();setDbResolver((call:any)=>({data:call.action==='upsert'?call.payload:call.table==='unit_mappings'?[{unite:'Gramme',abreviation:'g'}]:{id},error:null}))
  const response=await pantryPatch(new Request('http://test',{method:'PATCH',body:JSON.stringify({ingredient_id:id,default_quantity:500,default_unit:'g',enabled:true,user_id:'Autre foyer'})}))
  assert.equal(response.status,200)
  const writes=calls.filter((call:any)=>call.action!=='select')
  assert.equal(writes[0].payload.user_id,'Famille');assert.equal(writes.length,1);assert.equal(writes[0].table,'household_pantry_products');assert.equal(writes[0].payload.default_quantity,500);assert.equal(writes[0].payload.default_unit,'Gramme')
})

import { getReplenishmentSuggestions } from '../../app/utils/replenishment-server'
for(const quantity of [0,1]){
  test(`réapprovisionnement épicerie : stock en pièces ${quantity}, format par défaut sans conversion`,async()=>{
    setDbResolver((call:any)=>{
      if(call.table==='stock_replenishment_thresholds')return{data:[{id:'t',ingredient_id:IDS.farine,min_quantity:300,target_quantity:500,unite:'Gramme',active:true,mode:'suggestion'}],error:null}
      if(call.table==='pantry_products')return{data:[policy],error:null}
      if(call.table==='official_ingredients')return{data:[{id:IDS.farine,nom:'Farine de blé',categorie:'Farines'}],error:null}
      if(call.table==='app_users')return{data:{id:`${call.source}-user`,username:'Famille'},error:null}
      if(call.table==='items')return{data:call.source==='cellio'?[{id:'s',produit:'Farine de blé',qte:quantity,unite:'Pièce'}]:[],error:null}
      return{data:[],error:null}
    })
    const suggestions=await getReplenishmentSuggestions('Famille')
    assert.equal(suggestions.length,quantity===0?1:0)
    if(quantity===0){assert.equal(suggestions[0].quantity,1000);assert.equal(suggestions[0].unite,'Gramme')}
  })
}

for (const household of ['Famille', 'Autre foyer']) {
  test(`épicerie privée : ${household} conserve son mode`, async () => {
    setDbResolver((call:any) => {
      if (call.table === 'pantry_products') return {data:[policy],error:null}
      assert.equal(call.table,'household_pantry_products')
      assert.ok(call.filters.some((f:any)=>f[0]==='eq' && f[1]==='user_id' && f[2]===household))
      return {data:[{...policy,enabled:household==='Famille',default_quantity:500}],error:null}
    })
    const rows=await loadPantryProducts(household)
    assert.equal(rows.get(IDS.farine)!.enabled,household==='Famille')
    assert.equal(rows.get(IDS.farine)!.default_quantity,500)
  })
}
test('nouveau foyer : formats initiaux sans écriture',async()=>{
  setDbResolver((call:any)=>({data:call.table==='pantry_products'?[policy]:[],error:null}))
  assert.equal((await loadPantryProducts('Nouveau')).get(IDS.farine)!.enabled,true)
  assert.ok(calls.every((call:any)=>call.action==='select'))
})
test('épicerie privée indisponible : aucune retombée silencieuse sur les valeurs communes',async()=>{
  setDbResolver((call:any)=>({data:call.table==='pantry_products'?[policy]:[],error:call.table==='household_pantry_products'?{message:'private offline'}:null}))
  await assert.rejects(loadPantryProducts('Famille'),/indisponible/)
})
test('Gousse classée divers : identité convertible, aucune équivalence implicite vers pièce',()=>{
  const ref=makeReferenceData()
  ref.unitMappings.push({unite:'Gousse',abreviation:'gousse',type_unite:'divers',equivalence_reference:'1 pièce',multiplicateur:1})
  assert.deepEqual(convertQuantityToUnit(ref,null,2,'gousse','Gousse'),{qty:2,unit:'Gousse'})
  assert.equal(convertQuantityToUnit(ref,null,2,'gousse','Pièce'),null)
})

import { confirmMealConsumption } from '../../app/utils/meal-consumption-server'
test('repas confirmé : présence ne consomme aucune quantité virtuelle du stock',async()=>{
  const ref=makeReferenceData()
  setDbResolver((call:any)=>{
    if(call.action!=='select')return {data:call.single?{meal_plan_id:'plan'}:[],error:null}
    if(call.table==='meal_plans')return {data:[{id:'plan',recipe_id:'recipe',servings:4}],error:null}
    if(call.table==='recipes')return {data:{id:'recipe',title:'Pain',servings:4,ingredients:[{name:'Farine de blé',qty:500,unit:'g'}]},error:null}
    if(call.table==='official_ingredients')return {data:ref.officialList,error:null}
    if(call.table==='unit_mappings')return {data:ref.unitMappings,error:null}
    if(call.table==='pantry_products')return {data:[policy],error:null}
    if(call.table==='app_users')return {data:{id:'household'},error:null}
    if(call.table==='items')return {data:call.source==='cellio'?[{id:'flour',produit:'Farine de blé',ingredient_id:IDS.farine,qte:1,unite:'Pièce'}]:[],error:null}
    return {data:call.single?null:[],error:null}
  })
  const result=await confirmMealConsumption('Famille','plan',true)
  assert.deepEqual(result.consumed,[]);assert.deepEqual(result.shortages,[])
  assert.ok(!calls.some((call:any)=>call.table==='items'&&call.action==='update'))
})
