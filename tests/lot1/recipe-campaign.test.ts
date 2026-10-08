import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseIngredients, getRecipeDetailsFromCookiwiki } from '../../app/utils/cookiwiki-fetcher'
import { loadReferenceData, resolveRecipeIngredients, aggregateRequirements, compareToStock, type MatcherComparisonTestContext } from '../../app/utils/matcher'
import { prepareShoppingRequirement } from '../../app/utils/shopping-requirement-policy'
// @ts-expect-error local I/O doubles
import { setDbResolver } from '../../test-support/db.mjs'
// @ts-expect-error local I/O doubles
import { setCookies } from '../../test-support/headers.mjs'
const fixture=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures')
const recipes=JSON.parse(fs.readFileSync(path.join(fixture,'cookiwiki-56.json'),'utf8'))
const snapshot=JSON.parse(fs.readFileSync(path.join(fixture,'reference-snapshot.json'),'utf8'))
const defaults=JSON.parse(fs.readFileSync(path.join(fixture,'pantry-defaults.json'),'utf8'))
assert.equal(recipes.length,56)
assert.equal(recipes.reduce((n:number,r:any)=>n+r.ingredients.length,0),455)
// Exercise conservative abstention; no remote AI evaluation or external stock writes.
process.env.ANTHROPIC_API_KEY='local-test'
globalThis.fetch=async()=>Response.json({content:[{type:'text',text:'{"match":"AUCUN","confidence":0,"reason":"Campagne hors ligne : abstention"}'}]})
setCookies({})
const reports:any[]=[]
const context=():MatcherComparisonTestContext=>({stopWords:new Set<string>(snapshot.ignored_words.map((r:any)=>String(r.mot))),memory:new Map(),exclusions:new Set<string>(),persistMemory:false})
for(const recipe of recipes){
  test(`Cookiwiki réel : ${recipe.title} — 8 scénarios`,async()=>{
    setDbResolver((call:any)=>({data:call.table==='recipes'?recipe:call.table==='pantry_products'?defaults:snapshot[call.table] ?? [],error:null}))
    const ref=await loadReferenceData()
    const fetched=await getRecipeDetailsFromCookiwiki(recipe.id)
    assert.equal(fetched.baseServings,Number(recipe.servings)||4)
    assert.equal(fetched.nom,recipe.title)
    const raw=fetched.ingredients
    if(parseIngredients(recipe.ingredients).length) assert.deepEqual(raw,parseIngredients(recipe.ingredients))
    else { assert.ok(raw.every(r=>r.inferredFromInstructions),'Le secours par instructions reste explicite') }
    const resolved=await resolveRecipeIngredients(raw,ref,recipe.id,recipe.title)
    assert.equal(resolved.length,raw.length,'Aucune ligne ne disparaît pendant la résolution')
    const needs=aggregateRequirements([resolved])
    const empty=await compareToStock(needs,[],ref,undefined,context())
    assert.equal(empty.length,needs.length)
    for(const row of empty){assert.equal(row.qte_stock,0);assert.equal(row.qte_a_acheter,row.qte)}
    // Full stock in the exact requested units avoids inventing conversions.
    const full=needs.filter(n=>n.ingredient_id && !n.needs_review && !n.quantity_unknown).map((n,i)=>({id:`full-${i}`,produit:n.produit,ingredient_id:n.ingredient_id,qte:Math.max(1,n.qte)*100,unite:n.unite}))
    const covered=await compareToStock(needs,full,ref,undefined,context())
    for(let i=0;i<needs.length;i++){
      if(needs[i].ingredient_id && !needs[i].needs_review && !needs[i].quantity_unknown) assert.equal(covered[i].qte_a_acheter,0,needs[i].produit)
      else assert.equal(covered[i].qte_stock,0,'Un besoin ambigu ne déduit aucun stock')
    }
    // Each need tested alone: stock must cover exactly half a precise quantity.
    for(const n of needs.filter(n=>n.ingredient_id && !n.needs_review && !n.quantity_unknown)){
      const [half]=await compareToStock([n],[{id:'half',produit:n.produit,ingredient_id:n.ingredient_id,qte:n.qte/2,unite:n.unite}],ref,undefined,context())
      const expected=n.quantity_mode==='presence'?0:n.qte/2
      assert.ok(Math.abs(half.qte_a_acheter-expected)<.0001,`Stock partiel ${n.produit}: ${half.qte_a_acheter} attendu ${expected}`)
    }
    const incompatible=await compareToStock(needs,[{id:'foreign',produit:'Détergent hors alimentation',ingredient_id:'foreign-id',qte:999999,unite:'g'}],ref,undefined,context())
    for(const row of incompatible) assert.equal(row.qte_stock,0,'Un stock incompatible ne couvre rien')
    const unconvertible=await compareToStock(needs,needs.filter(n=>n.ingredient_id && !n.needs_review).map((n,i)=>({id:`bad-unit-${i}`,produit:n.produit,ingredient_id:n.ingredient_id,qte:999999,unite:'thermostat inconnu'})),ref,undefined,context())
    for(const n of unconvertible) if(n.quantity_mode==='quantity') assert.equal(n.qte_stock,0,'Une unité impossible ne couvre aucun besoin précis')
    const invalidStock=await compareToStock(needs,needs.map((n,i)=>({id:`zero-${i}`,produit:n.produit,ingredient_id:n.ingredient_id,qte:0,unite:n.unite})),ref,undefined,context())
    for(const n of invalidStock) assert.equal(n.qte_stock,0,'Un stock zéro ne couvre jamais un besoin')
    const doubled=aggregateRequirements([await resolveRecipeIngredients(raw,ref,recipe.id,recipe.title,2)])
    assert.equal(doubled.length,needs.length)
    for(let i=0;i<needs.length;i++) assert.ok(Math.abs(doubled[i].qte-(needs[i].quantity_mode==='presence'?1:needs[i].qte*2))<.0001,`Portions ${needs[i].produit}`)
    // Real shopping preparation must retain every unavailable/ambiguous requirement.
    const prepared=empty.map(row=>prepareShoppingRequirement(row,ref))
    assert.equal(prepared.length,needs.length)
    for(let i=0;i<prepared.length;i++){
      assert.ok(Number.isFinite(prepared[i].qte_a_acheter) && prepared[i].qte_a_acheter>=0)
      if(prepared[i].reference_unit_issue) assert.equal(prepared[i].ingredient_id,null)
      if(needs[i].quantity_mode==='presence' && needs[i].ingredient_id){
        const pack=ref.pantryProducts!.get(needs[i].ingredient_id!)
        if(pack?.enabled) assert.equal(prepared[i].qte_a_acheter,Number(pack.default_quantity))
      }
    }
    reports.push({id:recipe.id,title:recipe.title,raw_lines:recipe.ingredients.length,parsed_lines:raw.length,
      resolved:resolved.filter(n=>n.ingredient_id && !n.needs_review).length,unresolved:resolved.filter(n=>!n.ingredient_id || n.needs_review).map(n=>n.produit),
      empty_ingredients:raw.length===0,inferred_lines:raw.filter(n=>n.inferredFromInstructions).length,unknown_quantities:resolved.filter(n=>n.quantity_unknown).map(n=>n.produit),
      conversion_reviews:prepared.filter(n=>n.reference_unit_issue).map(n=>({ingredient:n.produit,reason:n.reference_unit_issue})),scenarios:8})
  })
}
after(()=>{
  if(!process.env.MEALIO_TEST_REPORT_DIR) return
  const dir=process.env.MEALIO_TEST_REPORT_DIR;fs.mkdirSync(dir,{recursive:true})
  const summary={recipes:recipes.length,raw_lines:455,completed_recipes:reports.length,scenarios:reports.reduce((n,r)=>n+r.scenarios,0),
    resolved_lines:reports.reduce((n,r)=>n+r.resolved,0),unknown_quantity_lines:reports.reduce((n,r)=>n+r.unknown_quantities.length,0),
    conversion_review_lines:reports.reduce((n,r)=>n+r.conversion_reviews.length,0),empty_recipes:reports.filter(r=>r.empty_ingredients).map(r=>r.title),
    scope:'Production Cookiwiki fetcher, parser, resolver, aggregation, stock comparison and shopping preparation. Supabase local doubles; AI conservative abstention. Reference: supplied 344-ingredient snapshot. Not a live DB or AI quality test.',reports}
  fs.writeFileSync(path.join(dir,'cookiwiki-56-campaign.json'),JSON.stringify(summary,null,2))
  const rows=reports.map(r=>`| ${r.title.replace(/\|/g,'/')} | ${r.raw_lines} | ${r.resolved}/${r.parsed_lines} | ${r.unresolved.join(', ') || '—'} | ${r.conversion_reviews.map((v:any)=>v.ingredient).join(', ') || '—'} | ${r.empty_ingredients?'Aucun ingrédient exploitable':r.unknown_quantities.join(', ') || '—'} |`).join('\n')
  fs.writeFileSync(path.join(dir,'cookiwiki-56-campaign.md'),`# Campagne Cookiwiki\n\n${reports.length}/56 recettes, 455 lignes brutes, ${summary.scenarios} scénarios terminés.\n\nScénarios : stock vide, stock suffisant, demi-stock, stock incompatible, portions ×2, conservation et formats des courses, unité impossible, stock zéro.\n\nRéférentiel fourni : 344 ingrédients. IA simulée en abstention, stock synthétique, aucune requête externe. Les points ci-dessous nécessitent enrichissement ou validation ; un scénario vert ne signifie pas que chaque association est résolue.\n\n| Recette | Lignes | Résolues / parsées | À valider | Conversions à préciser | Quantités inconnues |\n|---|---:|---:|---|---|---|\n${rows}\n`)
})

import { generateShoppingListForPeriod } from '../../app/utils/shopping-list-generator'
// @ts-expect-error local I/O doubles
import { calls } from '../../test-support/db.mjs'
test('recette réelle sans ingrédients : alerte visible, aucun achat inventé',async()=>{
  const recipe=recipes.find((r:any)=>r.title==='Popcorn de poulet au sesame')
  setDbResolver((call:any)=>{
    if(call.action!=='select') return {data:call.single?{id:'new',...call.payload}:[],error:null}
    if(call.table==='meal_plans')return {data:[{recipe_id:recipe.id,servings:4}],error:null}
    if(call.table==='shopping_lists')return {data:[{id:'list',period_start:'2026-10-07',period_end:'2026-10-13'}],error:null}
    if(call.table==='recipes')return {data:recipe,error:null}
    if(call.table==='app_users')return {data:{id:`${call.source}-user`,username:'Famille'},error:null}
    return {data:call.table==='pantry_products'?defaults:snapshot[call.table] ?? [],error:null}
  })
  const result=await generateShoppingListForPeriod('frosti-user','Famille','2026-10-07','2026-10-13','Test')
  assert.equal(result.issueCount,1);assert.equal(result.issues[0].recipe_nom,recipe.title)
  assert.match(result.issues[0].message,/aucun ingrédient exploitable/)
  assert.ok(!calls.some((c:any)=>c.table==='shopping_items'&&c.action==='insert'))
})
