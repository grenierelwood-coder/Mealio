import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareShoppingRequirement } from '../../app/utils/shopping-requirement-policy'
import { aggregateRequirements, resolveRecipeIngredients, compareToStock, convertQuantityToUnit } from '../../app/utils/matcher'
import { makeReferenceData, IDS } from '../../scripts/matcher-test-fixtures'

function setup(reference: string) {
  const ref=makeReferenceData()
  const official={id:'test-custom',nom:'Produit test',rayon:null,default_storage:'frosti',categorie:'Viandes',unite_reference:reference}
  ref.officialById.set(official.id,official)
  ref.unitMappings.push({unite:'Gousse',abreviation:'gousse',type_unite:'unité',multiplicateur:1})
  const item={produit:official.nom,ingredient_id:official.id,qte:2,qte_a_acheter:2,qte_stock:0,unite:'piece',
    quantity_mode:'quantity' as const,needs_review:false,contributions:[],ai_status:'red' as const,stock_details:[]}
  return{ref,official,item}
}

test('saucisse sans masse explicite : le besoin en pièces reste visible sans identité officielle',()=>{
  const{ref,item}=setup('Gramme')
  const result=prepareShoppingRequirement(item,ref)
  assert.equal(result.qte_a_acheter,2);assert.equal(result.unite,'piece')
  assert.equal(result.ingredient_id,null);assert.equal(result.needs_review,true)
  assert.match(result.reference_unit_issue!,/Aucune équivalence explicite/)
})

test('ail : pièce ne devient pas gousse sans équivalence explicite',()=>{
  const{ref,item}=setup('Gousse')
  const result=prepareShoppingRequirement(item,ref)
  assert.equal(result.qte_a_acheter,2);assert.equal(result.unite,'piece')
  assert.equal(result.ingredient_id,null);assert.match(result.reference_unit_issue!,/Gousse/)
})

test('saucisse : une masse explicite par pièce permet une conversion vérifiable',()=>{
  const{ref,official,item}=setup('Gramme')
  ref.densities.push({ingredient_id:official.id,unite:'Pièce',poids_g_approx:150})
  const result=prepareShoppingRequirement(item,ref)
  assert.equal(result.qte_a_acheter,300);assert.equal(result.qte,300)
  assert.equal(result.unite,'Gramme');assert.equal(result.ingredient_id,official.id)
  assert.equal(result.reference_unit_issue,undefined)
})

test('des gousses déjà exprimées en gousses gardent leur identité',()=>{
  const{ref,official,item}=setup('Gousse')
  const result=prepareShoppingRequirement({...item,unite:'gousse'},ref)
  assert.equal(result.qte_a_acheter,2);assert.equal(result.unite,'Gousse')
  assert.equal(result.ingredient_id,official.id)
})

test('conversion vers une référence kilogramme : quantité stockée en kilogrammes',()=>{
  const{ref,item}=setup('Kilogramme')
  const result=prepareShoppingRequirement({...item,qte:800,qte_stock:300,qte_a_acheter:500,unite:'g'},ref)
  assert.equal(result.qte,.8);assert.equal(result.qte_stock,.3);assert.equal(result.qte_a_acheter,.5)
  assert.equal(result.unite,'Kilogramme')
})

test('la conversion canonique et la conversion vers une unité demandée restent distinctes',()=>{
  const result=convertQuantityToUnit(makeReferenceData(),IDS.miel,42,'g','Cuillère à café')
  assert.deepEqual(result,{qty:6,unit:'Cuillère à café'})
})

test('un ingrédient sans référence conserve le besoin et explique le blocage',()=>{
  const{ref,item}=setup('')
  const result=prepareShoppingRequirement(item,ref)
  assert.equal(result.qte_a_acheter,2);assert.equal(result.ingredient_id,null)
  assert.match(result.reference_unit_issue!,/pas d'unité de référence/)
})

test('un ingrédient inconnu possède une explication active dès le pipeline',async()=>{
  const ref=makeReferenceData(); const raw='Bouquet garni (thym, laurier)'
  ref.aiResolutionMap.set(raw,{mot_recette:raw,proposition_ia:'AUCUN',ingredient_id_propose:null,statut:'valide',created_at:null})
  const{cleanText}=await import('../../app/utils/matcher')
  const row=ref.aiResolutionMap.get(raw)!
  ref.aiResolutionMap.clear();ref.aiResolutionMap.set(cleanText(raw),row)
  const resolved=await resolveRecipeIngredients([{name:raw,qty:1,unit:'piece'}],ref,'r','Cassoulet')
  assert.match(resolved[0].review_reason!,/pas encore associé/)
  const compared=await compareToStock(aggregateRequirements([resolved]),[],ref,undefined,
    {stopWords:new Set(),memory:new Map(),exclusions:new Set(),persistMemory:false})
  assert.equal(compared[0].qte_a_acheter,1);assert.match(compared[0].stock_match_review!,/pas encore associé/)
})

function oilReference() {
  const ref=makeReferenceData()
  const oil={id:'test-oil',nom:"Huile d'olive",rayon:'Épicerie',default_storage:'cellio',categorie:'Huiles',unite_reference:'Millilitre'}
  ref.officialById.set(oil.id,oil)
  ref.officialList=[...ref.officialList,oil]
  ref.officialPrepared=[...ref.officialPrepared,{item:oil,normalized:'huile olive',tokens:['huile','olive']}]
  ref.densities.push({ingredient_id:oil.id,unite:'Cuillère à soupe',poids_g_approx:14})
  return{ref,oil}
}

test('huile référencée en volume : une cuillère reste 15 mL, sans détour par 14 g',async()=>{
  const{ref,oil}=oilReference()
  const result=await resolveRecipeIngredients([{name:"Huile d'olive",qty:1,unit:'cs'}],ref,'r','Cassoulet')
  assert.equal(result[0].qte,15);assert.equal(result[0].unite,'mL')
  const compared=await compareToStock(aggregateRequirements([result]),[],ref,undefined,
    {stopWords:new Set(),memory:new Map(),exclusions:new Set(),persistMemory:false})
  const prepared=prepareShoppingRequirement(compared[0],ref)
  assert.equal(prepared.ingredient_id,oil.id);assert.equal(prepared.unite,'Millilitre')
  assert.equal(prepared.qte_a_acheter,15);assert.equal(prepared.reference_unit_issue,undefined)
})

test('huile : le stock mesuré en mL couvre le besoin de cuillère sans densité mL inventée',async()=>{
  const{ref,oil}=oilReference()
  const resolved=await resolveRecipeIngredients([{name:"Huile d'olive",qty:2,unit:'cs'}],ref,'r','R')
  const compared=await compareToStock(aggregateRequirements([resolved]),[
    {id:'oil-stock',produit:"Huile d'olive",qte:20,unite:'mL',ingredient_id:oil.id}],ref,undefined,
    {stopWords:new Set(),memory:new Map(),exclusions:new Set(),persistMemory:false})
  assert.equal(compared[0].qte_stock,20);assert.equal(compared[0].qte_a_acheter,10)
})

test('huile : une pièce de stock ne devient pas arbitrairement un litre',async()=>{
  const{ref,oil}=oilReference()
  const resolved=await resolveRecipeIngredients([{name:"Huile d'olive",qty:1,unit:'cs'}],ref,'r','R')
  const compared=await compareToStock(aggregateRequirements([resolved]),[
    {id:'oil-stock',produit:"Huile d'olive",qte:1,unite:'Pièce',ingredient_id:oil.id}],ref,undefined,
    {stopWords:new Set(),memory:new Map(),exclusions:new Set(),persistMemory:false})
  assert.equal(compared[0].qte_stock,0);assert.equal(compared[0].qte_a_acheter,15)
  assert.match(compared[0].stock_match_review!,/convertie|converti/)
})

test('ancienne ligne automatique non achetée : la même huile peut changer d’unité',async()=>{
  const{canReuseUnpurchasedShoppingItem}=await import('../../app/utils/shopping-requirement-policy')
  assert.equal(canReuseUnpurchasedShoppingItem({produit:"Huile d'olive",is_manual:false,qte_achetee:0,stock_stored_quantity:0},{produit:"Huile d'olive"}),true)
})

for(const previous of [
  {produit:"Huile d'olive",is_manual:true,qte_achetee:0,stock_stored_quantity:0},
  {produit:"Huile d'olive",is_manual:false,qte_achetee:1,stock_stored_quantity:0},
  {produit:"Huile d'olive",is_manual:false,qte_achetee:0,stock_stored_quantity:1},
  {produit:'Huile de coco',is_manual:false,qte_achetee:0,stock_stored_quantity:0},
]){
  test(`réconciliation protège ligne manuelle/achetée/rangée ou autre produit : ${JSON.stringify(previous)}`,async()=>{
    const{canReuseUnpurchasedShoppingItem}=await import('../../app/utils/shopping-requirement-policy')
    assert.equal(canReuseUnpurchasedShoppingItem(previous,{produit:"Huile d'olive"}),false)
  })
}

test('une ancienne ligne cochée sans quantité renseignée n’est pas réutilisée pour changer d’unité',async()=>{
  const{canReuseUnpurchasedShoppingItem}=await import('../../app/utils/shopping-requirement-policy')
  assert.equal(canReuseUnpurchasedShoppingItem({produit:"Huile d'olive",is_checked:true,qte_achetee:0,stock_stored_quantity:0},{produit:"Huile d'olive"}),false)
})

// @ts-expect-error local I/O doubles are supplied by scripts/test-offline.mjs
import { calls, setDbResolver } from '../../test-support/db.mjs'

for (const purchased of [0,2]) {
  test(`générateur réel : régénération huile g -> mL avec ${purchased} déjà acheté(s)`,async()=>{
    const{ref,oil}=oilReference()
    const previous={id:'old-oil',produit:oil.nom,ingredient_id:null,qte:14,qte_achat:14,qte_achetee:purchased,
      stock_stored_quantity:0,unite:'Gramme',is_checked:false,is_manual:false,ai_status:'orange'}
    setDbResolver((call:any)=>{
      if(call.action!=='select')return{data:call.single?{id:'new-oil',...call.payload}:[],error:null}
      if(call.table==='meal_plans')return{data:[{recipe_id:'recipe-oil',servings:4}],error:null}
      if(call.table==='shopping_lists')return{data:[{id:'list-1',period_start:'2026-10-07',period_end:'2026-10-13'}],error:null}
      if(call.table==='recipes')return{data:{id:'recipe-oil',title:'Cassoulet test',servings:4,
        ingredients:[{name:oil.nom,qty:1,unit:'cs'}],instructions:''},error:null}
      if(call.table==='app_users')return{data:{id:`${call.source}-user`,username:'Famille'},error:null}
      if(call.table==='items')return{data:call.source==='cellio'?[{id:'stock-oil',produit:oil.nom,qte:1,unite:'Pièce',categorie:'Huiles'}]:[],error:null}
      if(call.table==='shopping_items')return{data:[previous],error:null}
      if(call.table==='official_ingredients')return{data:call.single?oil:ref.officialList,error:null}
      if(call.table==='unit_mappings')return{data:ref.unitMappings,error:null}
      if(call.table==='ingredient_densities')return{data:ref.densities,error:null}
      return{data:call.single?null:[],error:null}
    })
    const{generateShoppingListForPeriod}=await import('../../app/utils/shopping-list-generator')
    const result=await generateShoppingListForPeriod('frosti-user','Famille','2026-10-07','2026-10-13','Test')
    assert.equal(result.itemCount,1);assert.equal(result.issueCount,1)
    const writes=calls.filter((call:any)=>call.table==='shopping_items'&&call.action!=='select')
    assert.equal(writes.length,1)
    assert.equal(writes[0].action,purchased===0?'update':'insert')
    assert.equal(writes[0].payload.unite,'Millilitre')
    assert.equal(writes[0].payload.qte,15);assert.equal(writes[0].payload.qte_achat,15)
    if(purchased===0)assert.ok(writes[0].filters.some((filter:any[])=>filter[1]==='id'&&filter[2]==='old-oil'))
    assert.equal(calls.filter((call:any)=>call.table==='shopping_items'&&call.action==='delete').length,0)
  })
}

import { parseIngredients } from '../../app/utils/cookiwiki-fetcher'
import { ingredientReferenceSignature, cleanText, createMatcherTrace } from '../../app/utils/matcher'

test('Cookiwiki : gousses d’ail sans unité deviennent Ail en gousses, sans modifier la vanille',()=>{
  const rows=parseIngredients([{name:"Gousses d'ail",qty:2,unit:''},{name:'Gousse de vanille',qty:1,unit:''},{name:"Gousses d'ail",qty:2,unit:'g'}])
  assert.deepEqual(rows[0],{name:'Ail',qty:2,unit:'gousse'})
  assert.equal(rows[1].name,'Gousse de vanille');assert.equal(rows[1].unit,'pièce');assert.equal(rows[2].unit,'g')
})
test('proposition en attente : libellé original et aucune identité officielle retenue',async()=>{
  const ref=makeReferenceData();const name='Saucisses bretonnes (ou saucisses fraîches)'
  ref.aiResolutionMap.set(cleanText(name),{mot_recette:name,proposition_ia:'Farine de blé',ingredient_id_propose:IDS.farine,statut:'en_attente',created_at:null})
  const [row]=await resolveRecipeIngredients([{name,qty:4,unit:'piece'}],ref,'r','Cassoulet')
  assert.equal(row.produit,name);assert.equal(row.ingredient_id,null);assert.equal(row.qte,4);assert.match(row.review_reason!,/Proposition.*à valider/)
})
test('AUCUN récent et référentiel inchangé : aucun appel Claude',async()=>{
  const ref=makeReferenceData(),name='Produit absent xyz'
  ref.aiResolutionMap.set(cleanText(name),{mot_recette:name,proposition_ia:'AUCUN',ingredient_id_propose:null,statut:'en_attente',created_at:new Date().toISOString(),reference_signature:ingredientReferenceSignature(ref)})
  const trace=createMatcherTrace(name)
  const [result]=await resolveRecipeIngredients([{name,qty:1,unit:'piece'}],ref,'r','test',1,trace)
  assert.equal(result.ingredient_id,null);assert.equal(trace.claudeCalls,0);assert.match(trace.ingredientDecision!.reason,/inchangé/)
})
test('signature identité : ordre stable et invalidation après enrichissement',()=>{
  const ref=makeReferenceData();const signature=ingredientReferenceSignature(ref)
  ref.officialList.reverse();assert.equal(ingredientReferenceSignature(ref),signature)
  ref.synonymMap.set('nouveau synonyme',IDS.farine);assert.notEqual(ingredientReferenceSignature(ref),signature)
})

test('pipeline ail Cookiwiki : 2 gousses explicites résolues sans Claude, stock en pièces non déduit',async()=>{
  const ref=makeReferenceData()
  const ail={id:'test-ail',nom:'Ail',rayon:'Fruits & légumes',default_storage:'cellio',categorie:'Légumes frais',unite_reference:'Gousse'}
  ref.officialList.push(ail);ref.officialById.set(ail.id,ail)
  ref.officialPrepared.push({item:ail,normalized:'ail',tokens:['ail']})
  ref.unitMappings.push({unite:'Gousse',abreviation:'gousse',type_unite:'divers',multiplicateur:1})
  const trace=createMatcherTrace('Ail')
  const rows=await resolveRecipeIngredients(parseIngredients([{name:"Gousses d'ail",qty:2,unit:''}]),ref,'r','Cassoulet',1,trace)
  assert.equal(rows[0].qte,2);assert.equal(rows[0].unite,'gousse');assert.equal(rows[0].ingredient_id,ail.id);assert.equal(trace.claudeCalls,0)
  const [compared]=await compareToStock(aggregateRequirements([rows]),[{id:'s',produit:'Ail',qte:4,unite:'Pièce',ingredient_id:ail.id}],ref,undefined,
    {stopWords:new Set(),memory:new Map(),exclusions:new Set(),persistMemory:false})
  assert.equal(compared.qte_stock,0);assert.equal(compared.qte_a_acheter,2)
})
