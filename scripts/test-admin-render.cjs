/** Renders the real Admin TSX with local data and HTTP doubles; no DB or AI. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const fixture = {
  ingredients: [{id:'sausage',nom:'Saucisse fraîche',unite_reference:'Pièce',categorie:'Viandes',quantity_mode:'quantity'}],
  synonyms: [{ingredient_id:'sausage',mot_recette:'Saucisses'}],
  units: [{unite:'Pièce'},{unite:'Gousse'},{unite:'Gramme'}],
  densities: [{ingredient_id:'sausage',unite:'Pièce',poids_g_approx:100}],
  conversions: [], usage: {shopping:[],purchases:[],recurring:[],thresholds:[],favorites:[]},
}
let state = [], cursor = 0
const hooks = {...React,
  useState(initial) {
    const index = cursor++
    if (!(index in state)) state[index] = index === 0 ? fixture : index === 1 ? false : initial
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
  },
  useMemo: fn => fn(), useEffect: () => {}, useRef: () => ({current:null}),
}
const source = fs.readFileSync(process.env.MEALIO_ADMIN_SOURCE || path.join(__dirname,'../app/admin/ingredients/page.tsx'),'utf8')
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}})
const moduleUnderTest = {exports:{}}
new Function('require','module','exports',compiled.outputText)(name => {
  if (name === 'react') return hooks
  if (name === 'next/link') return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}
  if (name.includes('quantity-policy')) return {isPresenceOnlyIngredient: i => i?.quantity_mode === 'presence'}
  return require(name)
}, moduleUnderTest, moduleUnderTest.exports)
function tree(){cursor=0;return moduleUnderTest.exports.default()}
function nodes(value, result=[]){
  if(Array.isArray(value)) value.forEach(v=>nodes(v,result))
  else if(React.isValidElement(value)){result.push(value);nodes(value.props.children,result)}
  return result
}
const text = node => renderToStaticMarkup(node)
async function main(){
  let view = tree()
  assert.match(text(view),/Toutes les unités de référence/)
  assert.match(text(view),/Gousse/)
  assert.doesNotMatch(text(view),/Fiche ingrédient/)
  // Loaded units with no draft used to crash during filter(), unlike the empty loading state.
  nodes(view).find(n=>n.type==='button' && n.props.children==='Saucisse fraîche').props.onClick()
  view = tree()
  assert.match(text(view),/Poids moyens et conversions/)
  assert.match(text(view),/Synonymes \/ correspondances/)
  const densityRow = nodes(view).find(n=>n.type==='div' && Array.isArray(n.props.children) && n.props.children.some(c=>React.isValidElement(c)&&c.type==='span'&&text(c).includes('100 g')))
  assert.ok(densityRow)
  nodes(densityRow).find(n=>n.type==='button'&&n.props.children==='Modifier').props.onClick()
  view = tree()
  assert.equal(nodes(view).find(n=>n.props['aria-label']==='Unité du poids moyen').props.value,'Pièce')
  nodes(view).find(n=>n.props['aria-label']==='Poids moyen en grammes').props.onChange({target:{value:'120'}})
  view = tree()
  const requests=[]
  global.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>fixture}}
  await nodes(view).find(n=>n.type==='button'&&n.props.children==='Enregistrer le poids').props.onClick()
  assert.deepEqual(JSON.parse(requests[0].options.body),{entity:'density',ingredient_id:'sausage',unite:'Pièce',poids_g_approx:'120'})
  assert.equal(requests[0].options.method,'POST')
  assert.ok(nodes(tree()).find(n=>n.props.children==='Enregistrer le poids').props.disabled)
  console.log('Admin: chargement sans fiche, édition du poids et sauvegarde 120 g — OK')
}
main().catch(error=>{console.error(error);process.exitCode=1})
