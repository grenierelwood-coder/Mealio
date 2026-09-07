'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

/* ============================================================================
   TYPES
   ============================================================================ */

type StockLine = {
  id: string
  produit: string
  qte: number
  unite: string
  source?: string | null
}

type StockGroup = {
  key: string
  produit: string
  lignes: StockLine[]
  sources: string[]
  unites: string[]
}

type StockSummary = {
  username?: string
  totalLines: number
  frostiLines: number
  cellioLines: number
  distinctProducts: number
  duplicateProductGroups: number
  duplicateLineCount: number
  diagnostics: {
    duplicates: StockGroup[]
    groups: StockGroup[]
  }
  items: StockLine[]
}

type TraceStage = {
  source?: string | null
  raw?: string
  normalized?: string
  memoryHit?: boolean
  aiCalled?: boolean
  aiConfidence?: number | null
}

type MatcherTrace = {
  ingredient?: TraceStage
  stock?: TraceStage
  claudeCalls?: number
  events?: string[]
  [key: string]: unknown
}

type ResolvedItem = {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  needs_review: boolean
  source_recipe_id?: string
  source_recipe_nom?: string
  [key: string]: unknown
}

type ComparedItem = {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  qte_stock: number
  unite_stock?: string
  qte_a_acheter: number
  ai_status: 'green' | 'orange' | 'red' | string
  needs_review: boolean
  stock_details?: Array<{
    produit: string
    qte_stock: number
    unite_stock: string
    qte_convertie?: number | null
    unite_comparee?: string
    conversion?: string
    source?: string | null
    [key: string]: unknown
  }>
  [key: string]: unknown
}

type LabResult = {
  ok: boolean
  mode?: string
  input?: {
    name: string
    qty: number
    unit: string
    recipeName?: string
  }
  resolved?: ResolvedItem[]
  aggregated?: ResolvedItem[]
  compared?: ComparedItem[]
  stock?: StockSummary
  trace?: MatcherTrace
  diagnostics?: Record<string, number>
  error?: string
}

/* ============================================================================
   EXEMPLES
   ============================================================================ */

const EXAMPLES = [
  { name: 'tomate', qty: 100, unit: 'g' },
  { name: 'abricot', qty: 300, unit: 'g' },
  { name: 'framboise', qty: 300, unit: 'g' },
  { name: 'haricot vert', qty: 500, unit: 'g' },
  { name: 'fraise', qty: 500, unit: 'g' },
  { name: 'steak haché', qty: 2, unit: 'pièce' },
]

/* ============================================================================
   HELPERS
   ============================================================================ */

function pretty(value: unknown) {
  if (value == null) return '—'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(2)
  }

  return String(value)
}

function sourceLabel(source?: string | null) {
  switch (source) {
    case 'memory':
      return '🧠 Mémoire'
    case 'exact':
      return '🎯 Exact'
    case 'lexical':
    case 'text':
      return '🔤 Lexical'
    case 'ai':
      return '🤖 Claude'
    case 'official':
      return '📚 Référentiel'
    case 'frosti':
      return '❄️ Frosti'
    case 'cellio':
      return '🧊 Cellio'
    default:
      return source || '—'
  }
}

function sourceOfLine(line: StockLine) {
  if (line.source) return line.source

  const text = `${line.id} ${line.produit}`.toLowerCase()

  if (text.includes('frosti')) return 'Frosti'
  if (text.includes('cellio')) return 'Cellio'

  return '—'
}

/* ============================================================================
   PAGE
   ============================================================================ */

export default function MatcherPage() {
  const [name, setName] = useState('tomate')
  const [qty, setQty] = useState('100')
  const [unit, setUnit] = useState('g')

  const [loading, setLoading] = useState(false)
  const [inventoryLoading, setInventoryLoading] = useState(true)

  const [result, setResult] = useState<LabResult | null>(null)
  const [inventory, setInventory] = useState<LabResult | null>(null)

  const [filter, setFilter] = useState('')
  const [showRawJson, setShowRawJson] = useState(false)

  /* --------------------------------------------------------------------------
     INVENTAIRE RÉEL
     -------------------------------------------------------------------------- */

  async function loadInventory() {
    setInventoryLoading(true)

    try {
      const response = await fetch('/api/matcher/lab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'inventory',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error || 'Impossible de charger le stock réel.'
        )
      }

      setInventory(data)
    } catch (error) {
      setInventory({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue lors du chargement du stock.',
      })
    } finally {
      setInventoryLoading(false)
    }
  }

  /* --------------------------------------------------------------------------
     TEST MATCHER
     -------------------------------------------------------------------------- */

  async function runTest() {
    setLoading(true)
    setResult(null)

    try {
      const numericQty = Number(qty)

      const response = await fetch('/api/matcher/lab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          qty: numericQty,
          unit: unit.trim(),
          recipeName: 'Laboratoire Matcher V3.5',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error || 'Erreur du laboratoire Matcher.'
        )
      }

      setResult(data)
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inattendue.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInventory()
  }, [])

  /* --------------------------------------------------------------------------
     STOCK AFFICHÉ
     -------------------------------------------------------------------------- */

  const stock = result?.stock ?? inventory?.stock

  const filteredGroups = useMemo(() => {
    const groups = stock?.diagnostics?.groups ?? []
    const needle = filter.trim().toLowerCase()

    if (!needle) return groups

    return groups.filter(group =>
      group.produit.toLowerCase().includes(needle) ||
      group.key.toLowerCase().includes(needle) ||
      group.sources.some(source =>
        source.toLowerCase().includes(needle)
      )
    )
  }, [stock, filter])

  const trace = result?.trace

  const claudeCalls =
    typeof trace?.claudeCalls === 'number'
      ? trace.claudeCalls
      : typeof result?.diagnostics?.claudeCalls === 'number'
        ? result.diagnostics.claudeCalls
        : 0

  const ingredientSource =
    trace?.ingredient?.source

  const stockSource =
    trace?.stock?.source

  const ingredientMemory =
    trace?.ingredient?.memoryHit === true

  const stockMemory =
    trace?.stock?.memoryHit === true

  const ingredientAiCalled =
    trace?.ingredient?.aiCalled === true

  const stockAiCalled =
    trace?.stock?.aiCalled === true

  /* ==========================================================================
     RENDER
     ========================================================================== */

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">

      {/* =====================================================================
          HEADER
          ===================================================================== */}



      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8">

        {/* ===================================================================
            INTRODUCTION
            =================================================================== */}

        <header>
          <div className="text-sm font-bold uppercase tracking-widest text-amber-600">
            Back-office de test
          </div>

          <h1 className="mt-1 text-3xl font-black">
            🧠 Laboratoire du Matcher V3.5
          </h1>

          <p className="mt-2 max-w-5xl text-slate-600">
            Le laboratoire teste le moteur côté serveur sur le stock réel
            Frosti + Cellio. Il permet de contrôler la résolution de
            l’ingrédient, les synonymes, le référentiel officiel, la mémoire,
            le fallback Claude, les conversions, l’agrégation des lignes
            de stock et la quantité réellement disponible avant achat.
          </p>
        </header>


        {/* ===================================================================
            MÉTRIQUES STOCK
            =================================================================== */}

        <section className="grid gap-4 md:grid-cols-4">

          <Metric
            label="Lignes stock"
            value={stock?.totalLines ?? '…'}
          />

          <Metric
            label="Frosti"
            value={stock?.frostiLines ?? '…'}
          />

          <Metric
            label="Cellio"
            value={stock?.cellioLines ?? '…'}
          />

          <Metric
            label="Produits distincts"
            value={stock?.distinctProducts ?? '…'}
          />

        </section>


        {/* ===================================================================
            DOUBLONS
            =================================================================== */}

        {stock && stock.duplicateProductGroups > 0 && (

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">

            <div className="font-semibold text-amber-900">
              ⚠️ Doublons de lignes détectés
            </div>

            <p className="mt-1 text-sm text-amber-800">
              {stock.duplicateProductGroups} produit(s) sont présents
              sur plusieurs lignes, soit {stock.duplicateLineCount}
              {' '}lignes concernées. Le Matcher conserve les lignes
              individuelles et les additionne lorsqu’elles correspondent
              au même produit.
            </p>

            <div className="mt-3 grid gap-2 md:grid-cols-3">

              {stock.diagnostics.duplicates
                .slice(0, 9)
                .map(group => (

                  <div
                    key={group.key}
                    className="rounded-xl bg-white p-3 text-sm shadow-sm"
                  >
                    <div className="font-semibold">
                      {group.produit}
                    </div>

                    <div className="text-slate-500">
                      {group.lignes.length} lignes ·{' '}
                      {group.sources.join(' + ') ||
                        'source inconnue'}
                    </div>
                  </div>

                ))}

            </div>

          </section>

        )}


        {/* ===================================================================
            ZONE PRINCIPALE
            =================================================================== */}

        <section className="grid gap-6 lg:grid-cols-[420px_1fr]">

          {/* -----------------------------------------------------------------
              FORMULAIRE
              ----------------------------------------------------------------- */}

          <article className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">

            <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">
              Test unitaire
            </div>

            <h2 className="mt-1 text-xl font-black">
              Tester un ingrédient
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Le test est exécuté par le backend du laboratoire et utilise
              le stock Frosti + Cellio réel.
            </p>

            <div className="mt-5 space-y-4">

              <label className="block text-sm font-medium">
                Ingrédient brut

                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      runTest()
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                  placeholder="ex. tomate"
                />
              </label>


              <div className="grid grid-cols-2 gap-3">

                <label className="block text-sm font-medium">
                  Quantité

                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                  />
                </label>


                <label className="block text-sm font-medium">
                  Unité

                  <input
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        runTest()
                      }
                    }}
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                    placeholder="g, kg, pièce..."
                  />
                </label>

              </div>


              <button
                type="button"
                onClick={runTest}
                disabled={
                  loading ||
                  !name.trim() ||
                  !unit.trim() ||
                  !Number.isFinite(Number(qty)) ||
                  Number(qty) <= 0
                }
                className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {loading
                  ? 'Analyse en cours…'
                  : 'Lancer le test'}
              </button>

            </div>


            {/* TESTS RAPIDES */}

            <div className="mt-6 border-t border-stone-100 pt-5">

              <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Tests rapides basés sur le stock réel
              </div>

              <div className="mt-3 flex flex-wrap gap-2">

                {EXAMPLES.map(example => (

                  <button
                    key={example.name}
                    type="button"
                    onClick={() => {
                      setName(example.name)
                      setQty(String(example.qty))
                      setUnit(example.unit)
                    }}
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-xs hover:bg-stone-50"
                  >
                    {example.name}
                  </button>

                ))}

              </div>

            </div>

          </article>


          {/* -----------------------------------------------------------------
              RÉSULTAT
              ----------------------------------------------------------------- */}

          <article className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">

            <div className="flex flex-wrap items-start justify-between gap-3">

              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">
                  Analyse
                </div>

                <h2 className="mt-1 text-xl font-black">
                  Résultat du rapprochement
                </h2>
              </div>

              {result && (
                <div
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                    claudeCalls === 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {claudeCalls === 0
                    ? '✓ Aucun appel Claude'
                    : `⚡ ${claudeCalls} appel${claudeCalls > 1 ? 's' : ''} Claude`}
                </div>
              )}

            </div>


            {!result && (

              <div className="mt-5 rounded-xl border border-dashed border-stone-200 bg-stone-50 p-8 text-center text-sm text-slate-500">
                Lance un test pour voir la résolution,
                le match stock, les conversions et les lignes
                réellement additionnées.
              </div>

            )}


            {result?.error && (

              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">

                <div className="font-bold">
                  Erreur du laboratoire
                </div>

                <div className="mt-1">
                  {result.error}
                </div>

              </div>

            )}


            {result && !result.error && (

              <>

                {/* -----------------------------------------------------------
                    ENTRÉE
                    ----------------------------------------------------------- */}

                {result.input && (

                  <div className="mt-5 rounded-xl bg-stone-50 p-4">

                    <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                      Entrée testée
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">

                      <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold">
                        {result.input.name}
                      </span>

                      <span className="rounded-full bg-white px-3 py-1.5 text-sm">
                        {pretty(result.input.qty)} {result.input.unit}
                      </span>

                    </div>

                  </div>

                )}


                {/* -----------------------------------------------------------
                    RÉSULTATS COMPARÉS
                    ----------------------------------------------------------- */}

                {result.compared?.length ? (

                  <div className="mt-5 space-y-4">

                    {result.compared.map((item, index) => (

                      <div
                        key={`${item.produit}-${index}`}
                        className="rounded-xl border border-stone-200 p-4"
                      >

                        <div className="flex flex-wrap items-center justify-between gap-3">

                          <div>
                            <div className="text-xs uppercase tracking-wider text-stone-400">
                              Besoin
                            </div>

                            <div className="font-bold">
                              {item.produit}
                            </div>

                            {item.ingredient_id && (
                              <div className="mt-1 text-xs text-slate-400">
                                ingredient_id : {item.ingredient_id}
                              </div>
                            )}
                          </div>

                          <Status value={item.ai_status} />

                        </div>


                        <div className="mt-4 grid gap-2 sm:grid-cols-3">

                          <Box
                            label="Besoin"
                            value={`${pretty(item.qte)} ${item.unite}`}
                          />

                          <Box
                            label="Stock retenu"
                            value={`${pretty(item.qte_stock)} ${item.unite}`}
                          />

                          <Box
                            label="À acheter"
                            value={`${pretty(item.qte_a_acheter)} ${item.unite}`}
                          />

                        </div>


                        {/* LIGNES RÉELLEMENT UTILISÉES */}

                        {!!item.stock_details?.length && (

                          <div className="mt-5">

                            <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                              Lignes stock réellement utilisées
                            </div>

                            <div className="mt-2 overflow-x-auto rounded-xl border border-stone-200">

                              <table className="w-full text-left text-sm">

                                <thead className="bg-stone-50 text-slate-500">

                                  <tr>
                                    <th className="px-3 py-2">Produit</th>
                                    <th className="px-3 py-2">Source</th>
                                    <th className="px-3 py-2">Stock</th>
                                    <th className="px-3 py-2">Converti</th>
                                    <th className="px-3 py-2">Conversion</th>
                                  </tr>

                                </thead>

                                <tbody>

                                  {item.stock_details.map((line, i) => (

                                    <tr
                                      key={`${line.produit}-${i}`}
                                      className="border-t border-stone-100"
                                    >

                                      <td className="px-3 py-2 font-medium">
                                        {line.produit}
                                      </td>

                                      <td className="px-3 py-2">
                                        {line.source ||
                                          result.stock?.items.find(
                                            stockLine =>
                                              stockLine.produit ===
                                              line.produit
                                          )?.source ||
                                          '—'}
                                      </td>

                                      <td className="px-3 py-2">
                                        {pretty(line.qte_stock)}{' '}
                                        {line.unite_stock}
                                      </td>

                                      <td className="px-3 py-2">
                                        {line.qte_convertie == null
                                          ? '—'
                                          : `${pretty(line.qte_convertie)} ${line.unite_comparee ?? item.unite}`}
                                      </td>

                                      <td className="px-3 py-2 text-xs text-slate-500">
                                        {line.conversion || '—'}
                                      </td>

                                    </tr>

                                  ))}

                                </tbody>

                              </table>

                            </div>

                          </div>

                        )}

                      </div>

                    ))}

                  </div>

                ) : (

                  <div className="mt-5 rounded-xl bg-stone-50 p-4 text-sm text-slate-500">
                    Aucun résultat de rapprochement retourné par le moteur.
                  </div>

                )}

              </>

            )}

          </article>

        </section>


        {/* ===================================================================
            DIAGNOSTIC MOTEUR
            =================================================================== */}

        {result && !result.error && (

          <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">

            <div className="flex flex-wrap items-start justify-between gap-4">

              <div>

                <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">
                  Diagnostic
                </div>

                <h2 className="mt-1 text-xl font-black">
                  🔍 Chemin suivi par le Matcher
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Le laboratoire permet de vérifier que le moteur
                  privilégie les mécanismes déterministes et la mémoire
                  avant de solliciter Claude.
                </p>

              </div>


              <div
                className={`rounded-full px-4 py-2 text-sm font-black ${
                  claudeCalls === 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {claudeCalls === 0
                  ? '✓ Aucun appel Claude'
                  : `⚡ ${claudeCalls} appel${claudeCalls > 1 ? 's' : ''} Claude`}
              </div>

            </div>


            <div className="mt-6 overflow-hidden rounded-xl border border-stone-200">

              <div className="grid grid-cols-[1fr_130px_130px] bg-stone-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-stone-500">

                <div>Étape</div>
                <div>Mémoire</div>
                <div>IA</div>

              </div>


              <DiagnosticRow
                label="Résolution ingrédient"
                memory={ingredientMemory}
                aiCalled={ingredientAiCalled}
                source={ingredientSource}
              />


              <DiagnosticRow
                label="Rapprochement stock"
                memory={stockMemory}
                aiCalled={stockAiCalled}
                source={stockSource}
              />

            </div>


            <div className="mt-5 grid gap-3 md:grid-cols-2">

              <TraceCard
                title="Résolution ingrédient"
                source={ingredientSource}
                aiCalled={ingredientAiCalled}
                confidence={
                  trace?.ingredient?.aiConfidence
                }
                raw={trace?.ingredient?.raw}
                normalized={trace?.ingredient?.normalized}
              />


              <TraceCard
                title="Rapprochement stock"
                source={stockSource}
                aiCalled={stockAiCalled}
                confidence={
                  trace?.stock?.aiConfidence
                }
              />

            </div>


            {/* JOURNAL */}

            {!!trace?.events?.length && (

              <div className="mt-5">

                <div className="text-sm font-bold">
                  Journal du moteur
                </div>

                <div className="mt-2 rounded-xl bg-slate-950 p-4">

                  <div className="space-y-1 font-mono text-xs text-slate-200">

                    {trace.events.map((event, index) => (

                      <div key={index}>
                        <span className="mr-2 text-emerald-400">
                          ✓
                        </span>
                        {event}
                      </div>

                    ))}

                  </div>

                </div>

              </div>

            )}


            {/* TOTAL CLAUDE */}

            <div className="mt-5 flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3">

              <span className="font-semibold">
                Nombre total d'appels Claude
              </span>

              <span
                className={`text-xl font-black ${
                  claudeCalls === 0
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
              >
                {claudeCalls}
              </span>

            </div>

          </section>

        )}


        {/* ===================================================================
            RÉSOLUTION DÉTAILLÉE
            =================================================================== */}

        {result?.resolved?.length ? (

          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">

            <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">
              Étape 1
            </div>

            <h2 className="mt-1 text-xl font-black">
              Résolution de l'ingrédient
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Voici ce que le moteur a finalement retenu avant
              l'agrégation et le croisement avec le stock.
            </p>


            <div className="mt-4 space-y-3">

              {result.resolved.map((item, index) => (

                <div
                  key={`${item.produit}-${index}`}
                  className="rounded-xl bg-stone-50 p-4"
                >

                  <div className="flex flex-wrap items-center justify-between gap-3">

                    <div>

                      <div className="font-bold">
                        {item.produit}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        ID : {item.ingredient_id || 'aucun'}
                        {' · '}
                        {pretty(item.qte)} {item.unite}
                      </div>

                      {item.source_recipe_nom && (
                        <div className="mt-1 text-xs text-slate-400">
                          Recette : {item.source_recipe_nom}
                        </div>
                      )}

                    </div>


                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        item.needs_review
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {item.needs_review
                        ? 'À vérifier'
                        : 'Résolu'}
                    </span>

                  </div>

                </div>

              ))}

            </div>

          </section>

        ) : null}


        {/* ===================================================================
            AGRÉGATION
            =================================================================== */}

        {result?.aggregated?.length ? (

          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">

            <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">
              Étape 2
            </div>

            <h2 className="mt-1 text-xl font-black">
              Agrégation des besoins
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Cette étape montre les besoins tels qu'ils sont transmis
              au calcul de stock.
            </p>


            <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200">

              <table className="w-full text-left text-sm">

                <thead className="bg-stone-50 text-slate-500">

                  <tr>
                    <th className="px-4 py-3">Produit</th>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Quantité</th>
                    <th className="px-4 py-3">Statut</th>
                  </tr>

                </thead>

                <tbody>

                  {result.aggregated.map((item, index) => (

                    <tr
                      key={`${item.produit}-${index}`}
                      className="border-t border-stone-100"
                    >

                      <td className="px-4 py-3 font-semibold">
                        {item.produit}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {item.ingredient_id || '—'}
                      </td>

                      <td className="px-4 py-3">
                        {pretty(item.qte)} {item.unite}
                      </td>

                      <td className="px-4 py-3">
                        {item.needs_review
                          ? '⚠️ À vérifier'
                          : '✓ OK'}
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          </section>

        ) : null}


        {/* ===================================================================
            INVENTAIRE RÉEL
            =================================================================== */}

        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">

          <div className="flex flex-wrap items-center justify-between gap-3">

            <div>

              <div className="text-xs font-bold uppercase tracking-widest text-emerald-600">
                Référentiel opérationnel
              </div>

              <h2 className="mt-1 text-xl font-black">
                Inventaire réel vu par le laboratoire
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Une ligne = un article réel de Frosti ou Cellio.
                Les doublons ne sont pas écrasés.
              </p>

            </div>


            <div className="flex flex-wrap gap-2">

              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filtrer un produit…"
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />

              <button
                type="button"
                onClick={loadInventory}
                disabled={inventoryLoading}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold hover:bg-stone-50 disabled:opacity-50"
              >
                {inventoryLoading
                  ? 'Actualisation…'
                  : 'Actualiser'}
              </button>

            </div>

          </div>


          {inventory?.error && (

            <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {inventory.error}
            </div>

          )}


          {!inventoryLoading &&
            stock &&
            filteredGroups.length === 0 && (

              <div className="mt-5 rounded-xl bg-stone-50 p-6 text-center text-sm text-slate-500">
                Aucun produit ne correspond au filtre.
              </div>

            )}


          <div className="mt-4 overflow-x-auto">

            <table className="w-full text-left text-sm">

              <thead>

                <tr className="border-b border-stone-200 text-slate-500">

                  <th className="py-3 pr-4">
                    Produit
                  </th>

                  <th className="px-3 py-3">
                    Lignes
                  </th>

                  <th className="px-3 py-3">
                    Sources
                  </th>

                  <th className="px-3 py-3">
                    Unités
                  </th>

                </tr>

              </thead>


              <tbody>

                {filteredGroups.map(group => (

                  <tr
                    key={group.key}
                    className="border-b border-stone-100 align-top last:border-0"
                  >

                    <td className="py-3 pr-4 font-semibold">
                      {group.produit}
                    </td>


                    <td className="px-3 py-3">

                      <div className="space-y-1">

                        {group.lignes.map(line => (

                          <div
                            key={line.id}
                            className="whitespace-nowrap"
                          >
                            {pretty(line.qte)} {line.unite}
                          </div>

                        ))}

                      </div>

                    </td>


                    <td className="px-3 py-3">

                      <div className="space-y-1">

                        {group.lignes.map(line => (

                          <div
                            key={`${line.id}-source`}
                            className="text-xs"
                          >
                            {sourceOfLine(line)}
                          </div>

                        ))}

                      </div>

                    </td>


                    <td className="px-3 py-3">
                      {group.unites.join(', ') || '—'}
                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        </section>


        {/* ===================================================================
            JSON BRUT
            =================================================================== */}

        {result && (

          <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">

            <button
              type="button"
              onClick={() => setShowRawJson(value => !value)}
              className="flex w-full items-center justify-between px-6 py-4 text-left font-bold"
            >

              <span>
                {showRawJson
                  ? 'Masquer le JSON brut'
                  : 'Voir le JSON brut'}
              </span>

              <span className="text-slate-400">
                {showRawJson ? '▲' : '▼'}
              </span>

            </button>


            {showRawJson && (

              <pre className="max-h-[700px] overflow-auto border-t border-stone-200 bg-slate-950 p-5 text-xs leading-5 text-slate-100">
                {JSON.stringify(result, null, 2)}
              </pre>

            )}

          </section>

        )}

      </div>

    </main>
  )
}


/* ============================================================================
   COMPONENTS
   ============================================================================ */

function Metric({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">

      <div className="text-xs uppercase tracking-wider text-stone-400">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black">
        {pretty(value)}
      </div>

    </div>
  )
}


function Box({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  return (
    <div className="rounded-xl bg-stone-50 p-3">

      <div className="text-xs text-stone-400">
        {label}
      </div>

      <div className="mt-1 font-bold">
        {pretty(value)}
      </div>

    </div>
  )
}


function DiagnosticRow({
  label,
  memory,
  aiCalled,
  source,
}: {
  label: string
  memory: boolean
  aiCalled: boolean
  source?: string | null
}) {
  return (
    <div className="grid grid-cols-[1fr_130px_130px] items-center border-t border-stone-200 px-4 py-3">

      <div>

        <div className="font-semibold">
          {label}
        </div>

        {source && (
          <div className="mt-0.5 text-xs text-slate-400">
            source : {sourceLabel(source)}
          </div>
        )}

      </div>


      <div>

        {memory ? (

          <span className="font-bold text-emerald-700">
            ✓ OUI
          </span>

        ) : (

          <span className="text-slate-400">
            — NON
          </span>

        )}

      </div>


      <div>

        {aiCalled ? (

          <span className="font-bold text-amber-700">
            ⚡ OUI
          </span>

        ) : (

          <span className="font-bold text-emerald-700">
            ✓ NON
          </span>

        )}

      </div>

    </div>
  )
}


function TraceCard({
  title,
  source,
  aiCalled,
  confidence,
  raw,
  normalized,
}: {
  title: string
  source?: string | null
  aiCalled: boolean
  confidence?: number | null
  raw?: string
  normalized?: string
}) {
  return (
    <div className="rounded-xl border border-stone-200 p-4">

      <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
        {title}
      </div>


      <div className="mt-3 flex items-center justify-between gap-3">

        <span className="text-sm text-slate-500">
          Méthode
        </span>

        <span className="font-bold">
          {sourceLabel(source)}
        </span>

      </div>


      <div className="mt-2 flex items-center justify-between gap-3">

        <span className="text-sm text-slate-500">
          Claude
        </span>

        <span
          className={
            aiCalled
              ? 'font-bold text-amber-700'
              : 'font-bold text-emerald-700'
          }
        >
          {aiCalled ? 'OUI' : 'NON'}
        </span>

      </div>


      {confidence !== null &&
        confidence !== undefined && (

          <div className="mt-2 flex items-center justify-between gap-3">

            <span className="text-sm text-slate-500">
              Confiance IA
            </span>

            <span className="font-bold">
              {(confidence * 100).toFixed(0)} %
            </span>

          </div>

        )}


      {raw && (

        <div className="mt-3 rounded-lg bg-stone-50 p-2 text-xs">

          <div className="text-stone-400">
            Brut
          </div>

          <div className="mt-0.5 font-medium">
            {raw}
          </div>

        </div>

      )}


      {normalized && (

        <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs">

          <div className="text-emerald-600">
            Normalisé
          </div>

          <div className="mt-0.5 font-semibold text-emerald-900">
            {normalized}
          </div>

        </div>

      )}

    </div>
  )
}


function Status({
  value,
}: {
  value: string
}) {
  const map: Record<
    string,
    [string, string, string]
  > = {
    green: [
      '🟢',
      'Stock suffisant',
      'bg-emerald-100 text-emerald-800',
    ],

    orange: [
      '🟠',
      'Partiel / à vérifier',
      'bg-amber-100 text-amber-800',
    ],

    red: [
      '🔴',
      'À acheter',
      'bg-red-100 text-red-800',
    ],
  }

  const [
    icon,
    label,
    classes,
  ] = map[value] ?? [
    '⚪',
    value || 'Inconnu',
    'bg-slate-100 text-slate-700',
  ]

  return (
    <span
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}
    >
      {icon} {label}
    </span>
  )
}
