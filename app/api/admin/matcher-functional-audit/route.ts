import { NextResponse } from 'next/server'

import { getAuthSession } from '../../../utils/auth-server'
import {
  loadReferenceData,
  resolveIngredientDecision,
  resolveRecipeIngredients,
  aggregateRequirements,
  compareToStock,
  createMatcherTrace,
  resolveStockIngredientId,
  convertStockQuantity,
} from '../../../utils/matcher'

type Status = 'PASS' | 'FAIL' | 'WARNING'

type TestResult = {
  name: string
  status: Status
  expected: string
  actual: string
  details?: string
}

type AuditIssue = {
  severity: 'BLOCKER' | 'WARNING'
  area: string
  message: string
  details?: string
}

function test(
  name: string,
  ok: boolean,
  expected: string,
  actual: string,
  details?: string,
): TestResult {
  return {
    name,
    status: ok ? 'PASS' : 'FAIL',
    expected,
    actual,
    ...(details ? { details } : {}),
  }
}

function warning(
  name: string,
  expected: string,
  actual: string,
  details?: string,
): TestResult {
  return {
    name,
    status: 'WARNING',
    expected,
    actual,
    ...(details ? { details } : {}),
  }
}

function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function closeEnough(a: number, b: number, epsilon = 0.000001): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon
}

function display(value: unknown): string {
  if (value === undefined || value === null) return 'NULL'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function pushResolutionResult(
  results: TestResult[],
  label: string,
  resolved: any,
  expected: any,
) {
  const nameOk = !!resolved?.name && norm(resolved.name) === norm(expected.nom)
  const idOk = resolved?.id === expected.id
  const sourceOk = resolved?.decision?.source === 'exact' || resolved?.decision?.source === 'synonym'
  const aiOk = !resolved?.aiProposed

  results.push(test(
    label,
    nameOk && idOk && sourceOk && aiOk,
    `${expected.nom} / source=exact|synonym / IA=false`,
    `${resolved?.name ?? 'NULL'} / source=${resolved?.decision?.source ?? 'none'} / IA=${resolved?.aiProposed ?? false}`,
    resolved?.decision?.reason,
  ))
}

function getUnitFactor(unit: any): { family: 'weight' | 'volume' | 'piece'; factor: number } | null {
  const type = norm(unit.type_unite)
  const ref = String(unit.equivalence_reference ?? '').trim().replace(',', '.')
  const m = ref.match(/~?\s*([0-9]+(?:\.[0-9]+)?)\s*(g|ml|piece)\b/i)
  if (!m) return null

  const factor = Number(m[1])
  if (!Number.isFinite(factor)) return null

  if (type === 'poids') return { family: 'weight', factor }
  if (type === 'volume') return { family: 'volume', factor }
  if (type === 'unite') return { family: 'piece', factor }
  return null
}

function normalizedUnitKeys(unit: any): string[] {
  return Array.from(new Set([
    norm(unit.unite),
    norm(unit.abreviation),
  ].filter(Boolean)))
}

export async function GET() {
  try {
    const session = await getAuthSession()
    if (!session?.username) {
      return NextResponse.json(
        { ok: false, error: 'Utilisateur non authentifié.' },
        { status: 401 },
      )
    }

    const refData = await loadReferenceData()
    const results: TestResult[] = []
    const issues: AuditIssue[] = []
    const officialByName = new Map(
      refData.officialList.map((item) => [norm(item.nom), item]),
    )

    /* ============================================================
     * A. COUVERTURE EXHAUSTIVE DES INGREDIENTS OFFICIELS
     * ============================================================ */
    for (const ingredient of refData.officialList) {
      const resolved = await resolveIngredientDecision(ingredient.nom, refData)
      pushResolutionResult(
        results,
        `ingrédient officiel - ${ingredient.nom}`,
        resolved,
        ingredient,
      )
    }

    /* ============================================================
     * B. NORMALISATION EXHAUSTIVE
     * ============================================================ */
    for (const ingredient of refData.officialList) {
      const variants = Array.from(new Set([
        ingredient.nom.toUpperCase(),
        `  ${ingredient.nom}  `,
        `\t${ingredient.nom}\t`,
      ]))

      for (const variant of variants) {
        const resolved = await resolveIngredientDecision(variant, refData)
        const ok = resolved?.id === ingredient.id &&
          !resolved?.aiProposed &&
          (resolved?.decision?.source === 'exact' || resolved?.decision?.source === 'synonym')

        results.push(test(
          `normalisation - ${JSON.stringify(variant)}`,
          ok,
          `${ingredient.nom} / même ID / IA=false`,
          `${resolved?.name ?? 'NULL'} / ${resolved?.decision?.source ?? 'none'} / IA=${resolved?.aiProposed ?? false}`,
          resolved?.decision?.reason,
        ))
      }
    }

    /* ============================================================
     * C. SYNONYMES : TOUS + VARIANTES
     * ============================================================ */
    const synonymEntries = Array.from(refData.synonymMap.entries())

    for (const [recipeWord, ingredientId] of synonymEntries) {
      const expected = refData.officialList.find((item) => item.id === ingredientId)
      const resolved = await resolveIngredientDecision(recipeWord, refData)
      const ok = !!expected &&
        resolved?.id === expected.id &&
        resolved?.decision?.source === 'synonym' &&
        !resolved?.aiProposed

      results.push(test(
        `synonyme - ${recipeWord}`,
        ok,
        `${expected?.nom ?? ingredientId} / source=synonym / IA=false`,
        `${resolved?.name ?? 'NULL'} / source=${resolved?.decision?.source ?? 'none'} / IA=${resolved?.aiProposed ?? false}`,
        resolved?.decision?.reason,
      ))

      for (const variant of Array.from(new Set([
        recipeWord.toUpperCase(),
        ` ${recipeWord} `,
        `\t${recipeWord}\t`,
      ]))) {
        const variantResolved = await resolveIngredientDecision(variant, refData)
        const variantOk = variantResolved?.id === ingredientId &&
          variantResolved?.decision?.source === 'synonym' &&
          !variantResolved?.aiProposed

        results.push(test(
          `variante synonyme - ${JSON.stringify(variant)}`,
          variantOk,
          `${ingredientId} / source=synonym / IA=false`,
          `${variantResolved?.id ?? 'NULL'} / source=${variantResolved?.decision?.source ?? 'none'} / IA=${variantResolved?.aiProposed ?? false}`,
          variantResolved?.decision?.reason,
        ))
      }
    }

    /* ============================================================
     * D. MOTS IGNORES : LE VRAI Set UTILISE PAR LE MATCHER
     * ============================================================ */
    const ignoredWords = Array.from(refData.ignoredSet).filter(Boolean)

    for (const word of ignoredWords) {
      const trace = createMatcherTrace(word)
      const resolved = await resolveRecipeIngredients(
        [{ name: word, qty: 1, unit: 'pièce' }],
        refData,
        'functional-audit',
        'Functional audit',
        1,
        trace,
      )

      results.push(test(
        `mot ignoré - "${word}"`,
        resolved.length === 0,
        '0 ingrédient résolu',
        `${resolved.length} ingrédient(s)`,
        trace.events.join(' | '),
      ))
    }

    /* ============================================================
     * E. UNITES : COUVERTURE DES NOMS CANONIQUES ET ALIAS
     *
     * On ne confond jamais une unité canonique avec une autre à cause
     * d'un alias. Les alias normalisés qui désignent plusieurs lignes
     * sont diagnostiqués séparément : ils constituent une ambiguïté de
     * référentiel / résolution et non un faux test de conversion.
     * ============================================================ */
    const unitAliasOwners = new Map<string, any[]>()
    for (const mapping of refData.unitMappings) {
      for (const key of normalizedUnitKeys(mapping)) {
        const list = unitAliasOwners.get(key) ?? []
        list.push(mapping)
        unitAliasOwners.set(key, list)
      }
    }

    const ambiguousAliases = Array.from(unitAliasOwners.entries())
      .filter(([, owners]) => new Set(owners.map((x) => x.unite)).size > 1)

    for (const [alias, owners] of ambiguousAliases) {
      const names = Array.from(new Set(owners.map((x) => x.unite)))
      const message = `Alias normalisé « ${alias} » partagé par : ${names.join(' ; ')}`
      issues.push({
        severity: 'BLOCKER',
        area: 'unit_mappings',
        message,
        details: 'Un même alias peut résoudre plusieurs unités distinctes. Les conversions exhaustives sont donc volontairement exclues pour cet alias afin d’éviter les faux FAIL.',
      })
      results.push(warning(
        `ambiguïté alias unité - ${alias}`,
        'alias unique ou absence d’ambiguïté',
        names.join(' ; '),
        'Diagnostic séparé : ne pas mélanger les deux unités dans les conversions automatiques.',
      ))
    }

    const unitIngredient = 'Sucre roux'
    const unitId = officialByName.get(norm(unitIngredient))?.id

    for (const mapping of refData.unitMappings) {
      const canonical = mapping.unite
      const resolved = await resolveRecipeIngredients(
        [{ name: unitIngredient, qty: 1, unit: canonical }],
        refData,
        'functional-audit',
        'Functional audit',
        1,
      )
      const first = resolved[0]
      const key = norm(canonical)
      const isAmbiguous = (unitAliasOwners.get(key)?.length ?? 0) > 1

      if (isAmbiguous) {
        results.push(warning(
          `unité canonique ambiguë - ${canonical}`,
          'résolution non ambiguë',
          first ? `${first.qte} ${first.unite} / review=${first.needs_review}` : 'Aucun résultat',
          'Un alias normalisé du référentiel entre en collision ; test fonctionnel neutralisé.',
        ))
        continue
      }

      const ok = !!first && first.ingredient_id === unitId && !first.needs_review && Number.isFinite(first.qte)
      results.push(test(
        `unité canonique - ${canonical}`,
        ok,
        'unité reconnue / quantité numérique / needs_review=false',
        first ? `${first.qte} ${first.unite} / needs_review=${first.needs_review}` : 'Aucun résultat',
        mapping.equivalence_reference ?? undefined,
      ))

      const abbreviation = String(mapping.abreviation ?? '').trim()
      if (abbreviation) {
        const abbreviationKey = norm(abbreviation)
        const abbreviationOwners = unitAliasOwners.get(abbreviationKey) ?? []

        if (new Set(abbreviationOwners.map((x) => x.unite)).size > 1) {
          continue
        }

        const aliasResolved = await resolveRecipeIngredients(
          [{ name: unitIngredient, qty: 1, unit: abbreviation }],
          refData,
          'functional-audit',
          'Functional audit',
          1,
        )
        const aliasFirst = aliasResolved[0]
        const aliasOk = !!aliasFirst &&
          aliasFirst.ingredient_id === unitId &&
          !aliasFirst.needs_review &&
          Number.isFinite(aliasFirst.qte)

        results.push(test(
          `alias unité - ${abbreviation}`,
          aliasOk,
          `${canonical} reconnu / quantité numérique / needs_review=false`,
          aliasFirst ? `${aliasFirst.qte} ${aliasFirst.unite} / needs_review=${aliasFirst.needs_review}` : 'Aucun résultat',
          mapping.equivalence_reference ?? undefined,
        ))
      }
    }

    /* ============================================================
     * F. CONVERSIONS EXHAUSTIVES : UNIQUEMENT UNITES NON AMBIGUES
     * ============================================================ */
    // Certaines unités sont volontairement des conventions distinctes et ne
    // doivent pas être converties automatiquement entre elles, même si elles
    // appartiennent à la même famille physique. C'est notamment le cas des
    // deux formulations de "pointe de couteau" : leurs équivalences sont
    // différentes (0,2 mL vs ~1 mL) et une conversion automatique fabriquerait
    // une fausse précision.
    const nonConvertibleCanonicalUnits = new Set([
      norm('Pointe (de couteau)'),
      norm('Pointe de couteau'),
    ])

    const conversionMappings = refData.unitMappings
      .map((u: any) => ({ u, f: getUnitFactor(u) }))
      .filter(({ u, f }) => {
        if (!f || !['weight', 'volume'].includes(f.family)) return false
        const key = norm(u.unite)
        if ((unitAliasOwners.get(key)?.length ?? 0) > 1) return false
        if (nonConvertibleCanonicalUnits.has(key)) return false
        return true
      })

    for (const source of conversionMappings) {
      for (const target of conversionMappings) {
        if (!target.f || target.f.family !== source.f!.family) continue

        const converted = convertStockQuantity(
          refData,
          null,
          1,
          source.u.unite,
          target.u.unite,
        )
        const expected = source.f!.factor / target.f!.factor
        const ok = !!converted && closeEnough(
          converted.qty,
          expected,
          Math.max(0.000001, Math.abs(expected) * 0.000001),
        )

        results.push(test(
          `conversion exhaustive - ${source.u.unite} → ${target.u.unite}`,
          ok,
          String(expected),
          converted ? `${converted.qty} ${converted.unit}` : 'Conversion impossible',
          converted?.reason,
        ))
      }
    }

    /* ============================================================
     * G. DENSITES : CHAQUE LIGNE DU REFERENTIEL
     * ============================================================ */
    for (const density of refData.densities) {
      const ingredient = refData.officialList.find((item) => item.id === density.ingredient_id)
      if (!ingredient) {
        results.push(test(
          `densité - ${density.ingredient_id}/${density.unite}`,
          false,
          'ingrédient référencé',
          'Ingrédient absent',
        ))
        continue
      }

      const converted = convertStockQuantity(
        refData,
        ingredient.id,
        1,
        density.unite,
        'g',
        true,
      )
      const ok = !!converted &&
        Number.isFinite(converted.qty) &&
        converted.qty > 0 &&
        norm(converted.unit) === 'g'

      results.push(test(
        `densité - ${ingredient.nom} / ${density.unite} → g`,
        ok,
        '> 0 g / conversion possible',
        converted ? `${converted.qty} ${converted.unit}` : 'Conversion impossible',
        converted?.reason,
      ))
    }

    /* ============================================================
     * H. RESOLUTION STOCK : 344 EXACTS + 10 SYNONYMES
     * ============================================================ */
    for (const ingredient of refData.officialList) {
      const stockExact = resolveStockIngredientId(refData, ingredient.nom)
      results.push(test(
        `stock exact - ${ingredient.nom}`,
        stockExact === ingredient.id,
        ingredient.id,
        stockExact ?? 'NULL',
      ))
    }

    for (const [recipeWord, ingredientId] of synonymEntries) {
      const stockResolved = resolveStockIngredientId(refData, recipeWord)
      results.push(test(
        `stock synonyme - ${recipeWord}`,
        stockResolved === ingredientId,
        ingredientId,
        stockResolved ?? 'NULL',
      ))
    }

    /* ============================================================
     * I. AGREGATION
     * ============================================================ */
    const aggregationCases = [
      ['Bacon', 100, 50, 'g'],
      ['Sucre roux', 100, 25, 'g'],
      ['Paprika', 2, 3, 'g'],
      ['Huile d\'olive', 10, 5, 'g'],
    ] as const

    for (const [name, q1, q2, unit] of aggregationCases) {
      const ing = officialByName.get(norm(name))
      if (!ing) {
        results.push(test(
          `agrégation - ${name}`,
          false,
          'ingrédient présent dans le référentiel',
          'Ingrédient absent',
        ))
        continue
      }

      const a = await resolveRecipeIngredients(
        [{ name, qty: q1, unit }],
        refData,
        'aggregation-a',
        'Aggregation A',
        1,
      )
      const b = await resolveRecipeIngredients(
        [{ name, qty: q2, unit }],
        refData,
        'aggregation-b',
        'Aggregation B',
        1,
      )
      const agg = aggregateRequirements([a, b])
      const row = agg.find(
        (x) => x.ingredient_id === ing.id && norm(x.unite) === norm(unit),
      )

      results.push(test(
        `agrégation - ${name} ${q1}+${q2} ${unit}`,
        !!row && closeEnough(row.qte, q1 + q2),
        `${q1 + q2} ${unit} / 1 ligne`,
        row ? `${row.qte} ${row.unite} / ${agg.length} ligne(s)` : 'Ligne absente',
      ))
    }

    /* ============================================================
     * J. STOCK VIDE : BESOIN INTEGRAL + ZERO APPEL CLAUDE
     * ============================================================ */
    const emptyStockCases = [
      ['Sucre roux', 250, 'g'],
      ['Farine de blé', 500, 'g'],
      ['Lait', 1, 'L'],
      ['Huile d\'olive', 2, 'cs'],
    ] as const

    for (const [name, qty, unit] of emptyStockCases) {
      const trace = createMatcherTrace(name)
      const resolved = await resolveRecipeIngredients(
        [{ name, qty, unit }],
        refData,
        'empty-stock-audit',
        'Empty stock audit',
        1,
        trace,
      )
      const agg = aggregateRequirements([resolved])
      const compared = await compareToStock(agg, [], refData, trace)
      const row = compared[0]
      const expectedQty = agg[0]?.qte ?? qty
      const ok = !!row &&
        closeEnough(row.qte_a_acheter, expectedQty) &&
        trace.claudeCalls === 0

      results.push(test(
        `stock vide - ${name} ${qty} ${unit}`,
        ok,
        `besoin intégral / Claude=0`,
        row ? `${row.qte_a_acheter} ${row.unite} / Claude=${trace.claudeCalls}` : `Aucun résultat / Claude=${trace.claudeCalls}`,
        trace.events.join(' | '),
      ))
    }

    /* ============================================================
     * K. TRACE DETERMINISTE : TOUS LES INGREDIENTS OFFICIELS
     * ============================================================ */
    let traceFailures = 0

    for (const ingredient of refData.officialList) {
      const trace = createMatcherTrace(ingredient.nom)
      await resolveRecipeIngredients(
        [{ name: ingredient.nom, qty: 1, unit: 'pièce' }],
        refData,
        'trace-audit',
        'Trace audit',
        1,
        trace,
      )

      const ok = trace.ingredientAiCalled === false && trace.claudeCalls === 0
      if (!ok) traceFailures++

      results.push(test(
        `trace déterministe - ${ingredient.nom}`,
        ok,
        'ingredientAiCalled=false / claudeCalls=0',
        `ingredientAiCalled=${trace.ingredientAiCalled} / claudeCalls=${trace.claudeCalls}`,
        trace.events.join(' | '),
      ))
    }

    /* ============================================================
     * L. CAS REALISTES
     *
     * Lait est volontairement testé selon son état de mémoire actuel :
     * si la mémoire IA est en_attente, needs_review=true est attendu.
     * Cela évite de transformer une donnée métier existante en faux FAIL.
     * ============================================================ */
    const realisticCases = [
      { name: 'Sucre roux', qty: 2, unit: 'c.à.s', expectedReview: false },
      { name: 'bacon ge', qty: 150, unit: 'g', expectedReview: false },
      { name: 'ail en poudre', qty: 1, unit: 'cc', expectedReview: false },
      { name: 'Paprika', qty: 3, unit: 'cc', expectedReview: false },
      { name: 'Mayonnaise', qty: 2, unit: 'cs', expectedReview: false },
      { name: 'Huile d\'olive', qty: 2, unit: 'cs', expectedReview: false },
      { name: 'Farine de blé', qty: 250, unit: 'g', expectedReview: false },
      { name: 'Tomates', qty: 3, unit: 'pièce', expectedReview: false },
      { name: 'Pommes de terre', qty: 1, unit: 'kg', expectedReview: false },
    ]

    for (const item of realisticCases) {
      const trace = createMatcherTrace(item.name)
      const resolved = await resolveRecipeIngredients(
        [{ name: item.name, qty: item.qty, unit: item.unit }],
        refData,
        'realistic-audit',
        'Realistic audit',
        1,
        trace,
      )
      const first = resolved[0]
      const ok = !!first &&
        !!first.ingredient_id &&
        first.needs_review === item.expectedReview &&
        trace.claudeCalls === 0

      results.push(test(
        `cas réaliste - ${item.name} ${item.qty} ${item.unit}`,
        ok,
        `ingrédient résolu / review=${item.expectedReview} / Claude=0`,
        first ? `${first.produit ?? item.name} → ${first.qte} ${first.unite} / review=${first.needs_review} / Claude=${trace.claudeCalls}` : `Aucun résultat / Claude=${trace.claudeCalls}`,
        trace.events.join(' | '),
      ))
    }

    const lait = { name: 'Lait', qty: 50, unit: 'cl' }
    const laitTrace = createMatcherTrace(lait.name)
    const laitResolved = await resolveRecipeIngredients(
      [lait],
      refData,
      'realistic-lait-audit',
      'Realistic Lait audit',
      1,
      laitTrace,
    )
    const laitFirst = laitResolved[0]
    const laitMemory = refData.aiResolutionMap.get(norm('Lait'))
    const laitHasPendingMemory = laitMemory?.statut === 'en_attente'
    const laitExpectedReview = laitHasPendingMemory
    const laitExpectedQty = 500
    const laitOk = !!laitFirst &&
      closeEnough(Number(laitFirst.qte), laitExpectedQty) &&
      laitFirst.needs_review === laitExpectedReview &&
      laitTrace.claudeCalls === 0 &&
      (!laitHasPendingMemory || laitTrace.events.some((event) => event.includes('Mémoire IA utilisée')))

    results.push(test(
      'cas réaliste - Lait 50 cl',
      laitOk,
      `Lait → ${laitExpectedQty} mL / review=${laitExpectedReview} / Claude=0`,
      laitFirst ? `${laitFirst.produit ?? 'Lait'} → ${laitFirst.qte} ${laitFirst.unite} / review=${laitFirst.needs_review} / Claude=${laitTrace.claudeCalls}` : `Aucun résultat / Claude=${laitTrace.claudeCalls}`,
      `${laitTrace.events.join(' | ')}${laitMemory ? ` | mémoire=${display(laitMemory)}` : ''}`,
    ))

    /* ============================================================
     * M. CAS LIMITES SANS APPEL IA : PONCTUATION / ESPACES
     * ============================================================ */
    const punctuationCases = [
      ['Sucre roux', 'sucre roux'],
      ['Bacon', '  BACON  '],
      ['Mayonnaise', 'mayonnaise'],
      ['Paprika', ' PAPRIKA '],
      ['Huile d\'olive', 'huile d\'olive'],
    ] as const

    for (const [expectedName, input] of punctuationCases) {
      const expected = officialByName.get(norm(expectedName))
      const trace = createMatcherTrace(input)
      const resolved = await resolveIngredientDecision(input, refData, trace)
      const ok = !!expected &&
        resolved?.id === expected.id &&
        !resolved?.aiProposed &&
        trace.ingredientAiCalled === false &&
        trace.claudeCalls === 0

      results.push(test(
        `cas limite déterministe - ${JSON.stringify(input)}`,
        ok,
        `${expectedName} / IA=false / Claude=0`,
        `${resolved?.name ?? 'NULL'} / IA=${resolved?.aiProposed ?? false} / Claude=${trace.claudeCalls}`,
        trace.events.join(' | '),
      ))
    }

    /* ============================================================
     * N. CONTROLES DE COHERENCE DE L'AUDIT LUI-MEME
     * ============================================================ */
    if (ignoredWords.length === 0) {
      issues.push({
        severity: 'BLOCKER',
        area: 'audit',
        message: 'Le référentiel des mots ignorés est vide dans loadReferenceData().',
        details: 'Le test V2 utilisait par erreur refData.ignoredWords ; le matcher expose réellement refData.ignoredSet.',
      })
    }

    const duplicateOfficial = new Map<string, string[]>()
    for (const item of refData.officialList) {
      const key = norm(item.nom)
      const list = duplicateOfficial.get(key) ?? []
      list.push(item.id)
      duplicateOfficial.set(key, list)
    }
    for (const [key, ids] of duplicateOfficial) {
      if (new Set(ids).size > 1) {
        issues.push({
          severity: 'BLOCKER',
          area: 'official_ingredients',
          message: `Doublon de nom normalisé : ${key}`,
          details: ids.join(' ; '),
        })
      }
    }

    const duplicateSynonyms = new Map<string, string[]>()
    for (const [mot, id] of synonymEntries) {
      const list = duplicateSynonyms.get(norm(mot)) ?? []
      list.push(id)
      duplicateSynonyms.set(norm(mot), list)
    }
    for (const [key, ids] of duplicateSynonyms) {
      if (new Set(ids).size > 1) {
        issues.push({
          severity: 'BLOCKER',
          area: 'ingredient_synonyms',
          message: `Synonyme normalisé ambigu : ${key}`,
          details: ids.join(' ; '),
        })
      }
    }

    /* ============================================================
     * O. SYNTHESE
     * ============================================================ */
    const functionalFails = results.filter((r) => r.status === 'FAIL')
    const warnings = results.filter((r) => r.status === 'WARNING')
    const blockers = issues.filter((i) => i.severity === 'BLOCKER')
    const passCount = results.filter((r) => r.status === 'PASS').length

    const ok = functionalFails.length === 0 && blockers.length === 0

    return NextResponse.json({
      ok,
      status: ok ? 'PASS' : 'FAIL',
      summary: {
        total: results.length,
        pass: passCount,
        fail: functionalFails.length,
        warning: warnings.length,
        blocker: blockers.length,
      },
      coverage: {
        officialIngredients: refData.officialList.length,
        synonyms: synonymEntries.length,
        ignoredWords: ignoredWords.length,
        units: refData.unitMappings.length,
        ambiguousUnitAliases: ambiguousAliases.length,
        densities: refData.densities.length,
        exhaustiveDeterministicTraceTests: refData.officialList.length,
        traceFailures,
      },
      referenceData: {
        officialCount: refData.officialList.length,
        synonymCount: synonymEntries.length,
        unitCount: refData.unitMappings.length,
        densityCount: refData.densities.length,
        aiResolutionCount: refData.aiResolutionMap.size,
      },
      issues,
      results,
      recommendation: ok
        ? 'GO : batterie fonctionnelle élargie réussie. Les ambiguïtés de référentiel sont absentes et les comportements testés sont cohérents. Le matcher peut rester inchangé.'
        : blockers.length > 0 && functionalFails.length === 0
          ? 'STOP : le matcher n’est pas en cause dans les FAIL fonctionnels, mais un ou plusieurs BLOCKER de référentiel/résolution doivent être traités avant de considérer la batterie comme pleinement validée.'
          : 'STOP : au moins un comportement fonctionnel réel ne correspond pas à l’attendu. Ne pas modifier matcher.tsx avant analyse détaillée des FAIL.',
    })
  } catch (error) {
    console.error('[MATCHER FUNCTIONAL AUDIT V3] ERREUR :', error)
    return NextResponse.json({
      ok: false,
      status: 'FAIL',
      error: error instanceof Error
        ? error.message
        : 'Erreur inconnue pendant la batterie fonctionnelle V3 du matcher.',
    }, { status: 500 })
  }
}
