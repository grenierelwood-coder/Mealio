'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

type Result = {
  input: { name: string; qty: number; unit: string }
  resolved: Array<{
    produit: string
    ingredient_id: string | null
    qte: number
    unite: string
    needs_review: boolean
    source_recipe_id: string
    source_recipe_nom: string
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, qty, unit, recipeName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erreur')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inattendue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-2xl font-black text-emerald-700">Mealio</Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/planning">Planning</Link>
            <Link href="/courses">Courses</Link>
            <Link href="/stock">Stocks</Link>
            <span className="font-bold text-emerald-700">Matcher</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-7">
          <div className="text-sm font-bold uppercase tracking-widest text-amber-600">Back-office de test</div>
          <h1 className="mt-1 text-3xl font-black">🧠 Laboratoire du Matcher</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Cette page appelle le moteur côté serveur. Elle teste la normalisation,
            les synonymes, le référentiel officiel, le fallback Anthropic si nécessaire,
            les conversions et enfin le croisement avec Frosti + Cellio.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold">Tester un ingrédient</h2>
            <form onSubmit={testMatcher} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                Ingrédient brut
                <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-sm font-medium">
                Quantité
                <input type="number" step="any" value={qty} onChange={e => setQty(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-sm font-medium">
                Unité
                <input value={unit} onChange={e => setUnit(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-sm font-medium">
                Recette de test
                <input value={recipeName} onChange={e => setRecipeName(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>

              <button disabled={loading} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">
                {loading ? 'Analyse en cours…' : 'Analyser'}
              </button>
            </form>

            <div className="mt-6 border-t border-stone-100 pt-5">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-400">Essais rapides</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {examples.map(([n, q, u]) => (
                  <button
                    key={n}
                    onClick={() => { setName(n); setQty(q); setUnit(u) }}
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-xs hover:bg-stone-50"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-5">
            {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div>}

            {!result && !error && (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-slate-500">
                Lance un test pour voir exactement ce que le back-end produit.
              </div>
            )}

            {result && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Metric label="Stock analysé" value={`${result.stockCount}`} />
                  <Metric label="Résolution" value={result.resolved[0]?.ingredient_id ? '✓ trouvée' : '⚠ inconnue'} />
                  <Metric label="Cache IA" value={`${result.aiCacheSize}`} />
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white p-6">
                  <h2 className="font-bold">1. Résolution</h2>
                  {result.resolved.map((item, index) => (
                    <div key={index} className="mt-4 rounded-xl bg-stone-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold">{item.produit}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            ID : {item.ingredient_id || 'aucun'} · {item.qte} {item.unite}
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.needs_review ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                          {item.needs_review ? 'À vérifier' : 'Résolu'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white p-6">
                  <h2 className="font-bold">2. Croisement avec les stocks</h2>
                  <div className="mt-4 space-y-3">
                    {result.compared.map((item, index) => (
                      <div key={index} className="flex items-center justify-between gap-4 rounded-xl border border-stone-100 p-4">
                        <div>
                          <div className="font-semibold">{item.produit}</div>
                          <div className="text-sm text-slate-500">Besoin : {item.qte} {item.unite} · Achat : {item.qte_a_acheter} {item.unite}</div>
                        </div>
                        <Status status={item.ai_status} />
                      </div>
                    ))}
                  </div>
                </div>

                <details className="rounded-2xl border border-stone-200 bg-white p-5">
                  <summary className="cursor-pointer font-semibold">Voir le JSON brut</summary>
                  <pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(result, null, 2)}</pre>
                </details>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-stone-200 bg-white p-5"><div className="text-xs uppercase tracking-wider text-stone-400">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>
}

function Status({ status }: { status: 'green' | 'orange' | 'red' }) {
  const map = {
    green: ['🟢', 'En stock', 'bg-emerald-100 text-emerald-800'],
    orange: ['🟠', 'Partiel / à vérifier', 'bg-amber-100 text-amber-800'],
    red: ['🔴', 'À acheter', 'bg-red-100 text-red-800'],
  } as const
  const [icon, label, classes] = map[status]
  return <span className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}>{icon} {label}</span>
}
