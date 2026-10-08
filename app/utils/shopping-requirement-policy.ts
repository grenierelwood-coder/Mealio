import { pantryPack } from './pantry-policy'
import { convertQuantityToUnit, type ComparedRequirement, type ReferenceData } from './matcher'

export interface PreparedShoppingRequirement extends ComparedRequirement {
  pantry_pack_quantity?: number | null
  reference_unit_issue?: string
}

/** Un besoin ne doit pas disparaître parce que son unité diffère du référentiel.
 * On convertit uniquement avec les données explicites. Sinon le besoin reste
 * visible dans son unité de recette, sans association officielle ni rangement
 * automatique jusqu'à résolution du problème.
 */
export function prepareShoppingRequirement(
  item: ComparedRequirement, refData: ReferenceData,
): PreparedShoppingRequirement {
  const policy = item.ingredient_id ? refData.pantryProducts?.get(item.ingredient_id) : undefined
  const pack = pantryPack(policy)
  if (item.quantity_mode === 'presence' && pack && policy) {
    // Présence oui/non côté Matcher ; quantité réelle uniquement côté achat.
    const buy = item.qte_a_acheter > 0 ? pack : 0
    return { ...item, qte: pack, qte_stock: 0, qte_a_acheter: buy,
      unite: policy.default_unit, pantry_pack_quantity: pack }
  }
  if (!item.ingredient_id || item.quantity_mode === 'presence') return { ...item }
  const official = refData.officialById.get(item.ingredient_id)
  const reference = official?.unite_reference?.trim()
  const quantity = reference ? convertQuantityToUnit(refData, item.ingredient_id, item.qte, item.unite, reference) : null
  const purchase = reference ? convertQuantityToUnit(refData, item.ingredient_id, item.qte_a_acheter, item.unite, reference) : null
  const stock = reference ? convertQuantityToUnit(refData, item.ingredient_id, item.qte_stock ?? 0, item.unite, reference) : null
  if (quantity && purchase && stock) {
    const wholeUnit = ['pièce','gousse','tranche','rouleau','bouquet','brin','feuille','sachet','bouteille'].includes(reference!.toLocaleLowerCase('fr'))
    const buy = wholeUnit && purchase.qty > 0 ? Math.ceil(purchase.qty - 1e-9) : purchase.qty
    return { ...item, qte: quantity.qty, qte_a_acheter: buy, qte_stock: stock.qty, unite: reference! }
  }
  return {
    ...item, ingredient_id: null, needs_review: true, ai_status: 'orange',
    reference_unit_issue: reference
      ? `Besoin conservé : ${item.qte_a_acheter} ${item.unite} de « ${item.produit} ». Aucune équivalence explicite ne permet de convertir en ${reference}. L'association officielle et le rangement automatique restent en attente.`
      : `Besoin conservé dans l'unité de la recette : l'ingrédient « ${item.produit} » n'a pas d'unité de référence renseignée.`,
  }
}

/** Réutiliser une ancienne ligne dont l'unité a changé est permis uniquement
 * lorsqu'elle est automatique, sans achat ni transfert, pour le même produit.
 * Le générateur vérifie aussi qu'aucun besoin actuel ne réclame son ancienne clé.
 */
export function canReuseUnpurchasedShoppingItem(
  previous: {
    produit?: string | null; is_manual?: boolean | null; is_checked?: boolean | null;
    qte_achetee?: number | null; stock_stored_quantity?: number | null;
  },
  next: { produit: string },
): boolean {
  const normalize = (value: string | null | undefined) => String(value ?? '').trim()
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
  const purchased = Number(previous.qte_achetee ?? 0)
  const stored = Number(previous.stock_stored_quantity ?? 0)
  return previous.is_manual !== true && previous.is_checked !== true &&
    Number.isFinite(purchased) && purchased === 0 &&
    Number.isFinite(stored) && stored === 0 &&
    normalize(previous.produit) !== '' && normalize(previous.produit) === normalize(next.produit)
}
