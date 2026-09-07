'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Source = 'frosti' | 'cellio'
type Ingredient = { id: string; nom: string; categorie: string | null }
type Destination = {
  source: Source
  location_id: string
  location_name: string
  rule_id: string
  rule_scope: 'default' | 'category' | 'ingredient'
  rule_label: string
}

type PreviewResponse = {
  ingredient?: Ingredient & { default_is_fridge?: boolean | null }
  destination?: Destination | null
  error?: string
}

export default function StorageRoutingTestPage() {
  const [source, setSource] = useState<Source>('cellio')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [ingredientId, setIngredientId] = useState('')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/storage/ingredients', { cache: 'no-store' })
      .then(async response => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || 'Impossible de charger les ingrédients.')
        return json
      })
      .then(json => setIngredients(Array.isArray(json.ingredients) ? json.ingredients : []))
      .catch(error => setError(error instanceof Error ? error.message : 'Erreur de chargement.'))
      .finally(() => setLoading(false))
  }, [])

  const selected = useMemo(
    () => ingredients.find(ingredient => ingredient.id === ingredientId) ?? null,
    [ingredients, ingredientId],
  )

  async function testRouting() {
    if (!ingredientId) return
    setTesting(true)
    setError('')
    setPreview(null)

    try {
      const response = await fetch(
        `/api/admin/storage/preview?source=${source}&ingredient_id=${encodeURIComponent(ingredientId)}`,
        { cache: 'no-store' },
      )
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || 'Impossible de tester le routage.')
      setPreview(json)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Erreur de test.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">

      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Administration</p>
        <h1 className="mt-1 text-3xl font-black">🧪 Tester le rangement</h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          On simule exactement la décision qui sera prise lorsqu’un produit acheté sera envoyé dans Frosti ou Cellio.
        </p>

        {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm font-semibold">
              Application
              <select value={source} onChange={event => { setSource(event.target.value as Source); setPreview(null) }} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal">
                <option value="cellio">🍷 Cellio</option>
                <option value="frosti">❄️ Frosti</option>
              </select>
            </label>

            <label className="text-sm font-semibold md:col-span-2">
              Ingrédient officiel
              <select value={ingredientId} onChange={event => { setIngredientId(event.target.value); setPreview(null) }} disabled={loading} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal">
                <option value="">Choisir un ingrédient…</option>
                {ingredients.map(ingredient => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.nom}{ingredient.categorie ? ` · ${ingredient.categorie}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button type="button" onClick={() => void testRouting()} disabled={!ingredientId || testing || loading} className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
            {testing ? 'Test en cours…' : 'Tester le routage'}
          </button>
        </section>

        {selected && (
          <section className="mt-5 rounded-2xl border bg-white p-6 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-400">Ingrédient sélectionné</div>
            <div className="mt-1 text-xl font-black">{selected.nom}</div>
            <div className="mt-1 text-sm text-slate-500">Catégorie : {selected.categorie || '—'}</div>
          </section>
        )}

        {preview && (
          <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Décision du moteur</div>
            {preview.destination ? (
              <>
                <div className="mt-2 text-2xl font-black text-emerald-950">→ {preview.destination.location_name}</div>
                <div className="mt-2 text-sm font-semibold text-emerald-900">{preview.destination.rule_label}</div>
                <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-slate-600">
                  Priorité appliquée : {preview.destination.rule_scope === 'ingredient' ? 'exception ingrédient' : preview.destination.rule_scope === 'category' ? 'catégorie' : 'défaut'}
                </div>
              </>
            ) : (
              <div className="mt-2 font-bold text-red-700">Aucune destination trouvée.</div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
