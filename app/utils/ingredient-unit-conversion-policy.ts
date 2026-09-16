import type { ReferenceData } from './matcher'

/**
 * Politique Mealio pour les conversions culinaires propres à un ingrédient.
 *
 * IMPORTANT :
 * - ingredient_densities est la seule source métier pour les conversions
 *   culinaires propres à un ingrédient ;
 * - une conversion volume <-> volume n'est possible que si les deux unités
 *   possèdent chacune une densité explicite pour cet ingrédient ;
 * - aucune conversion transitive n'est matérialisée ou générée ;
 * - ingredient_unit_conversions et ingredient_unit_bridges sont historiques
 *   / techniques et ne doivent plus être alimentés par le code applicatif.
 */

export function canDeriveCulinaryConversion(
  refData: ReferenceData,
  ingredientId: string,
  fromUnit: string,
  toUnit: string,
): boolean {
  const from = refData.densities.find(
    d => d.ingredient_id === ingredientId &&
      normalize(d.unite) === normalize(fromUnit),
  )
  const to = refData.densities.find(
    d => d.ingredient_id === ingredientId &&
      normalize(d.unite) === normalize(toUnit),
  )

  return Boolean(from && to && Number(from.poids_g_approx) > 0 && Number(to.poids_g_approx) > 0)
}

export function assertNoMaterializedCulinaryConversionWrite(entity: string): never {
  throw new Error(
    `Création interdite pour « ${entity} ». Les conversions culinaires sont dérivées à la volée depuis ingredient_densities. ` +
    `Renseignez les deux densités explicites de l'ingrédient ; aucune conversion transitive ne doit être enregistrée.`,
  )
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
