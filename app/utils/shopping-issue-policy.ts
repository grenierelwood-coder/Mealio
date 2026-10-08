import { matcherCorrectionLink } from './matcher-correction-link'
export type CorrectionIssue = { id?: string; shopping_item_id?: string | null; produit: string; issue_type: string; message: string; resolution_hint?: string; unit?: string | null; recipe_id?: string | null; phase?: string }
export type IssueGroup = { key: string; produit: string; issues: CorrectionIssue[] }
export function shoppingProductKey(name: string) { return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ') }
export function groupShoppingIssues(issues: CorrectionIssue[]): IssueGroup[] {
 const groups = new Map<string, IssueGroup>()
 for (const issue of issues) {
  const key=shoppingProductKey(issue.produit), group=groups.get(key)??{key,produit:issue.produit,issues:[]}
  const signature=(i:CorrectionIssue)=>JSON.stringify([i.issue_type,i.message,i.unit,i.recipe_id,i.phase])
  if (!group.issues.some(i=>signature(i)===signature(issue))) group.issues.push(issue)
  groups.set(key,group)
 }
 return [...groups.values()]
}
export function correctionAction(issue: CorrectionIssue) {
 if (issue.phase && issue.phase !== 'generation') return {kind:'external' as const,href:'/admin/storage/pending',name:issue.produit,target:issue.produit}
 const href=matcherCorrectionLink(issue),params=new URL(href,'https://mealio.local').searchParams
 return {kind:href.startsWith('/matcher/correction')?'association' as const:href.startsWith('/admin/ingredients')&&!/unité (?:inconnue|refusée|de référence.*(?:absente|définir))/i.test(issue.message)?'density' as const:'external' as const,
  href,name:params.get('name')||issue.produit,target:params.get('target_name')||issue.produit}
}
