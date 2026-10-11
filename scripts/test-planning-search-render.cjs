/** Exercise the real planning page and its search callbacks with a local catalogue. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const recipes = [{ id:'r',nom:'Crème aux légumes',title:'Crème aux légumes',tags:['Accompagnement'],ingredients:[{name:'Courgettes'}],servings:4,difficulty:'Facile' }]
let state = [recipes, [], false, false], cursor = 0
const hooks = { ...React, useMemo: fn => fn(), useEffect: () => {}, useState(initial) {
  const index = cursor++
  if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
  return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
} }
function compile(file, resolve) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
  const mod = {exports:{}}
  new Function('require','module','exports',code)(resolve, mod, mod.exports)
  return mod.exports
}
const search = compile('app/utils/planning-recipe-search.ts', require)
const page = compile('app/planning/page.tsx', name => name === 'react' ? hooks : name.includes('planning-recipe-search') ? search : require(name))
function tree() { cursor = 0; return page.default() }
function nodes(value, output = []) {
  if (Array.isArray(value)) value.forEach(v => nodes(v, output))
  else if (React.isValidElement(value)) {
    if (typeof value.type === 'function') nodes(value.type(value.props), output)
    else { output.push(value); nodes(value.props.children, output) }
  }
  return output
}
let view = tree()
nodes(view).find(n => n.type === 'button' && n.props.children === '+ Ajouter').props.onClick()
view = tree()
const input = nodes(view).find(n => n.type === 'input' && n.props.type === 'search')
input.props.onChange({target:{value:'legumes'}})
view = tree()
assert.match(renderToStaticMarkup(view), /Crème aux légumes/)
const checkbox = nodes(view).find(n => n.type === 'input' && n.props.type === 'checkbox')
assert.equal(checkbox.props.checked, false)
checkbox.props.onChange({target:{checked:true}})
view = tree()
assert.match(renderToStaticMarkup(view), /Aucune recette/)
nodes(view).find(n => n.type === 'button' && n.props.children === 'Retirer les filtres').props.onClick()
view = tree()
assert.match(renderToStaticMarkup(view), /Crème aux légumes/)
nodes(view).find(n => n.type === 'input' && n.props.type === 'search').props.onChange({target:{value:'courgette'}})
assert.match(renderToStaticMarkup(tree()), /Crème aux légumes/)
console.log('Planning : titre sans accent, ingrédient, recherche toutes catégories et retrait des filtres — OK')
