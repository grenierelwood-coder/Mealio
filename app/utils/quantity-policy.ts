/**
 * Politique métier de gestion des quantités dans Mealio.
 *
 * Certains ingrédients sont uniquement des présences culinaires :
 * on doit savoir qu'une recette en a besoin, mais il n'est pas pertinent
 * de calculer une quantité à acheter ou de convertir des unités.
 *
 * Exemple : poivre, paprika, sel, herbes de Provence, épices séchées.
 */

export type QuantityMode = 'quantity' | 'presence'

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const PRESENCE_ONLY_CATEGORIES = new Set([
  normalize('Épices & Herbes séchées'),
])

// Condiments/assaisonnements qui peuvent être rangés dans une catégorie
// plus large « Épicerie salée & Condiments ».
const PRESENCE_ONLY_NAMES = new Set([
  'sel',
  'sel fin',
  'gros sel',
  'fleur de sel',
  'poivre',
  'poivre noir',
  'poivre blanc',
  'poivre vert',
  'paprika',
  "piment d'espelette",
  'piment',
  'piment de cayenne',
  'curry',
  'curcuma',
  'cumin',
  'muscade',
  'noix de muscade',
  'cannelle',
  'clou de girofle',
  'gingembre moulu',
  'coriandre moulue',
  'cardamome',
  'fenouil en graines',
  'graines de cumin',
  'graines de coriandre',
  'herbes de provence',
  'origan seche',
  'origan séché',
  'basilic séché',
  'thym séché',
  'romarin séché',
  'laurier séché',
  'ail en poudre',
  'oignon en poudre',
  'moutarde',
  'moutarde de dijon',
  'sauce soja',
  'sriracha',
  'sauce sriracha',
])

const PRESENCE_ONLY_KEYWORDS = [
  'poivre',
  'paprika',
  'piment',
  'curry',
  'curcuma',
  'cumin',
  'muscade',
  'cannelle',
  'clou de girofle',
  'cardamome',
  'herbes de provence',
  'sel ',
  ' sel',
  'moutarde',
  'sriracha',
]

export function isPresenceOnlyIngredient(input: {
  nom?: string | null
  categorie?: string | null
}): boolean {
  const name = normalize(input.nom)
  const category = normalize(input.categorie)

  if (PRESENCE_ONLY_CATEGORIES.has(category)) return true
  if (PRESENCE_ONLY_NAMES.has(name)) return true

  // Sécurité volontairement limitée aux assaisonnements évidents.
  // On ne classe pas toute l'Épicerie salée en « présence ».
  return PRESENCE_ONLY_KEYWORDS.some(keyword => name.includes(keyword))
}

export function getQuantityMode(input: {
  nom?: string | null
  categorie?: string | null
}): QuantityMode {
  return isPresenceOnlyIngredient(input) ? 'presence' : 'quantity'
}

export function quantityDisplayLabel(mode: QuantityMode): string {
  return mode === 'presence' ? 'Présence' : 'Quantité'
}


/**
 * Densité autorisée uniquement pour les ingrédients gérés en quantité.
 * Cette règle est générique : aucun ingrédient `presence-only` ne peut
 * utiliser ou recréer une densité, quelle que soit sa catégorie ou son nom.
 */
export function assertDensityAllowed(input: { nom?: string | null; categorie?: string | null }): void {
  if (getQuantityMode(input) === 'presence') {
    throw new Error(`Les ingrédients en mode « Présence » ne peuvent pas avoir de densité.`)
  }
}

export function isDensityAllowed(input: { nom?: string | null; categorie?: string | null }): boolean {
  return getQuantityMode(input) === 'quantity'
}
