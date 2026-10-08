import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanText, loadReferenceData, resolveIngredientDeterministic, resolveRecipeIngredients, aggregateRequirements, compareToStock, convertQuantityToUnit } from '../../app/utils/matcher'
import { getRecipeDetailsFromCookiwiki } from '../../app/utils/cookiwiki-fetcher'
import { prepareShoppingRequirement } from '../../app/utils/shopping-requirement-policy'
// @ts-expect-error local I/O doubles
import { setDbResolver } from '../../test-support/db.mjs'
// @ts-expect-error local I/O doubles
import { setCookies } from '../../test-support/headers.mjs'
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures')
const read=(f:string)=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))
const original=read('reference-snapshot.json'), manifest=read('reference-enrichment.json'), recipes=read('cookiwiki-56.json'), pantry=read('pantry-defaults.json')
const enriched=structuredClone(original)
const inserted:any[]=[]
for(const a of manifest.aliases){
  const target=enriched.official_ingredients.find((i:any)=>i.nom===a.ingredient_name)
  if(!target)continue
  if(enriched.ingredient_synonyms.some((s:any)=>cleanText(s.mot_recette)===cleanText(a.alias)))continue
  if(enriched.official_ingredients.some((i:any)=>cleanText(i.nom)===cleanText(a.alias)&&i.id!==target.id))continue
  enriched.ingredient_synonyms.push({mot_recette:a.alias,ingredient_id:target.id});inserted.push(a)
}
for(const u of manifest.units) if(!enriched.unit_mappings.some((x:any)=>cleanText(x.unite)===cleanText(u.unite)))enriched.unit_mappings.push(u)
for(const ingredient of enriched.official_ingredients){
  const rows=enriched.ingredient_densities.filter((d:any)=>d.ingredient_id===ingredient.id&&['Cuillère à soupe','Cuillère à café'].includes(d.unite))
  const types=new Set(rows.map((d:any)=>d.unite))
  if(types.size<2)continue
  const ratios=rows.map((d:any)=>Number(d.poids_g_approx)/(d.unite==='Cuillère à soupe'?15:5))
  if(ratios.some((v:number)=>!Number.isFinite(v)||v<=0)||Math.max(...ratios)-Math.min(...ratios)>=.000001)continue
  if(!enriched.ingredient_densities.some((d:any)=>d.ingredient_id===ingredient.id&&d.unite==='Millilitre'))enriched.ingredient_densities.push({ingredient_id:ingredient.id,unite:'Millilitre',poids_g_approx:ratios.reduce((a:number,b:number)=>a+b,0)/ratios.length})
}
async function reference(data= enriched){
  setCookies({});setDbResolver((c:any)=>({data:c.table==='pantry_products'?pantry:data[c.table]??[],error:null}))
  return loadReferenceData()
}
process.env.ANTHROPIC_API_KEY='local-test'
globalThis.fetch=async()=>Response.json({content:[{type:'text',text:'{"match":"AUCUN","confidence":0}'}]})
const report:any[]=[]
for(const a of inserted) test(`synonyme enrichi : ${a.alias} → ${a.ingredient_name}`,async()=>{
  const ref=await reference();const result=resolveIngredientDeterministic(a.alias,ref)
  assert.equal(ref.officialById.get(result.id!)?.nom,a.ingredient_name)
})
test('équivalences en mL : uniquement mesures existantes cohérentes',()=>{
  const newRows=enriched.ingredient_densities.filter((d:any)=>d.unite==='Millilitre')
  assert.equal(newRows.length,2)
  assert.ok(!newRows.some((d:any)=>original.official_ingredients.find((i:any)=>i.id===d.ingredient_id)?.nom==="Huile d'olive"))
})
test('farine, lait, sel/poivre et alternatives : aucun choix caché ajouté',()=>{
  for(const raw of ['farine','lait','huile','sel et poivre','bacon ou jambon','poivron jaune ou rouge','crème fraîche','saucisses','cocos de Paimpol AOP en gousses'])
    assert.ok(!manifest.aliases.some((a:any)=>cleanText(a.alias)===cleanText(raw)))
})
test('unités nouvelles : identité seulement, aucune conversion en masse',async()=>{
  const ref=await reference()
  for(const u of manifest.units){
    assert.deepEqual(convertQuantityToUnit(ref,null,2,u.unite,u.unite),{qty:2,unit:u.unite})
    assert.equal(convertQuantityToUnit(ref,null,2,u.unite,'Gramme'),null)
  }
})
test('abréviations culinaires des recettes : c. à soupe/café',async()=>{
  const ref=await reference()
  assert.deepEqual(convertQuantityToUnit(ref,null,1,'c. à soupe','Millilitre'),{qty:15,unit:'Millilitre'})
  assert.deepEqual(convertQuantityToUnit(ref,null,1,'c. à café','Millilitre'),{qty:5,unit:'Millilitre'})
})
for(const recipe of recipes) test(`avant/après enrichissement : ${recipe.title}`,async()=>{
  setDbResolver((call:any)=>({data:recipe,error:null}));const details=await getRecipeDetailsFromCookiwiki(recipe.id)
  const before=await reference(original), afterRef=await reference()
  const resolve=(ref:any)=>resolveRecipeIngredients(details.ingredients,ref,recipe.id,recipe.title)
  const baseline=await resolve(before), resolved=await resolve(afterRef)
  assert.equal(resolved.length,baseline.length)
  for(let i=0;i<resolved.length;i++) if(baseline[i].ingredient_id&&!baseline[i].needs_review){
    assert.equal(resolved[i].ingredient_id,baseline[i].ingredient_id,'Une association fiable existante ne doit pas changer')
  }
  const needs=aggregateRequirements([resolved])
  const compared=await compareToStock(needs,[],afterRef,undefined,{stopWords:new Set<string>(),memory:new Map(),exclusions:new Set<string>(),persistMemory:false})
  const prepared=compared.map(n=>prepareShoppingRequirement(n,afterRef))
  assert.equal(prepared.length,needs.length)
  for(const n of prepared)assert.ok(Number.isFinite(n.qte_a_acheter)&&n.qte_a_acheter>=0)
  report.push({title:recipe.title,before:baseline.filter(n=>n.ingredient_id&&!n.needs_review).length,
    after:resolved.filter(n=>n.ingredient_id&&!n.needs_review).length,total:resolved.length,
    remaining:resolved.filter(n=>n.needs_review).map(n=>n.produit),conversions:prepared.filter(n=>n.reference_unit_issue).map(n=>n.produit)})
})
after(()=>{
  if(!process.env.MEALIO_TEST_REPORT_DIR)return
  const out=process.env.MEALIO_TEST_REPORT_DIR;fs.mkdirSync(out,{recursive:true})
  const summary={scope:'Simulation du SQL sur le précédent export, modules réels ; IA en abstention, pas de Supabase connecté.',
    aliases_proposed:manifest.aliases.length,aliases_inserted_in_snapshot:inserted.length,
    before:report.reduce((n,r)=>n+r.before,0),after:report.reduce((n,r)=>n+r.after,0),recipes:report.length,report}
  fs.writeFileSync(path.join(out,'cookiwiki-enrichment.json'),JSON.stringify(summary,null,2))
  fs.writeFileSync(path.join(out,'cookiwiki-enrichment.md'),`# Enrichissement Cookiwiki — simulation\n\n${summary.aliases_proposed} alias proposés, ${inserted.length} insérables sur l'ancien export de 344 ingrédients.\n${report.length} recettes : ${summary.before} lignes résolues avant, ${summary.after} après. Les masses par pièce ne sont pas inventées.\n\n${summary.scope}\n\n| Recette | Avant | Après / lignes | Reste à vérifier | Conversions |\n|---|---:|---:|---|---|\n${report.map(r=>`| ${r.title} | ${r.before} | ${r.after}/${r.total} | ${r.remaining.join(', ')||'—'} | ${r.conversions.join(', ')||'—'} |`).join('\n')}\n`)
})

for(const [raw,stockName] of [['figues fraîches','Figue séchée'],['œufs frais',"Blanc d'œuf"],['ail','Ail en poudre']]){
  test(`enrichissement : ${stockName} ne couvre pas ${raw}`,async()=>{
    const ref=await reference();const target=resolveIngredientDeterministic(raw,ref)
    assert.ok(target.id)
    const ingredient=ref.officialById.get(target.id!)!
    const rows=await resolveRecipeIngredients([{name:raw,qty:2,unit:ingredient.unite_reference!}],ref,'r','Test')
    const stock=ref.officialList.find(i=>i.nom===stockName)!
    const [result]=await compareToStock(aggregateRequirements([rows]),[{id:'s',produit:stockName,ingredient_id:stock?.id ?? 'fixture-missing-reference',qte:1000,unite:ingredient.unite_reference!}],ref,undefined,{stopWords:new Set<string>(),memory:new Map(),exclusions:new Set<string>(),persistMemory:false})
    assert.equal(result.qte_stock,0)
  })
}
