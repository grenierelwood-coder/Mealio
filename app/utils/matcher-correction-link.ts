export function matcherCorrectionLink(issue: { produit: string; issue_type: string; message: string; recipe_id?: string | null }) {
  if (/^RECIPE_(QUANTITY|STRUCTURE|PROCESSING)/.test(issue.issue_type)) return `/admin/recipes${issue.recipe_id ? `?recipe_id=${encodeURIComponent(issue.recipe_id)}` : ''}`
  if (/CONVERSION|UNIT/.test(issue.issue_type)) return `/admin/ingredients?search=${encodeURIComponent(issue.produit)}`
  const stock = issue.message.match(/Proposition IA à valider\s*:\s*«\s*([^»]+)»/)
  const recipe = issue.message.match(/Proposition «([^»]+)» pour «([^»]+)»/)
  const name = stock?.[1]?.trim() || recipe?.[2]?.trim() || issue.produit
  const target = stock ? issue.produit : recipe?.[1]?.trim() || ''
  return `/matcher/correction?name=${encodeURIComponent(name)}&target_name=${encodeURIComponent(target)}`
}
