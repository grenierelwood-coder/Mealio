import type { ReferenceData, RecipeIngredient, StockItem } from '../app/utils/matcher'

export const IDS = {
  courgette: 'test-courgette',
  farine: 'test-farine',
  miel: 'test-miel',
  sel: 'test-sel',
  tomate: 'test-tomate',
  poireau: 'test-poireau',
  farineRiz: 'test-farine-riz',
}

const official = [
  { id: IDS.courgette, nom: 'Courgette', categorie: 'Légumes', rayon: 'Fruits & légumes', default_storage: 'frosti', unite_reference: 'Pièce' },
  { id: IDS.farine, nom: 'Farine de blé', categorie: 'Épicerie', rayon: 'Farines', default_storage: 'cellio', unite_reference: 'Gramme' },
  { id: IDS.farineRiz, nom: 'Farine de riz', categorie: 'Épicerie', rayon: 'Farines', default_storage: 'cellio', unite_reference: 'Gramme' },
  { id: IDS.miel, nom: 'Miel', categorie: 'Épicerie sucrée', rayon: 'Petit-déjeuner', default_storage: 'cellio', unite_reference: 'Gramme' },
  { id: IDS.sel, nom: 'Sel fin', categorie: 'Épicerie salée & Condiments', rayon: 'Épices', default_storage: 'cellio', unite_reference: 'Pièce' },
  { id: IDS.tomate, nom: 'Tomate', categorie: 'Légumes', rayon: 'Fruits & légumes', default_storage: 'frosti', unite_reference: 'Pièce' },
  { id: IDS.poireau, nom: 'Poireau', categorie: 'Légumes', rayon: 'Fruits & légumes', default_storage: 'frosti', unite_reference: 'Pièce' },
]

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function makeReferenceData(): ReferenceData {
  const officialList = official
  const officialById = new Map(officialList.map(item => [item.id, item]))

  return {
    ignoredSet: new Set([
      'de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'a', 'au', 'aux',
      'en', 'pour', 'avec', 'sans', 'frais', 'fraiche', 'fraîche', 'haché',
      'hachée', 'hachés', 'hachées', 'beau', 'belles', 'bio',
    ].map(normalized)),
    synonymMap: new Map([
      [normalized('zucchini'), IDS.courgette],
      [normalized('miel liquide'), IDS.miel],
      [normalized('sel'), IDS.sel],
    ]),
    officialList,
    officialById,
    officialPrepared: officialList.map(item => ({
      item,
      normalized: normalized(item.nom),
      tokens: normalized(item.nom).split(' ').filter(Boolean),
    })),
    unitMappings: [
      { unite: 'Gramme', abreviation: 'g', type_unite: 'poids', equivalence_reference: '1 g', multiplicateur: 1 },
      { unite: 'Kilogramme', abreviation: 'kg', type_unite: 'poids', equivalence_reference: '1000 g', multiplicateur: 1000 },
      { unite: 'Millilitre', abreviation: 'mL', type_unite: 'volume', equivalence_reference: '1 mL', multiplicateur: 1 },
      { unite: 'Cuillère à soupe', abreviation: 'cs', type_unite: 'volume', equivalence_reference: '15 mL', multiplicateur: 1 },
      { unite: 'Cuillère à café', abreviation: 'cc', type_unite: 'volume', equivalence_reference: '5 mL', multiplicateur: 1 },
      { unite: 'Pièce', abreviation: 'pce', type_unite: 'unité', equivalence_reference: '1 pièce', multiplicateur: 1 },
    ],
    densities: [
      { ingredient_id: IDS.miel, unite: 'Cuillère à soupe', poids_g_approx: 21 },
      { ingredient_id: IDS.miel, unite: 'Cuillère à café', poids_g_approx: 7 },
    ],
    aiResolutionMap: new Map(),
    aiCache: new Map(),
  }
}

export function recipe(...ingredients: RecipeIngredient[]): RecipeIngredient[] {
  return ingredients
}

export function stock(...items: StockItem[]): StockItem[] {
  return items
}

export function ingredient(name: string, qty: number, unit: string): RecipeIngredient {
  return { name, qty, unit }
}

export function stockItem(id: string, produit: string, qte: number, unite: string, ingredient_id?: string | null): StockItem {
  return { id, produit, qte, unite, ingredient_id }
}
