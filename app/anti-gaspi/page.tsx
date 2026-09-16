'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type IngredientResult = {
  id: string
  nom: string
  categorie: string
  inStock: boolean
  stockLabels: string[]
  recipeCount?: number
}

type StockItem = {
  id: string
  produit: string
  qte: number
  unite: string
  categorie: string
  source: 'frosti' | 'cellio'
  date_peremption?: string | null
}

type Suggestion = {
  id: string
  nom: string
  description: string | null
  image_url: string | null
  prep_time: number
  cook_time: number
  urgentProducts: string[]
  matchedProducts: string[]
  score?: number
}

function stockKey(item: StockItem) {
  return `${item.source}:${item.id}`
}

function isWineProduct(item: StockItem) {
  const value = `${item.produit} ${item.categorie}`
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')

  // Les boissons alcoolisées ne sont pas des ingrédients sélectionnables
  // pour l'Anti-Gaspi : Cellio gère déjà leurs alertes.
  const wineTerms = [
    'vin',
    'vins',
    'wine',
    'champagne',
    'cremant',
    'cidre',
    'biere',
    'bierre',
    'merlot',
    'cabernet',
    'syrah',
    'chardonnay',
    'sauvignon',
    'riesling',
    'bourgogne',
    'bordeaux',
    'beaujolais',
    'cotes du rhone',
    'cote du rhone',
    'porto',
    'sherry',
    'jerez',
    'madere',
    'marsala',
    'vermouth',
  ]

  const tokens = value.replace(/[^a-z0-9]+/g, ' ').split(/\\s+/).filter(Boolean)
  const normalized = ` ${tokens.join(' ')} `

  return wineTerms.some(term => {
    const normalizedTerm = term.replace(/[^a-z0-9]+/g, ' ').trim()
    return normalized.includes(` ${normalizedTerm} `)
  })
}

export default function AntiGaspiPage() {
  const [stock, setStock] = useState<StockItem[]>([])
  const [urgentStock, setUrgentStock] = useState<StockItem[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [ingredientResults, setIngredientResults] = useState<IngredientResult[]>([])
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<string[]>([])
  const [selectedIngredientNames, setSelectedIngredientNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)

  async function load() {
    try {
      setLoading(true)
      const response = await fetch('/api/anti-gaspi', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Impossible de charger les suggestions.')
      setStock(data.availableStock ?? [])
      setUrgentStock(
        (data.urgentStock ?? []).filter(
          (item: StockItem) => !isWineProduct(item)
        )
      )
      setSuggestions(data.suggestions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const query = search.trim()
    if (!query) { setIngredientResults([]); return }
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/anti-gaspi?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error ?? 'Recherche impossible.')
        setIngredientResults(data.ingredients ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur de recherche.')
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [search])

  function toggleSelection(item: StockItem) {
    const key = stockKey(item)
    setSelectionMode(true)
    setSelectedKeys(current => current.includes(key) ? current.filter(k => k !== key) : [...current, key])
  }

  function clearSelection() {
    setSelectedKeys([])
    setSelectedIngredientIds([])
    setSelectedIngredientNames({})
    setSuggestions([])
  }

  function toggleIngredient(id: string, name?: string) {
    setSelectedIngredientIds(current => {
      if (current.includes(id)) return current.filter(value => value !== id)
      return [...current, id]
    })
    if (name) {
      setSelectedIngredientNames(current => {
        const next = { ...current }
        if (selectedIngredientIds.includes(id)) delete next[id]
        else next[id] = name
        return next
      })
    }
    setSelectionMode(true)
  }

  async function findRecipes() {
    if (!selectedIngredientIds.length && !selectedKeys.length) return
    try {
      setSearching(true)
      setError(null)
      const response = await fetch('/api/anti-gaspi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedLabels: Object.values(selectedIngredientNames), selectedIngredientIds: selectedIngredientIds.length ? selectedIngredientIds : undefined, selectedKeys }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Impossible de rechercher les recettes.')
      setSuggestions(data.recipes ?? [])
      setSelectionMode(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de recherche.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Anti-Gaspi</p>
        <h1 className="mt-1 text-3xl font-black">🍽️ Qu’est-ce qu’on mange ce soir ?</h1>
        <p className="mt-2 max-w-3xl text-slate-500">Mealio peut vous proposer des recettes à partir des produits urgents, ou chercher des recettes proches des produits que vous choisissez vous-même.</p>

        {loading && <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">Analyse du stock…</div>}
        {error && <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div>}

        {!loading && !error && (
          <>
            <section className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-lg font-black">⏰ Produits à utiliser rapidement</h2>
              {urgentStock.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">Aucun produit avec une péremption dans les 3 prochains jours n’a été trouvé.</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {urgentStock.map(item => {
                    const selected = selectedKeys.includes(stockKey(item))
                    return (
                      <button
                        key={stockKey(item)}
                        type="button"
                        onClick={() => toggleSelection(item)}
                        className={`rounded-full px-3 py-2 text-sm font-semibold shadow-sm transition ${selected ? 'bg-emerald-600 text-white' : 'bg-white text-slate-800 hover:bg-emerald-50'}`}
                        title={selected ? 'Retirer des produits sélectionnés' : 'Ajouter aux produits pour trouver des recettes'}
                      >
                        {selected ? '✓ ' : ''}{item.produit} · {item.qte} {item.unite} · {item.date_peremption}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="mt-7 rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="text-2xl font-black">🧺 Choisir mes produits</h2>
                  <p className="mt-1 text-sm text-slate-500">Sélectionnez un ou plusieurs produits de votre stock. Mealio cherchera les recettes qui en utilisent le plus possible, y compris via les équivalences connues du Matcher.</p>
                </div>
                <button type="button" onClick={() => setSelectionMode(current => !current)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-black hover:bg-slate-50">
                  {selectionMode ? 'Masquer le choix' : 'Choisir des produits'}
                </button>
              </div>

              {selectionMode && (
                <>
                  <div className="mt-5 flex flex-col gap-3 md:flex-row">
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un produit dans mon stock…" className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 outline-none focus:border-emerald-500" />
                    <button type="button" onClick={clearSelection} disabled={!selectedKeys.length && !selectedIngredientIds.length} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40">Effacer</button>
                  </div>

                  {(selectedIngredientIds.length > 0 || selectedKeys.length > 0) && (
                    <div className="mt-4 rounded-xl bg-emerald-50 p-4">
                      <div className="text-sm font-black text-emerald-900">
                        Produits sélectionnés · {selectedIngredientIds.length + selectedKeys.length}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedKeys.map(key => {
                          const item = stock.find(stockItem => stockKey(stockItem) === key)
                          if (!item) return null
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => toggleSelection(item)}
                              className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-emerald-800 shadow-sm hover:bg-emerald-100"
                              aria-label={`Retirer ${item.produit}`}
                            >
                              {item.produit} <span aria-hidden="true">✕</span>
                            </button>
                          )
                        })}

                        {selectedIngredientIds.map(id => {
                          const name = selectedIngredientNames[id] ?? ingredientResults.find(result => result.id === id)?.nom ?? id
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleIngredient(id, selectedIngredientNames[id])}
                              className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-emerald-800 shadow-sm hover:bg-emerald-100"
                              aria-label={`Retirer ${name}`}
                            >
                              {name} <span aria-hidden="true">✕</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 text-xs font-semibold text-slate-400">
                    {search.trim() ? `${ingredientResults.length} ingrédient${ingredientResults.length > 1 ? 's' : ''} trouvé${ingredientResults.length > 1 ? 's' : ''}` : 'Tapez un ingrédient : poulet, courgettes, tomate…'}
                  </div>

                  {search.trim() && (
                    <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-100">
                      {ingredientResults.length === 0 ? (
                        <div className="p-5 text-sm text-slate-500">Aucun ingrédient correspondant dans le référentiel Mealio.</div>
                      ) : ingredientResults.map(item => {
                        const selected = selectedIngredientIds.includes(item.id)
                        return (
                          <button key={item.id} type="button" onClick={() => toggleIngredient(item.id, item.nom)} className={`flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left last:border-0 ${selected ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}>
                            <span>
                              <span className="block font-bold">{selected ? '✓ ' : ''}{item.nom}</span>
                              <span className="text-xs text-slate-400">{item.inStock ? ` · Stock : ${item.stockLabels.join(', ')}` : ' · Pas actuellement en stock'}{item.recipeCount ? ` · ${item.recipeCount} recette${item.recipeCount > 1 ? 's' : ''} Cookiwiki` : ''}</span>
                            </span>
                            <span className="text-xs font-bold text-emerald-700">{selected ? 'Sélectionné' : 'Ajouter'}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <button type="button" onClick={findRecipes} disabled={(!selectedIngredientIds.length && !selectedKeys.length) || searching} className="mt-5 min-h-12 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-40">
                    {searching ? 'Recherche des recettes dans Cookiwiki…' : `🔎 Trouver les recettes proches${selectedIngredientIds.length ? ` (${selectedIngredientIds.length})` : ''}`}
                  </button>
                </>
              )}
            </section>

            <section className="mt-7">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{selectedIngredientIds.length ? 'Recettes proches de ma sélection' : 'Mes idées pour ce soir'}</h2>
                  <p className="mt-1 text-sm text-slate-500">{selectedKeys.length ? 'Les recettes sont classées selon le nombre de produits sélectionnés qu’elles permettent de valoriser.' : 'Les recettes sont classées selon les produits urgents qu’elles permettent d’utiliser.'}</p>
                </div>
                <Link href="/planning" className="rounded-xl border bg-white px-4 py-2 text-sm font-bold hover:bg-stone-50">Voir le planning</Link>
              </div>

              {suggestions.length === 0 ? (
                <div className="mt-5 rounded-2xl border bg-white p-6 text-slate-500">Je n’ai pas trouvé de recette correspondant aux produits sélectionnés avec les ingrédients actuellement référencés.</div>
              ) : (
                <div className="mt-5 grid gap-5 md:grid-cols-3">
                  {suggestions.map(recipe => (
                    <article key={recipe.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                      {recipe.image_url ? <img src={recipe.image_url} alt="" className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-stone-100 text-5xl">🍽️</div>}
                      <div className="p-5">
                        <h3 className="text-lg font-black">{recipe.nom}</h3>
                        {recipe.description && <p className="mt-2 text-sm text-slate-500">{recipe.description}</p>}
                        <p className="mt-4 text-sm font-semibold text-emerald-700">Utilise : {((Array.isArray(recipe.matchedProducts) ? recipe.matchedProducts : Array.isArray(recipe.urgentProducts) ? recipe.urgentProducts : [])).join(', ') || 'Aucun produit identifié'}</p>
                        <p className="mt-2 text-xs text-slate-400">{recipe.prep_time + recipe.cook_time > 0 ? `${recipe.prep_time + recipe.cook_time} min` : 'Temps non renseigné'}</p>
                        <a
                          href={`https://cooki-wiki.vercel.app/recette/${encodeURIComponent(recipe.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50"
                        >
                          📖 Voir la recette dans Cookiwiki
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
