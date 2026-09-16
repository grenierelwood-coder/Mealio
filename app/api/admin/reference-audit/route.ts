import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type Status = 'PASS' | 'FAIL' | 'WARNING'

type AuditTest = {
  name: string
  status: Status
  expected: string
  actual: string
  details?: string
}

function result(
  name: string,
  status: Status,
  expected: string,
  actual: string,
  details?: string,
): AuditTest {
  return {
    name,
    status,
    expected,
    actual,
    ...(details ? { details } : {}),
  }
}

/**
 * Normalisation utilisée pour les comparaisons sémantiques.
 */
function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Normalisation légère utilisée pour détecter les vrais doublons
 * dans les colonnes qui sont censées être uniques.
 *
 * Important :
 * on NE supprime PAS les accents ici.
 *
 * Ainsi :
 *   "a" !== "à"
 *
 * ce qui correspond à deux valeurs distinctes de la table.
 */
function normalizeExact(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export async function GET() {
  try {
    /*
     * ============================================================
     * CONFIGURATION MEALIO
     * ============================================================
     */

    const supabaseUrl = process.env.NEXT_PUBLIC_MEALIO_URL
    const serviceRoleKey = process.env.MEALIO_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          status: 'FAIL',
          error:
            'Variables NEXT_PUBLIC_MEALIO_URL ou MEALIO_SERVICE_ROLE_KEY manquantes.',
        },
        { status: 500 },
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const tests: AuditTest[] = []

    /*
     * ============================================================
     * 1. OFFICIAL INGREDIENTS
     * ============================================================
     */

    const { data: officialIngredients, error: officialError } =
      await supabase
        .from('official_ingredients')
        .select(
          'id, categorie, nom, rayon, default_storage, default_is_fridge, unite_reference',
        )

    if (officialError) {
      throw new Error(
        `Lecture official_ingredients impossible : ${officialError.message}`,
      )
    }

    const ingredients = officialIngredients ?? []

    tests.push(
      result(
        'official_ingredients - nombre',
        ingredients.length === 344 ? 'PASS' : 'FAIL',
        '344',
        String(ingredients.length),
      ),
    )

    const emptyIngredientNames = ingredients.filter(
      (item) => !String(item.nom ?? '').trim(),
    )

    tests.push(
      result(
        'official_ingredients - noms',
        emptyIngredientNames.length === 0 ? 'PASS' : 'FAIL',
        '0 nom vide',
        String(emptyIngredientNames.length),
      ),
    )

    const invalidStorage = ingredients.filter(
      (item) =>
        item.default_storage !== null &&
        item.default_storage !== 'frosti' &&
        item.default_storage !== 'cellio',
    )

    tests.push(
      result(
        'official_ingredients - default_storage',
        invalidStorage.length === 0 ? 'PASS' : 'FAIL',
        'uniquement frosti / cellio / NULL',
        String(invalidStorage.length),
      ),
    )

    const missingRayon = ingredients.filter(
      (item) => !String(item.rayon ?? '').trim(),
    )

    tests.push(
      result(
        'official_ingredients - rayon',
        missingRayon.length === 0 ? 'PASS' : 'FAIL',
        '0 rayon manquant',
        String(missingRayon.length),
      ),
    )

    const missingReferenceUnits = ingredients.filter(
      (item) => !String(item.unite_reference ?? '').trim(),
    )


    tests.push(
      result(
        'official_ingredients - unite_reference',
        missingReferenceUnits.length === 0 ? 'PASS' : 'FAIL',
        '0 unité de référence manquante',
        String(missingReferenceUnits.length),
      ),
    )

    /*
     * Les noms officiels doivent être uniques.
     *
     * Pour ce contrôle structurel, on ne retire pas les accents :
     * "a" et "à" sont donc bien différents.
     */
    const ingredientNameMap = new Map<string, string[]>()

    for (const item of ingredients) {
      const key = normalizeExact(item.nom)

      if (!ingredientNameMap.has(key)) {
        ingredientNameMap.set(key, [])
      }

      ingredientNameMap.get(key)!.push(item.nom)
    }

    const duplicateIngredientNames = [...ingredientNameMap.entries()].filter(
      ([, names]) => names.length > 1,
    )

    tests.push(
      result(
        'official_ingredients - doublons',
        duplicateIngredientNames.length === 0 ? 'PASS' : 'FAIL',
        '0 doublon',
        String(duplicateIngredientNames.length),
      ),
    )

    const invalidFridgeValues = ingredients.filter(
      (item) =>
        item.default_is_fridge !== null &&
        typeof item.default_is_fridge !== 'boolean',
    )

    tests.push(
      result(
        'official_ingredients - default_is_fridge',
        invalidFridgeValues.length === 0 ? 'PASS' : 'FAIL',
        'boolean ou NULL',
        String(invalidFridgeValues.length),
      ),
    )

    /*
     * ============================================================
     * 2. UNIT MAPPINGS
     * ============================================================
     */

    const { data: unitMappings, error: unitError } = await supabase
      .from('unit_mappings')
      .select(
        'unite, abreviation, type_unite, equivalence_reference, multiplicateur',
      )

    if (unitError) {
      throw new Error(
        `Lecture unit_mappings impossible : ${unitError.message}`,
      )
    }

    const units = unitMappings ?? []

    tests.push(
      result(
        'unit_mappings - nombre',
        units.length === 41 ? 'PASS' : 'FAIL',
        '41',
        String(units.length),
      ),
    )

    const emptyUnits = units.filter(
      (item) => !String(item.unite ?? '').trim(),
    )

    tests.push(
      result(
        'unit_mappings - noms',
        emptyUnits.length === 0 ? 'PASS' : 'FAIL',
        '0 unité vide',
        String(emptyUnits.length),
      ),
    )

    /*
     * Même principe : on contrôle les vrais doublons de "unite".
     */
    const unitNameMap = new Map<string, number>()

    for (const item of units) {
      const key = normalizeExact(item.unite)
      unitNameMap.set(key, (unitNameMap.get(key) ?? 0) + 1)
    }

    const duplicateUnits = [...unitNameMap.entries()].filter(
      ([, count]) => count > 1,
    )

    tests.push(
      result(
        'unit_mappings - doublons',
        duplicateUnits.length === 0 ? 'PASS' : 'FAIL',
        '0 doublon',
        String(duplicateUnits.length),
      ),
    )

    const invalidMultipliers = units.filter(
      (item) =>
        typeof item.multiplicateur !== 'number' ||
        !Number.isFinite(item.multiplicateur) ||
        item.multiplicateur <= 0,
    )

    tests.push(
      result(
        'unit_mappings - multiplicateur',
        invalidMultipliers.length === 0 ? 'PASS' : 'FAIL',
        'tous > 0',
        String(invalidMultipliers.length),
      ),
    )

    /*
     * Les noms canoniques sont dans "unite".
     * Les formes courtes sont dans "abreviation".
     */
    const essentialUnits = [
      { unite: 'Gramme', abreviation: 'g' },
      { unite: 'Kilogramme', abreviation: 'kg' },
      { unite: 'Milligramme', abreviation: 'mg' },
      { unite: 'Millilitre', abreviation: 'mL' },
      { unite: 'Centilitre', abreviation: 'cL' },
      { unite: 'Décilitre', abreviation: 'dL' },
      { unite: 'Litre', abreviation: 'L' },
      { unite: 'Cuillère à café', abreviation: 'cc' },
      { unite: 'Cuillère à soupe', abreviation: 'cs' },
      { unite: 'Pièce', abreviation: 'pièce' },
      { unite: 'Pincée', abreviation: null },
    ]

    const missingEssentialUnits = essentialUnits.filter(
      (expectedUnit) => {
        const found = units.find(
          (unit) =>
            normalize(unit.unite) === normalize(expectedUnit.unite),
        )

        if (!found) {
          return true
        }

        if (expectedUnit.abreviation === null) {
          return false
        }

        return (
          normalize(found.abreviation) !==
          normalize(expectedUnit.abreviation)
        )
      },
    )

    tests.push(
      result(
        'unit_mappings - unités essentielles',
        missingEssentialUnits.length === 0 ? 'PASS' : 'FAIL',
        `${essentialUnits.length} unités essentielles correctement définies`,
        missingEssentialUnits.length === 0
          ? 'Toutes présentes avec leurs abréviations attendues'
          : missingEssentialUnits.map((u) => u.unite).join(', '),
      ),
    )

    /*
     * ============================================================
     * CONVERSIONS DE REFERENCE
     * ============================================================
     *
     * IMPORTANT :
     *
     * Dans ta base, equivalence_reference contient une valeur
     * de référence telle que :
     *
     *   "0.001 g"
     *   "1000 g"
     *   "10 mL"
     *   "15 mL"
     *   "250 mL"
     *
     * et multiplicateur vaut 1.
     *
     * Mon précédent audit attendait à tort :
     *
     *   equivalence_reference = "Gramme"
     *   multiplicateur = 0.001
     *
     * Ce n'est PAS le modèle réel de ta table.
     *
     * On vérifie donc maintenant la structure réellement utilisée
     * par Mealio.
     */

    const conversionExpectations = [
      {
        unite: 'Milligramme',
        expectedReference: '0.001 g',
        expectedMultiplier: 1,
      },
      {
        unite: 'Kilogramme',
        expectedReference: '1000 g',
        expectedMultiplier: 1,
      },
      {
        unite: 'Centilitre',
        expectedReference: '10 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Décilitre',
        expectedReference: '100 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Litre',
        expectedReference: '1000 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Cuillère à café',
        expectedReference: '5 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Cuillère à soupe',
        expectedReference: '15 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Cuillère à dessert',
        expectedReference: '10 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Tasse',
        expectedReference: '250 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Verre',
        expectedReference: '200 mL',
        expectedMultiplier: 1,
      },
      {
        unite: 'Pièce',
        expectedReference: '1 pièce',
        expectedMultiplier: 1,
      },
    ]

    const conversionProblems: string[] = []

    for (const expected of conversionExpectations) {
      const found = units.find(
        (unit) => normalize(unit.unite) === normalize(expected.unite),
      )

      if (!found) {
        conversionProblems.push(`${expected.unite}: absente`)
        continue
      }

      const actualReference = String(
        found.equivalence_reference ?? '',
      ).trim()

      const referenceOk =
        normalize(actualReference) ===
        normalize(expected.expectedReference)

      const multiplierOk =
        typeof found.multiplicateur === 'number' &&
        Math.abs(found.multiplicateur - expected.expectedMultiplier) <
          0.000001

      if (!referenceOk || !multiplierOk) {
        conversionProblems.push(
          `${expected.unite}: attendu ${expected.expectedReference} × ${expected.expectedMultiplier}, obtenu ${actualReference} × ${found.multiplicateur}`,
        )
      }
    }

    tests.push(
      result(
        'unit_mappings - conversions de référence',
        conversionProblems.length === 0 ? 'PASS' : 'FAIL',
        'conversions essentielles correctes',
        conversionProblems.length === 0
          ? 'Toutes les conversions sont correctes'
          : conversionProblems.join(' | '),
      ),
    )

    const validUnitTypes = new Set(['poids', 'volume', 'divers'])

    const invalidUnitTypes = units.filter(
      (item) => !validUnitTypes.has(String(item.type_unite ?? '')),
    )

    tests.push(
      result(
        'unit_mappings - type_unite',
        invalidUnitTypes.length === 0 ? 'PASS' : 'FAIL',
        'poids / volume / divers',
        String(invalidUnitTypes.length),
      ),
    )

    /*
     * ============================================================
     * 3. IGNORED WORDS
     * ============================================================
     */

    const { data: ignoredWords, error: ignoredError } = await supabase
      .from('ignored_words')
      .select('mot, type_ignore')

    if (ignoredError) {
      throw new Error(
        `Lecture ignored_words impossible : ${ignoredError.message}`,
      )
    }

    const ignored = ignoredWords ?? []

    tests.push(
      result(
        'ignored_words - nombre',
        ignored.length === 21 ? 'PASS' : 'FAIL',
        '21',
        String(ignored.length),
      ),
    )

    const emptyIgnoredWords = ignored.filter(
      (item) => !String(item.mot ?? '').trim(),
    )

    tests.push(
      result(
        'ignored_words - mots vides',
        emptyIgnoredWords.length === 0 ? 'PASS' : 'FAIL',
        '0',
        String(emptyIgnoredWords.length),
      ),
    )

    /*
     * IMPORTANT :
     * on ne retire PAS les accents pour ce contrôle.
     *
     * "a" et "à" sont deux valeurs distinctes dans la table.
     */
    const ignoredMap = new Map<string, number>()

    for (const item of ignored) {
      const key = normalizeExact(item.mot)
      ignoredMap.set(key, (ignoredMap.get(key) ?? 0) + 1)
    }

    const duplicateIgnoredWords = [...ignoredMap.entries()].filter(
      ([, count]) => count > 1,
    )

    tests.push(
      result(
        'ignored_words - doublons',
        duplicateIgnoredWords.length === 0 ? 'PASS' : 'FAIL',
        '0',
        String(duplicateIgnoredWords.length),
      ),
    )

    const invalidIgnoreTypes = ignored.filter(
      (item) =>
        item.type_ignore !== null &&
        typeof item.type_ignore !== 'string',
    )

    tests.push(
      result(
        'ignored_words - type_ignore',
        invalidIgnoreTypes.length === 0 ? 'PASS' : 'FAIL',
        'texte ou NULL',
        String(invalidIgnoreTypes.length),
      ),
    )

    /*
     * ============================================================
     * 4. INGREDIENT SYNONYMS
     * ============================================================
     */

    const { data: synonyms, error: synonymError } = await supabase
      .from('ingredient_synonyms')
      .select('mot_recette, ingredient_id')

    if (synonymError) {
      throw new Error(
        `Lecture ingredient_synonyms impossible : ${synonymError.message}`,
      )
    }

    const synonymRows = synonyms ?? []

    tests.push(
      result(
        'ingredient_synonyms - nombre',
        synonymRows.length === 10 ? 'PASS' : 'FAIL',
        '10',
        String(synonymRows.length),
      ),
    )

    const officialIds = new Set(ingredients.map((item) => item.id))

    const orphanSynonyms = synonymRows.filter(
      (item) => !officialIds.has(item.ingredient_id),
    )

    tests.push(
      result(
        'ingredient_synonyms - FK',
        orphanSynonyms.length === 0 ? 'PASS' : 'FAIL',
        '0 référence orpheline',
        String(orphanSynonyms.length),
      ),
    )

    const synonymMap = new Map<string, number>()

    for (const item of synonymRows) {
      const key = normalizeExact(item.mot_recette)
      synonymMap.set(key, (synonymMap.get(key) ?? 0) + 1)
    }

    const duplicateSynonyms = [...synonymMap.entries()].filter(
      ([, count]) => count > 1,
    )

    tests.push(
      result(
        'ingredient_synonyms - doublons',
        duplicateSynonyms.length === 0 ? 'PASS' : 'FAIL',
        '0 doublon',
        String(duplicateSynonyms.length),
      ),
    )

    /*
     * "bacon ge" a été vérifié manuellement :
     * il pointe bien vers l'ingrédient officiel "Bacon".
     */
    const baconGe = synonymRows.filter(
      (item) => normalize(item.mot_recette) === 'bacon ge',
    )

    const baconOfficial = ingredients.find(
      (item) => normalize(item.nom) === 'bacon',
    )

    const baconGeValid =
      baconGe.length === 1 &&
      !!baconOfficial &&
      baconGe[0].ingredient_id === baconOfficial.id

    tests.push(
      result(
        'ingredient_synonyms - bacon ge',
        baconGeValid ? 'PASS' : 'FAIL',
        'bacon ge → Bacon',
        baconGeValid
          ? 'bacon ge → Bacon'
          : baconGe.length === 0
            ? 'Correspondance absente'
            : `ingredient_id = ${baconGe[0].ingredient_id}`,
        baconGeValid
          ? 'Correspondance vérifiée dans official_ingredients.'
          : 'La correspondance attendue n’est pas respectée.',
      ),
    )

    /*
     * Vérifie qu'un synonyme ne correspond pas au nom officiel
     * d'un autre ingrédient.
     */
    const officialNameToId = new Map<string, string>()

    for (const ingredient of ingredients) {
      officialNameToId.set(normalize(ingredient.nom), ingredient.id)
    }

    const synonymConflicts = synonymRows.filter((synonym) => {
      const officialId = officialNameToId.get(
        normalize(synonym.mot_recette),
      )

      return officialId && officialId !== synonym.ingredient_id
    })

    tests.push(
      result(
        'ingredient_synonyms - conflits avec officiel',
        synonymConflicts.length === 0 ? 'PASS' : 'FAIL',
        '0 conflit',
        String(synonymConflicts.length),
        synonymConflicts.length > 0
          ? synonymConflicts.map((item) => item.mot_recette).join(', ')
          : undefined,
      ),
    )

    /*
     * ============================================================
     * 5. INGREDIENT DENSITIES
     * ============================================================
     */

    const { data: densities, error: densityError } = await supabase
      .from('ingredient_densities')
      .select('ingredient_id, unite, poids_g_approx')

    if (densityError) {
      throw new Error(
        `Lecture ingredient_densities impossible : ${densityError.message}`,
      )
    }

    const densityRows = densities ?? []

    tests.push(
      result(
        'ingredient_densities - nombre',
        densityRows.length === 29 ? 'PASS' : 'FAIL',
        '29',
        String(densityRows.length),
      ),
    )

    const orphanDensityIngredients = densityRows.filter(
      (item) => !officialIds.has(item.ingredient_id),
    )

    tests.push(
      result(
        'ingredient_densities - FK ingredient',
        orphanDensityIngredients.length === 0 ? 'PASS' : 'FAIL',
        '0 référence orpheline',
        String(orphanDensityIngredients.length),
      ),
    )

    const unitNames = new Set(
      units.map((item) => normalize(item.unite)),
    )

    const orphanDensityUnits = densityRows.filter(
      (item) => !unitNames.has(normalize(item.unite)),
    )

    tests.push(
      result(
        'ingredient_densities - FK unité',
        orphanDensityUnits.length === 0 ? 'PASS' : 'FAIL',
        '0 unité inconnue',
        String(orphanDensityUnits.length),
      ),
    )

    const invalidDensityWeights = densityRows.filter(
      (item) =>
        typeof item.poids_g_approx !== 'number' ||
        !Number.isFinite(item.poids_g_approx) ||
        item.poids_g_approx <= 0,
    )

    tests.push(
      result(
        'ingredient_densities - poids',
        invalidDensityWeights.length === 0 ? 'PASS' : 'FAIL',
        'tous > 0',
        String(invalidDensityWeights.length),
      ),
    )

    const densityKeyMap = new Map<string, number>()

    for (const item of densityRows) {
      const key = `${item.ingredient_id}::${normalizeExact(item.unite)}`
      densityKeyMap.set(key, (densityKeyMap.get(key) ?? 0) + 1)
    }

    const duplicateDensities = [...densityKeyMap.entries()].filter(
      ([, count]) => count > 1,
    )

    tests.push(
      result(
        'ingredient_densities - doublons',
        duplicateDensities.length === 0 ? 'PASS' : 'FAIL',
        '0 doublon ingredient + unité',
        String(duplicateDensities.length),
      ),
    )

    /*
     * ============================================================
     * 6. RESULTAT GLOBAL
     * ============================================================
     */

    const failCount = tests.filter(
      (test) => test.status === 'FAIL',
    ).length

    const warningCount = tests.filter(
      (test) => test.status === 'WARNING',
    ).length

    const passCount = tests.filter(
      (test) => test.status === 'PASS',
    ).length

    const status: Status =
      failCount > 0
        ? 'FAIL'
        : warningCount > 0
          ? 'WARNING'
          : 'PASS'

    const recommendation =
      status === 'PASS'
        ? 'GO : référentiels cohérents et prêts pour les tests fonctionnels du matcher.'
        : status === 'WARNING'
          ? 'GO CONDITIONNEL : examiner les warnings avant le matcher.'
          : 'STOP : corriger les erreurs de référentiel avant de poursuivre.'

    return NextResponse.json({
      status,
      summary: {
        total: tests.length,
        pass: passCount,
        fail: failCount,
        warning: warningCount,
      },
      tables: {
        official_ingredients: ingredients.length,
        unit_mappings: units.length,
        ignored_words: ignored.length,
        ingredient_synonyms: synonymRows.length,
        ingredient_densities: densityRows.length,
      },
      tests,
      recommendation,
    })
  } catch (error) {
    console.error('[reference-audit]', error)

    return NextResponse.json(
      {
        status: 'FAIL',
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue pendant l’audit.',
      },
      { status: 500 },
    )
  }
}