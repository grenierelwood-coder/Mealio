/** Formats d'achat : ils décrivent l'achat, jamais une consommation estimée. */
export interface PantryProduct {
  ingredient_id: string
  default_quantity: number
  default_unit: string
  enabled: boolean
}

export function pantryMode(policy: PantryProduct | undefined): 'presence' | 'quantity' | undefined {
  return policy ? (policy.enabled ? 'presence' : 'quantity') : undefined
}

export function pantryPack(policy: PantryProduct | undefined): number | null {
  const quantity = Number(policy?.default_quantity)
  return policy?.enabled && Number.isFinite(quantity) && quantity > 0 ? quantity : null
}

export function validPantryProduct(row: PantryProduct): boolean {
  return typeof row.ingredient_id === 'string' && Boolean(row.ingredient_id) &&
    Number.isFinite(Number(row.default_quantity)) && Number(row.default_quantity) > 0 &&
    typeof row.default_unit === 'string' && Boolean(row.default_unit.trim()) && typeof row.enabled === 'boolean'
}
