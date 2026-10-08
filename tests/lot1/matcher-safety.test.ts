import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateRequirements, compareToStock, convertStockQuantity, cleanText,
  resolveRecipeIngredients, resolveIngredientDecision, createMatcherTrace, loadReferenceData,
} from '../../app/utils/matcher'
import { makeReferenceData, IDS, ingredient, stockItem } from '../../scripts/matcher-test-fixtures'
// These imports exist only in the isolated temporary test tree.
// @ts-expect-error local I/O doubles are supplied by scripts/test-offline.mjs
import { calls, setDbResolver } from '../../test-support/db.mjs'

process.env.ANTHROPIC_API_KEY = 'offline-test'
let httpCalls = 0
let aiResponse: unknown = { match: 'AUCUN', confidence: 0, reason: 'Aucun' }
globalThis.fetch = async () => {
  httpCalls++
  if (aiResponse === null) throw new Error('Simulated outage')
  return Response.json({ content: [{ type: 'text', text: JSON.stringify(aiResponse) }] })
}
const makeContext = () => ({ stopWords: new Set(['de','du','des','la','le','les']),
  memory: new Map(), exclusions: new Set<string>(), persistMemory: false })
const requirement = (id: string, name: string, qty = 500, unit = 'g', mode: 'quantity' | 'presence' = 'quantity') => ({
  ingredient_id: id, produit: name, qte: qty, unite: unit,
  quantity_mode: mode, needs_review: false, contributions: [],
})
const flour = () => requirement(IDS.farine, 'Farine de blé')

for (const qty of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`présence : un stock ${qty} n'est pas disponible`, async () => {
    const result = await compareToStock([requirement(IDS.sel,'Sel fin',1,'Pièce','presence')],
      [stockItem('s','Sel fin',qty,'boîte',IDS.sel)], makeReferenceData(), undefined, makeContext())
    assert.equal(result[0].qte_a_acheter, 1)
  })
}

test('une ancienne mémoire validée ne peut pas contourner une identité contradictoire', async () => {
  const ref = makeReferenceData(); const ctx = makeContext()
  ctx.memory.set(cleanText('Farine de blé',ctx.stopWords), [{stock_item_id:'s', validated:true, confidence:1, source:'human'}])
  const result = await compareToStock([flour()], [stockItem('s','Farine de riz',1000,'g',IDS.farineRiz)],ref,undefined,ctx)
  assert.equal(result[0].qte_stock,0); assert.equal(result[0].qte_a_acheter,500)
})

test('le libellé ne peut pas contourner un ingredient_id contradictoire', async () => {
  const result=await compareToStock([flour()], [stockItem('s','Farine de blé',1000,'g',IDS.farineRiz)],makeReferenceData(),undefined,makeContext())
  assert.equal(result[0].qte_a_acheter,500)
})

test('le refus reste effectif même si la farine de riz manque au référentiel', async () => {
  const ref=makeReferenceData(); ref.officialList=ref.officialList.filter(x=>x.id!==IDS.farineRiz);ref.officialById.delete(IDS.farineRiz)
  const result=await compareToStock([flour()],[stockItem('s','Farine de riz',1000,'g')],ref,undefined,makeContext())
  assert.equal(result[0].qte_a_acheter,500)
})

test('ignored_words ne peut pas effacer les qualificatifs de la garde stock', async () => {
  const ctx=makeContext();ctx.stopWords.add('ble');ctx.stopWords.add('riz')
  const result=await compareToStock([flour()],[stockItem('s','Farine de riz spéciale',1000,'g')],makeReferenceData(),undefined,ctx)
  assert.equal(result[0].qte_a_acheter,500)
})

test('un synonyme explicite sans mots communs reste utilisable sans IA', async () => {
  const before=httpCalls
  const result=await compareToStock([requirement(IDS.courgette,'Courgette',2,'piece')],
    [stockItem('s','zucchini',3,'piece')],makeReferenceData(),undefined,makeContext())
  assert.equal(result[0].qte_a_acheter,0);assert.equal(httpCalls,before)
})

test('une exclusion humaine reste prioritaire sur une correspondance exacte', async () => {
  const ctx=makeContext();ctx.exclusions.add(`${cleanText('Farine de blé',ctx.stopWords)}::s`)
  const result=await compareToStock([flour()],[stockItem('s','Farine de blé',1000,'g')],makeReferenceData(),undefined,ctx)
  assert.equal(result[0].qte_a_acheter,500)
})

test('un besoin non validé ne diminue jamais les achats', async () => {
  const result=await compareToStock([{...flour(),needs_review:true}],[stockItem('s','Farine de blé',1000,'g')],makeReferenceData(),undefined,makeContext())
  assert.equal(result[0].qte_stock,0);assert.equal(result[0].qte_a_acheter,500)
})

test('une proposition IA de stock attend une validation et ne déduit rien', async () => {
  const ref=makeReferenceData();aiResponse={match:'s',confidence:.99,reason:'Marque'}
  const result=await compareToStock([flour()],[stockItem('s','Farine de blé marque spéciale',1000,'g')],ref,undefined,makeContext())
  assert.equal(result[0].qte_stock,0);assert.equal(result[0].needs_review,true)
  assert.match(result[0].stock_match_review!,/valider/)
})

test('persistMemory=false interdit aussi les écritures du chemin synonyme', async () => {
  setDbResolver(()=>({data:[],error:null}))
  await compareToStock([requirement(IDS.courgette,'Courgette',2,'piece')],
    [stockItem('s','zucchini',3,'piece')],makeReferenceData(),undefined,makeContext())
  assert.equal(calls.length,0)
})

for (const [qty,from,to,expected,unit] of [
  [2,'cs','cc',30,'mL'],[42,'g','cs',30,'mL'],[1,'kg','kg',1000,'g'],
  [2,'l','l',2000,'mL'],[1000,'mg','kg',1,'g'],[500,'mL','l',500,'mL'],
] as const) {
  test(`conversion ${qty} ${from} vers ${to} : quantité et unité canonique cohérentes`,()=>{
    const actual=convertStockQuantity(makeReferenceData(),IDS.miel,qty,from,to)
    assert.ok(actual);assert.equal(actual.qty,expected);assert.equal(actual.unit,unit)
  })
}

test('une quantité négative ne peut pas être convertie',()=>{
  assert.equal(convertStockQuantity(makeReferenceData(),IDS.miel,-1,'g','g'),null)
})

test('une quantité inférée reste inconnue de la recette aux achats',async()=>{
  const ref=makeReferenceData()
  const resolved=await resolveRecipeIngredients([{name:'Courgette',qty:1,unit:'pièce',inferredFromInstructions:true}],ref,'r','R')
  assert.equal(resolved[0].quantity_unknown,true);assert.equal(resolved[0].qte,0)
  const aggregated=aggregateRequirements([resolved]);assert.equal(aggregated[0].quantity_unknown,true)
  const result=await compareToStock(aggregated,[],ref,undefined,makeContext())
  assert.equal(result[0].ai_status,'orange');assert.equal(result[0].needs_review,true)
  assert.equal(result[0].qte_a_acheter,0);assert.match(result[0].stock_match_review!,/inconnue/)
})

for (const qty of [0,-2,Number.NaN,Number.POSITIVE_INFINITY]) {
  test(`une quantité recette ${qty} n'est jamais un besoin fiable`,async()=>{
    const resolved=await resolveRecipeIngredients([ingredient('Courgette',qty,'pièce')],makeReferenceData(),'r','R')
    assert.equal(resolved[0].quantity_unknown,true);assert.equal(resolved[0].qte,0)
  })
}

test('500 g et 2 pièces restent séparés lors de l’agrégation',()=>{
  const rows=aggregateRequirements([[{...requirement(IDS.tomate,'Tomate',500,'g')}, {...requirement(IDS.tomate,'Tomate',2,'piece')} ]])
  assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.qte),[500,2])
})

test('une quantité inconnue ne contamine pas un besoin connu du même ingrédient',()=>{
  const rows=aggregateRequirements([[flour(),{...flour(),qte:0,quantity_unknown:true,needs_review:true}]])
  assert.equal(rows.length,2);assert.equal(rows.find(x=>!x.quantity_unknown)?.qte,500)
})

test('une panne Claude ne produit pas de décision AUCUN persistante',async()=>{
  setDbResolver(()=>({data:[],error:null}));aiResponse=null
  const ref=makeReferenceData()
  const decision=await resolveIngredientDecision('Objet sans correspondance',ref)
  assert.equal(decision.id,null);assert.equal(decision.decision.source,'unresolved')
  assert.equal(ref.aiResolutionMap.size,0);assert.equal(ref.aiCache.size,0)
  assert.equal(calls.length,0)
})

test('un ancien AUCUN en attente ne bloque plus une nouvelle résolution',async()=>{
  setDbResolver(()=>({data:[],error:null}));aiResponse={match:IDS.farine,confidence:.9,reason:'Test'}
  const ref=makeReferenceData();const raw='Poudre pour crêpes'
  ref.aiResolutionMap.set(cleanText(raw),{mot_recette:raw,proposition_ia:'AUCUN',ingredient_id_propose:null,statut:'en_attente',created_at:null})
  const result=await resolveIngredientDecision(raw,ref)
  assert.equal(result.id,IDS.farine);assert.equal(result.aiProposed,true)
})

test('référentiel indisponible : interruption au lieu de données vides',async()=>{
  setDbResolver((call: {table:string})=>({data:[],error:call.table==='ingredient_synonyms'?{message:'offline'}:null}))
  await assert.rejects(loadReferenceData(),/ingredient_synonyms indisponible/)
})

test('exclusions indisponibles : interruption du rapprochement',async()=>{
  setDbResolver((call: {table:string})=>({data:[],error:call.table==='matcher_exclusions'?{message:'offline'}:null}))
  await assert.rejects(compareToStock([flour()],[],makeReferenceData(),undefined,{stopWords:new Set()}),/Exclusions matcher indisponibles/)
})

test('ignored_words ne peut pas transformer farine de riz en farine de blé au stade recette',async()=>{
  const ref=makeReferenceData();ref.ignoredSet.add('ble');ref.ignoredSet.add('riz')
  ref.officialList=ref.officialList.filter(x=>x.id!==IDS.farineRiz)
  ref.officialById.delete(IDS.farineRiz);ref.officialPrepared=ref.officialPrepared.filter(x=>x.item.id!==IDS.farineRiz)
  ref.officialPrepared=ref.officialPrepared.map(x=>({...x,normalized:cleanText(x.item.nom,ref.ignoredSet)}))
  aiResponse={match:'AUCUN',confidence:0,reason:'Différent'};setDbResolver(()=>({data:[],error:null}))
  const result=await resolveIngredientDecision('Farine de riz',ref)
  assert.equal(result.id,null)
})

test('un dépassement numérique des portions reste une quantité inconnue',async()=>{
  const result=await resolveRecipeIngredients([ingredient('Courgette',1e308,'pièce')],makeReferenceData(),'r','R',1e308)
  assert.equal(result[0].quantity_unknown,true);assert.equal(result[0].qte,0)
})

import { ingredientReferenceSignature } from '../../app/utils/matcher'
for (const reason of ['expired','changed'] as const) {
  test(`cache négatif ${reason} : Claude est de nouveau consulté`,async()=>{
    aiResponse={match:'AUCUN',confidence:0,reason:'Aucun'}
    const ref=makeReferenceData(),name='Produit absent xyz'
    ref.aiResolutionMap.set(cleanText(name),{mot_recette:name,proposition_ia:'AUCUN',ingredient_id_propose:null,statut:'en_attente',
      created_at:new Date(Date.now()-(reason==='expired'?25*3600000:0)).toISOString(),
      reference_signature:reason==='changed'?'ancien':ingredientReferenceSignature(ref)})
    const before=httpCalls
    await resolveIngredientDecision(name,ref)
    assert.equal(httpCalls,before+1)
  })
}
