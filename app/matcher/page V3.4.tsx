'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

type TraceStage = {
  memoryHit?: boolean
  source?: string
  aiCalled?: boolean
  aiConfidence?: number | null
}

type MatcherTrace = {
  ingredient?: TraceStage
  stock?: TraceStage

  // Certains champs peuvent être ajoutés progressivement
  // dans matcher.tsx sans casser le front.
  claudeCalls?: number
  events?: string[]

  [key: string]: unknown
}

type Result = {
  input: {
    name: string
    qty: number
    unit: string
    recipeName?: string
  }

  resolved: Array<{
    produit: string
    ingredient_id: string | null
    qte: number
    unite: string
    needs_review: boolean
    source_recipe_id: string
    source_recipe_nom: string
  }>

  aggregated?: Array<{
    produit: string
    ingredient_id: string | null
    qte: number
    unite: string
    needs_review: boolean
  }>

  compared: Array<{
    produit: string
    ingredient_id: string | null
    qte: number
    unite: string
    qte_a_acheter: number
    ai_status: 'green' | 'orange' | 'red'
    needs_review: boolean
  }>

  stockCount: number
  aiCacheSize: number

  trace?: MatcherTrace
}

const examples = [
  ['sucre roux', '2', 'c.à.s'],
  ['farine de blé', '250', 'g'],
  ['tomates', '3', 'pièce'],
  ['huile d’olive', '2', 'c.à.s'],
]

export default function MatcherPage() {
  const [name, setName] = useState('sucre roux')
  const [qty, setQty] = useState('2')
  const [unit, setUnit] = useState('c.à.s')
  const [recipeName, setRecipeName] = useState('Test manuel')

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  async function testMatcher(e: FormEvent) {
    e.preventDefault()

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('/api/matcher/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          qty,
          unit,
          recipeName,
        }),
      })

      const contentType =
        response.headers.get('content-type') ?? ''

      if (!contentType.includes('application/json')) {
        const text = await response.text()

        throw new Error(
          `Le serveur n'a pas renvoyé du JSON (${response.status}). ${text.slice(0, 200)}`
        )
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.error || 'Erreur du serveur'
        )
      }

      setResult(data)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erreur inattendue'
      )
    } finally {
      setLoading(false)
    }
  }

  const trace = result?.trace

  const ingredientMemory =
    trace?.ingredient?.memoryHit === true

  const ingredientAiCalled =
    trace?.ingredient?.aiCalled === true

  const stockMemory =
    trace?.stock?.memoryHit === true

  const stockAiCalled =
    trace?.stock?.aiCalled === true

  const ingredientSource =
    trace?.ingredient?.source

  const stockSource =
    trace?.stock?.source

  const claudeCalls =
    typeof trace?.claudeCalls === 'number'
      ? trace.claudeCalls
      : Number(ingredientAiCalled) +
        Number(stockAiCalled)

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">

      {/* ============================================================
          HEADER
          ============================================================ */}

      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">

          <Link
            href="/"
            className="text-2xl font-black text-emerald-700"
          >
            Mealio
          </Link>

          <nav className="flex gap-4 text-sm">
            <Link
              href="/planning"
              className="hover:text-emerald-700"
            >
              Planning
            </Link>

            <Link
              href="/courses"
              className="hover:text-emerald-700"
            >
              Courses
            </Link>

            <Link
              href="/stock"
              className="hover:text-emerald-700"
            >
              Stocks
            </Link>

            <span className="font-bold text-emerald-700">
              Matcher
            </span>
          </nav>

        </div>
      </header>


      {/* ============================================================
          CONTENU
          ============================================================ */}

      <div className="mx-auto max-w-7xl px-5 py-8">

        <div className="mb-7">

          <div className="text-sm font-bold uppercase tracking-widest text-amber-600">
            Back-office de test
          </div>

          <h1 className="mt-1 text-3xl font-black">
            🧠 Laboratoire du Matcher
          </h1>

          <p className="mt-2 max-w-4xl text-slate-600">
            Cette page appelle le moteur côté serveur.
            Elle permet de tester la normalisation, les synonymes,
            le référentiel officiel, la mémoire, le fallback Anthropic,
            les conversions et enfin le croisement avec Frosti + Cellio.
          </p>

        </div>


        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">

          {/* ==========================================================
              COLONNE GAUCHE : FORMULAIRE
              ========================================================== */}

          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">

            <h2 className="font-bold">
              Tester un ingrédient
            </h2>

            <form
              onSubmit={testMatcher}
              className="mt-5 space-y-4"
            >

              <label className="block text-sm font-medium">
                Ingrédient brut

                <input
                  value={name}
                  onChange={e =>
                    setName(e.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                />
              </label>


              <label className="block text-sm font-medium">
                Quantité

                <input
                  type="number"
                  step="any"
                  value={qty}
                  onChange={e =>
                    setQty(e.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                />
              </label>


              <label className="block text-sm font-medium">
                Unité

                <input
                  value={unit}
                  onChange={e =>
                    setUnit(e.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                />
              </label>


              <label className="block text-sm font-medium">
                Recette de test

                <input
                  value={recipeName}
                  onChange={e =>
                    setRecipeName(e.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500"
                />
              </label>


              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                {loading
                  ? 'Analyse en cours…'
                  : 'Analyser'}
              </button>

            </form>


            {/* ESSAIS RAPIDES */}

            <div className="mt-6 border-t border-stone-100 pt-5">

              <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Essais rapides
              </div>

              <div className="mt-3 flex flex-wrap gap-2">

                {examples.map(([n, q, u]) => (

                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setName(n)
                      setQty(q)
                      setUnit(u)
                    }}
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-xs hover:bg-stone-50"
                  >
                    {n}
                  </button>

                ))}

              </div>

            </div>

          </section>


          {/* ==========================================================
              COLONNE DROITE
              ========================================================== */}

          <section className="space-y-5">

            {/* ERREUR */}

            {error && (

              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">

                <div className="font-bold">
                  Erreur
                </div>

                <div className="mt-1 text-sm">
                  {error}
                </div>

              </div>

            )}


            {/* ÉTAT INITIAL */}

            {!result && !error && (

              <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-slate-500">

                Lance un test pour voir exactement
                ce que le back-end produit.

              </div>

            )}


            {result && (

              <>

                {/* ====================================================
                    MÉTRIQUES PRINCIPALES
                    ==================================================== */}

                <div className="grid gap-4 sm:grid-cols-3">

                  <Metric
                    label="Stock analysé"
                    value={`${result.stockCount}`}
                  />

                  <Metric
                    label="Résolution"
                    value={
                      result.resolved[0]?.ingredient_id
                        ? '✓ trouvée'
                        : '⚠ inconnue'
                    }
                  />

                  <Metric
                    label="Entrées mémoire IA"
                    value={`${result.aiCacheSize}`}
                  />

                </div>


                {/* ====================================================
                    DIAGNOSTIC DU MOTEUR
                    ==================================================== */}

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
                        Objectif : utiliser la mémoire et le moteur
                        déterministe avant de solliciter Claude.
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


                  {/* TABLEAU DIAGNOSTIC */}

                  <div className="mt-6 overflow-hidden rounded-xl border border-stone-200">

                    <div className="grid grid-cols-[1fr_150px_150px] bg-stone-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-stone-500">

                      <div>
                        Étape
                      </div>

                      <div>
                        Mémoire
                      </div>

                      <div>
                        IA
                      </div>

                    </div>


                    <DiagnosticRow
                      label="Résolution ingrédient"
                      memory={ingredientMemory}
                      aiCalled={ingredientAiCalled}
                      source={ingredientSource}
                    />


                    <DiagnosticRow
                      label="Mémoire stock"
                      memory={stockMemory}
                      aiCalled={false}
                      source={stockMemory ? 'memory' : undefined}
                    />


                    <DiagnosticRow
                      label="Rapprochement stock"
                      memory={stockMemory}
                      aiCalled={stockAiCalled}
                      source={stockSource}
                    />

                  </div>


                  {/* DÉTAIL DES SOURCES */}

                  <div className="mt-5 grid gap-3 md:grid-cols-2">

                    <TraceCard
                      title="Résolution ingrédient"
                      source={ingredientSource}
                      aiCalled={ingredientAiCalled}
                      confidence={
                        trace?.ingredient?.aiConfidence
                      }
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

                  {trace?.events &&
                    trace.events.length > 0 && (

                    <div className="mt-5">

                      <div className="text-sm font-bold">
                        Journal du moteur
                      </div>

                      <div className="mt-2 rounded-xl bg-slate-950 p-4">

                        <div className="space-y-1 font-mono text-xs text-slate-200">

                          {trace.events.map(
                            (event, index) => (

                              <div key={index}>
                                <span className="mr-2 text-emerald-400">
                                  ✓
                                </span>

                                {event}
                              </div>

                            )
                          )}

                        </div>

                      </div>

                    </div>

                  )}


                  {/* TOTAL APPELS */}

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


                {/* ====================================================
                    1. RÉSOLUTION
                    ==================================================== */}

                <section className="rounded-2xl border border-stone-200 bg-white p-6">

                  <h2 className="font-bold">
                    1. Résolution
                  </h2>

                  {result.resolved.map(
                    (item, index) => (

                      <div
                        key={index}
                        className="mt-4 rounded-xl bg-stone-50 p-4"
                      >

                        <div className="flex flex-wrap items-center justify-between gap-2">

                          <div>

                            <div className="font-bold">
                              {item.produit}
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              ID :{' '}
                              {item.ingredient_id ||
                                'aucun'}
                              {' · '}
                              {item.qte}{' '}
                              {item.unite}
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              Recette :{' '}
                              {item.source_recipe_nom}
                            </div>

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

                    )
                  )}

                </section>


                {/* ====================================================
                    2. STOCK
                    ==================================================== */}

                <section className="rounded-2xl border border-stone-200 bg-white p-6">

                  <h2 className="font-bold">
                    2. Croisement avec les stocks
                  </h2>

                  <div className="mt-4 space-y-3">

                    {result.compared.map(
                      (item, index) => (

                        <div
                          key={index}
                          className="flex items-center justify-between gap-4 rounded-xl border border-stone-100 p-4"
                        >

                          <div>

                            <div className="font-semibold">
                              {item.produit}
                            </div>

                            <div className="text-sm text-slate-500">
                              Besoin :{' '}
                              {item.qte}{' '}
                              {item.unite}
                              {' · '}
                              Achat :{' '}
                              {item.qte_a_acheter}{' '}
                              {item.unite}
                            </div>

                          </div>

                          <Status
                            status={item.ai_status}
                          />

                        </div>

                      )
                    )}

                  </div>

                </section>


                {/* ====================================================
                    JSON
                    ==================================================== */}

                <details className="rounded-2xl border border-stone-200 bg-white p-5">

                  <summary className="cursor-pointer font-semibold">
                    Voir le JSON brut
                  </summary>

                  <pre className="mt-4 max-h-[600px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
                    {JSON.stringify(
                      result,
                      null,
                      2
                    )}
                  </pre>

                </details>

              </>

            )}

          </section>

        </div>

      </div>

    </main>
  )
}


/* ========================================================================
   COMPOSANTS
   ======================================================================== */

function Metric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">

      <div className="text-xs uppercase tracking-wider text-stone-400">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black">
        {value}
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
  source?: string
}) {
  return (
    <div className="grid grid-cols-[1fr_150px_150px] items-center border-t border-stone-200 px-4 py-3">

      <div>

        <div className="font-semibold">
          {label}
        </div>

        {source && (
          <div className="mt-0.5 text-xs text-slate-400">
            source : {source}
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
}: {
  title: string
  source?: string
  aiCalled: boolean
  confidence?: number | null
}) {
  return (
    <div className="rounded-xl border border-stone-200 p-4">

      <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
        {title}
      </div>


      <div className="mt-3 flex items-center justify-between">

        <span className="text-sm text-slate-500">
          Méthode
        </span>

        <span className="font-bold">
          {formatSource(source)}
        </span>

      </div>


      <div className="mt-2 flex items-center justify-between">

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

        <div className="mt-2 flex items-center justify-between">

          <span className="text-sm text-slate-500">
            Confiance IA
          </span>

          <span className="font-bold">
            {(confidence * 100).toFixed(0)} %
          </span>

        </div>

      )}

    </div>
  )
}


function formatSource(
  source?: string
) {
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

    default:
      return '—'

  }
}


function Status({
  status,
}: {
  status: 'green' | 'orange' | 'red'
}) {
  const map = {
    green: [
      '🟢',
      'En stock',
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
  } as const

  const [icon, label, classes] =
    map[status]

  return (
    <span
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}
    >
      {icon} {label}
    </span>
  )
}