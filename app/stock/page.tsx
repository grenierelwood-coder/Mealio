'use client'

import { useEffect, useMemo, useState } from 'react'

type StockItem = {
  id: string
  produit: string
  qte: number
  unite: string
  categorie: string
  source: 'frosti' | 'cellio'
  date_entree?: string | null
  date_peremption?: string | null
  notes?: string | null
  location_id?: string | null
  location_name?: string | null
  location_is_fridge?: boolean | null
  location_is_secondary?: boolean | null
}

type StockLocation = {
  id: string
  name: string
  source: 'frosti' | 'cellio'
  is_fridge?: boolean | null
  is_secondary?: boolean | null
}

type StockResponse = {
  username: string
  items: StockItem[]
  frosti: StockItem[]
  cellio: StockItem[]
  locations: StockLocation[]
  total: number
  error?: string
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export default function StockPage() {
  const [items, setItems] = useState<StockItem[]>([])
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | 'frosti' | 'cellio'>('all')
  const [locationId, setLocationId] = useState('all')
  const [category, setCategory] = useState('all')

  useEffect(() => { void loadStock() }, [])

  async function loadStock() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/stock', { method: 'GET', cache: 'no-store' })
      const data: StockResponse = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erreur lors du chargement du stock.')
      setItems(data.items || [])
      setLocations(data.locations || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement du stock.')
    } finally {
      setLoading(false)
    }
  }

  const categories = useMemo(() => {
    return Array.from(new Set(items.map(item => item.categorie?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'fr'))
  }, [items])

  const visibleLocations = useMemo(() => {
    return locations.filter(location => source === 'all' || location.source === source)
  }, [locations, source])

  const filteredItems = useMemo(() => {
    const needle = normalizeSearch(search)
    return items.filter(item => {
      const matchesSearch = !needle || normalizeSearch(item.produit).includes(needle)
      const matchesSource = source === 'all' || item.source === source
      const matchesLocation = locationId === 'all' || item.location_id === locationId
      const matchesCategory = category === 'all' || item.categorie === category
      return matchesSearch && matchesSource && matchesLocation && matchesCategory
    })
  }, [items, search, source, locationId, category])

  function changeSource(value: 'all' | 'frosti' | 'cellio') {
    setSource(value)
    setLocationId('all')
  }

  const frostiCount = items.filter(item => item.source === 'frosti').length
  const cellioCount = items.filter(item => item.source === 'cellio').length

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-slate-900">❄️ Stocks Frosti + Cellio</h1>
            <p className="mt-2 text-slate-500">Recherche et consultation du stock du foyer, par produit, emplacement et catégorie.</p>
          </div>
          <button type="button" onClick={loadStock} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? 'Actualisation…' : '↻ Actualiser'}
          </button>
        </div>

        {error && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"><div className="font-semibold">Erreur</div><div className="mt-1 text-sm">{error}</div></div>}

        {!loading && !error && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border bg-white p-5"><div className="text-sm font-semibold text-slate-500">Résultat</div><div className="mt-1 text-3xl font-black">{filteredItems.length}</div><div className="mt-1 text-xs text-slate-400">articles correspondant aux filtres</div></div>
              <div className="rounded-2xl border bg-white p-5"><div className="text-sm font-semibold text-slate-500">❄️ Frosti</div><div className="mt-1 text-3xl font-black">{frostiCount}</div><div className="mt-1 text-xs text-slate-400">articles dans le foyer</div></div>
              <div className="rounded-2xl border bg-white p-5"><div className="text-sm font-semibold text-slate-500">🍷 Cellio</div><div className="mt-1 text-3xl font-black">{cellioCount}</div><div className="mt-1 text-xs text-slate-400">articles dans le foyer</div></div>
            </div>

            <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-black text-slate-900">🔎 Rechercher dans le stock</h2><p className="mt-1 text-xs text-slate-500">Tu peux combiner tous les filtres.</p></div>
                <button type="button" onClick={() => { setSearch(''); setSource('all'); setLocationId('all'); setCategory('all') }} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Réinitialiser</button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Produit…" className="rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                <select value={source} onChange={event => changeSource(event.target.value as 'all' | 'frosti' | 'cellio')} className="rounded-xl border px-3 py-2.5 text-sm"><option value="all">Tous les stocks</option><option value="frosti">❄️ Frosti</option><option value="cellio">🍷 Cellio</option></select>
                <select value={locationId} onChange={event => setLocationId(event.target.value)} className="rounded-xl border px-3 py-2.5 text-sm"><option value="all">Tous les emplacements</option>{visibleLocations.map(location => <option key={`${location.source}-${location.id}`} value={location.id}>{location.source === 'frosti' ? '❄️' : '🍷'} {location.name}</option>)}</select>
                <select value={category} onChange={event => setCategory(event.target.value)} className="rounded-xl border px-3 py-2.5 text-sm"><option value="all">Toutes les catégories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select>
              </div>
            </section>

            <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="border-b bg-stone-50 px-5 py-4"><h2 className="font-black">{filteredItems.length} article{filteredItems.length > 1 ? 's' : ''}</h2></div>
              <div className="hidden grid-cols-[1.5fr_120px_150px_170px_130px] border-b bg-stone-50 px-5 py-3 text-xs font-bold uppercase tracking-wider text-stone-400 md:grid"><span>Produit</span><span>Quantité</span><span>Catégorie</span><span>Emplacement</span><span>Rangé le</span></div>
              {filteredItems.map(item => (
                <div key={`${item.source}-${item.id}`} className="border-b px-5 py-4 last:border-0 md:grid md:grid-cols-[1.5fr_120px_150px_170px_130px] md:items-center">
                  <div><div className="font-bold text-slate-900">{item.produit}</div><div className="mt-1 text-xs text-slate-400">{item.source === 'frosti' ? '❄️ Frosti' : '🍷 Cellio'}{item.date_peremption ? ` · péremption ${formatDate(item.date_peremption)}` : ''}</div></div>
                  <div className="mt-2 text-sm font-semibold md:mt-0">{item.qte} {item.unite}</div>
                  <div className="mt-2 text-sm text-slate-600 md:mt-0">{item.categorie || '—'}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-700 md:mt-0">{item.location_name || 'Emplacement inconnu'}</div>
                  <div className="mt-2 text-sm text-slate-600 md:mt-0">{formatDate(item.date_entree)}</div>
                </div>
              ))}
              {!filteredItems.length && <div className="p-10 text-center text-slate-500">Aucun article ne correspond aux filtres.</div>}
            </section>
          </>
        )}
        {loading && <div className="mt-6 rounded-2xl border bg-white p-8 text-center text-slate-500">Chargement du stock…</div>}
      </div>
    </main>
  )
}
