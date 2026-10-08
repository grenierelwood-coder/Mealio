/** JSON recipe structures shared by the reader and the correction screen. */
export type RecipeLine = {
  name: string
  qty?: number | null
  unit?: string
  quantity_source?: 'explicit' | 'estimated' | 'presence'
  note?: string
  optional?: boolean
  included?: boolean
  exclude_from_shopping?: boolean
  components?: RecipeLine[]
  alternatives?: RecipeLine[]
  selected?: number | null
}
export type PreparedRecipeLine = {
  name: string; qty: number; unit: string
  quantityEstimated?: boolean; qualityNote?: string; preparationIssue?: string
}

/** Never guess the composition of a free-text label or select an alternative implicitly. */
export function expandRecipeLines(raw: unknown, depth = 0): PreparedRecipeLine[] {
  if (!Array.isArray(raw)) return []
  if (depth > 5 || raw.length > 500) throw new Error('Structure d’ingrédients trop profonde ou trop longue.')
  return raw.flatMap((value: any): PreparedRecipeLine[] => {
    if (!value || typeof value !== 'object') return []
    const name = String(value.name || value.nom || value.ingredient || '').trim()
    if (!name) return []
    if (value.exclude_from_shopping === true || (value.optional === true && value.included !== true)) return []
    const problem = (reason: string): PreparedRecipeLine[] => [{name,qty:0,unit:'',preparationIssue:reason}]
    if (value.components !== undefined && value.alternatives !== undefined) return problem('Une ligne ne peut pas être à la fois un mélange et une alternative.')
    if (value.components !== undefined) {
      if (!Array.isArray(value.components) || !value.components.length) return problem('Préciser les composants du mélange.')
      const parts = expandRecipeLines(value.components,depth+1)
      return parts.length ? parts.map(part=>({...part,
        ...(value.quantity_source === 'estimated' ? {quantityEstimated:true} : {}),
        ...(value.note ? {qualityNote:[value.note,part.qualityNote].filter(Boolean).join(' · ')} : {}),
      })) : problem('Le mélange ne contient aucun composant actif.')
    }
    if (value.alternatives !== undefined) {
      const choices = value.alternatives
      const choice = value.selected
      if (!Array.isArray(choices) || !Number.isInteger(choice) || choice < 0 || choice >= choices.length) return problem('Choisir une alternative avant de calculer les courses.')
      return expandRecipeLines([choices[choice]],depth+1)
    }
    const rawQty = value.qty ?? value.quantite ?? value.quantity ?? value.amount
    const number = rawQty === '' || rawQty == null ? 0 : Number(rawQty)
    return [{name,qty:Number.isFinite(number)&&number>=0?number:0,unit:String(value.unit || value.unite || '').trim(),
      ...(value.quantity_source === 'estimated' ? {quantityEstimated:true} : {}),
      ...(value.note ? {qualityNote:String(value.note)} : {}),
    }]
  })
}

/** Reject malformed edits before a write to the shared recipe library. */
export function validateRecipeLines(raw: unknown, depth = 0): asserts raw is RecipeLine[] {
  if (!Array.isArray(raw) || raw.length > 500 || depth > 5) throw new Error('Liste d’ingrédients invalide (500 lignes, 5 niveaux maximum).')
  for (const line of raw) {
    if (!line || typeof line !== 'object' || typeof line.name !== 'string' || !line.name.trim() || line.name.length > 500) throw new Error('Chaque ingrédient doit avoir un nom.')
    if (line.unit !== undefined && (typeof line.unit !== 'string' || line.unit.length > 100)) throw new Error('Unité invalide.')
    if (line.note !== undefined && (typeof line.note !== 'string' || line.note.length > 2000)) throw new Error('Note invalide.')
    if (line.quantity_source !== undefined && !['explicit','estimated','presence'].includes(line.quantity_source)) throw new Error('Origine de quantité invalide.')
    for (const key of ['optional','included','exclude_from_shopping']) if (line[key] !== undefined && typeof line[key] !== 'boolean') throw new Error('Option d’ingrédient invalide.')
    if (line.qty !== undefined && line.qty !== null && (typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty < 0)) throw new Error('La quantité doit être positive ou nulle ; null signifie inconnue.')
    if (line.components !== undefined && line.alternatives !== undefined) throw new Error('Mélange et alternative simultanés interdits.')
    if (line.components !== undefined) {validateRecipeLines(line.components,depth+1);if(!line.components.length)throw new Error('Mélange vide.')}
    if (line.alternatives !== undefined) {
      validateRecipeLines(line.alternatives,depth+1)
      if (!line.alternatives.length || !(line.selected === null || line.selected === undefined || typeof line.selected==='number'&&Number.isInteger(line.selected)&&line.selected>=0&&line.selected<line.alternatives.length)) throw new Error('Choix d’alternative invalide.')
    }
    if (!line.components && !line.alternatives && /^ail$/i.test(line.name.trim()) && /^(pi[eè]ces?|unit[eé]s?)$/i.test(line.unit||'')) throw new Error('Ail : utiliser Gousse ou une masse ; Pièce est interdite.')
  }
}

/** Stable JSON comparison, independent of jsonb object key ordering. */
export function recipeJsonKey(value: unknown): string {
  const sort=(item:any):any=>Array.isArray(item)?item.map(sort):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sort(item[key])])):item
  return JSON.stringify(sort(value??null))
}
