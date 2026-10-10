'use client'

import Link from 'next/link'
import {stockContent} from '../utils/ecosystem-policy'
import { useEffect, useMemo, useState } from 'react'
import { matchesStockLocation, stockLocationKey, stockLocationLabel, stockLocationOptions, type StockLocation } from '../utils/stock-location-policy'

type StockItem = {
  id: string
  pantry_ingredient_id?: string | null
  almost_finished?: boolean
  produit: string
  qte: number
  unite: string
  categorie: string
  rayon?: string | null
  location_id?: string | null
  location_name?: string | null
  location_is_fridge?: boolean | null
  location_is_secondary?: boolean | null
  source: 'frosti' | 'cellio'
  date_entree?: string | null
  date_peremption?: string | null
  ingredient_name?: string|null
  content_quantity?: number|null
  content_unit?: string|null
  date_role?: string
  notes?: string | null
}

type StockResponse = {
  username: string
  items: StockItem[]
  frosti: StockItem[]
  cellio: StockItem[]
  total: number
  locations?: StockLocation[]
  error?: string
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function formatDate(value?: string | null) {
  if (!value) return null
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function daysUntil(value?: string | null) {
  if (!value) return null
  const target = new Date(`${value.slice(0, 10)}T12:00:00`).getTime()
  if (!Number.isFinite(target)) return null
  return Math.ceil((target - new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00`).getTime()) / 86400000)
}

export default function StockPage() {
  const [savingSignal, setSavingSignal] = useState<string | null>(null)
  const [items, setItems] = useState<StockItem[]>([])
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [locationsOpen, setLocationsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [rayon, setRayon] = useState('all')
  const [source, setSource] = useState<'all' | 'frosti' | 'cellio'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dateMode, setDateMode] = useState<'all' | '7' | 'expired' | 'soon'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => { void loadStock() }, [])

  async function loadStock() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/stock', { cache: 'no-store' })
      const data: StockResponse = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erreur lors du chargement du stock.')
      setItems(data.items || [])
      const options = stockLocationOptions(data.locations || [], data.items || [])
      setLocations(options)
      setSelectedLocations(selected => selected.filter(key => options.some(location => stockLocationKey(location.source, location.id) === key)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement du stock.')
    } finally {
      setLoading(false)
    }
  }

  async function signalPantry(item: StockItem) {
    if(!item.pantry_ingredient_id || savingSignal) return
    setSavingSignal(item.pantry_ingredient_id); setError('')
    try {
      const response=await fetch('/api/pantry/signals',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ingredient_id:item.pantry_ingredient_id,action:item.almost_finished?'cancel':'almost_finished'})})
      const result=await response.json()
      if(!response.ok) throw new Error(result.error || 'Signalement impossible.')
      await loadStock()
    } catch(err){setError(err instanceof Error?err.message:'Signalement impossible.')}
    finally{setSavingSignal(null)}
  }

  const rayons = useMemo(() => {
    return [...new Set(items.map(item => item.rayon?.trim()).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, 'fr'))
  }, [items])

  const categories = useMemo(() => {
    return [...new Set(items.map(item => item.categorie?.trim()).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, 'fr'))
  }, [items])

  const filteredItems = useMemo(() => {
    const q = normalize(search)
    return items.filter(item => {
      const matchesSearch = !q || normalize(`${item.produit} ${item.categorie} ${item.notes ?? ''}`).includes(q)
      const matchesCategory = category === 'all' || item.categorie === category
      const matchesRayon = rayon === 'all' || item.rayon === rayon
      const matchesSource = matchesStockLocation(item, source, selectedLocations)
      const expiration = item.date_peremption?.slice(0, 10) ?? ''
      const matchesFrom = !dateFrom || (expiration && expiration >= dateFrom)
      const matchesTo = !dateTo || (expiration && expiration <= dateTo)
      const days = daysUntil(item.date_peremption)
      const matchesMode = dateMode === 'all'
        || (dateMode === 'expired' && days !== null && days < 0)
        || (dateMode === 'soon' && days !== null && days >= 0 && days <= 3)
        || (dateMode === '7' && days !== null && days >= 0 && days <= 7)
      return matchesSearch && matchesCategory && matchesRayon && matchesSource && matchesFrom && matchesTo && matchesMode
    })
  }, [items, search, category, rayon, source, selectedLocations, dateFrom, dateTo, dateMode])

  const activeFilters = [
    category !== 'all', rayon !== 'all', source !== 'all', selectedLocations.length > 0, dateFrom !== '', dateTo !== '', dateMode !== 'all', search.trim() !== '',
  ].filter(Boolean).length

  function resetFilters() {
    setSearch('')
    setCategory('all')
    setRayon('all')
    setSource('all')
    setSelectedLocations([])
    setDateFrom('')
    setDateTo('')
    setDateMode('all')
  }

  return (
    <main className="min-h-screen bg-stone-50 pb-24 text-slate-900">
      <div className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-5 sm:py-7">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Stock du foyer</p>
            <h1 className="truncate text-2xl font-black sm:text-3xl">Stocks Frosti + Cellio</h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href="/inventaire" className="flex min-h-11 items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-800">Inventaire</Link>
            <button type="button" onClick={() => void loadStock()} disabled={loading} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 shadow-sm disabled:opacity-50" aria-label="Actualiser le stock">↻</button>
          </div>
        </div>

        <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Rechercher un produit</span>
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un produit…" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-stone-50 pl-10 pr-3 text-base font-semibold outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
            </label>
            <button type="button" onClick={() => setFiltersOpen(value => !value)} className={`min-h-12 shrink-0 rounded-2xl border px-3 text-sm font-black ${filtersOpen || activeFilters ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}>
              Filtres{activeFilters ? ` (${activeFilters})` : ''}
            </button>
          </div>

          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {([['all', 'Tous'], ['frosti', 'Frosti'], ['cellio', 'Cellio']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={source === value} onClick={() => { setSource(value); setSelectedLocations([]) }} className={`min-h-10 shrink-0 rounded-full px-4 text-xs font-black ${source === value ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>
            ))}
          </div>

          <button type="button" aria-expanded={locationsOpen} aria-controls="stock-locations" onClick={() => setLocationsOpen(value => !value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-left text-sm font-bold text-slate-700">
            📍 {selectedLocations.length ? `${selectedLocations.length} lieu(x) sélectionné(s)` : 'Tous les lieux de stockage'} · {locationsOpen ? 'Masquer' : 'Choisir'}
          </button>
          {selectedLocations.length > 0 && !locationsOpen && <p className="mt-1 break-words px-1 text-xs text-slate-600">{locations.filter(location => selectedLocations.includes(stockLocationKey(location.source, location.id))).map(stockLocationLabel).join(' · ')}</p>}
          {locationsOpen && <fieldset id="stock-locations" className="mt-2 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-bold text-slate-500">Un ou plusieurs lieux</legend>
            <button type="button" onClick={() => setSelectedLocations([])} className="mb-2 min-h-11 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700">Tous les lieux</button>
            <div className="grid gap-2 sm:grid-cols-2">
              {locations.filter(location => source === 'all' || location.source === source).map(location => {
                const key = stockLocationKey(location.source, location.id)
                return <label key={key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={selectedLocations.includes(key)} onChange={event => {
                    const checked = event.target.checked
                    setSelectedLocations(selected => checked ? [...selected, key] : selected.filter(value => value !== key))
                  }} className="h-5 w-5 shrink-0 accent-emerald-700" />
                  <span className="break-words">{stockLocationLabel(location)}</span>
                </label>
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">Sans lieu coché, tous les lieux sont affichés. Changer Frosti/Cellio réinitialise ce choix.</p>
          </fieldset>}

          {filtersOpen && (
            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
              <label className="text-xs font-black text-slate-500">Catégorie
                <select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                  <option value="all">Toutes les catégories</option>
                  {categories.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-xs font-black text-slate-500">Rayon
                <select value={rayon} onChange={e => setRayon(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                  <option value="all">Tous les rayons</option>
                  {rayons.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-xs font-black text-slate-500">Date de péremption
                <select value={dateMode} onChange={e => setDateMode(e.target.value as typeof dateMode)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                  <option value="all">Toutes les dates</option>
                  <option value="soon">Dans les 3 jours</option>
                  <option value="7">Dans les 7 jours</option>
                  <option value="expired">Déjà dépassée</option>
                </select>
              </label>
              <label className="text-xs font-black text-slate-500">Du
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700" />
              </label>
              <label className="text-xs font-black text-slate-500">Au
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700" />
              </label>
              <button type="button" onClick={resetFilters} className="min-h-11 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 sm:col-span-2">Réinitialiser les filtres</button>
            </div>
          )}
        </section>

        <div className="mt-3 flex items-center justify-between px-1 text-xs font-bold text-slate-500">
          <span>{filteredItems.length} produit{filteredItems.length > 1 ? 's' : ''}</span>
          {loading && <span>Actualisation…</span>}
        </div>

        {error && <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        {loading ? (
          <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">Chargement du stock…</div>
        ) : filteredItems.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500">Aucun produit ne correspond aux filtres.</div>
        ) : (
          <section className="mt-3 space-y-5">
            {(() => {
              const rayonOrder = ['Fruits & légumes','Boucherie','Charcuterie','Poissonnerie','Crèmerie','Boulangerie','Épicerie','Boissons','Surgelés']
              const groups = new Map<string, StockItem[]>()
              for (const item of filteredItems) {
                const key = item.rayon?.trim() || 'Rayon non défini'
                groups.set(key, [...(groups.get(key) ?? []), item])
              }
              const rank = (value: string) => {
                const index = rayonOrder.findIndex(item => item.localeCompare(value, 'fr', { sensitivity: 'base' }) === 0)
                return index >= 0 ? index : 999
              }
              return Array.from(groups.entries()).sort(([a],[b]) => {
                const ra = rank(a), rb = rank(b)
                if (ra !== rb) return ra - rb
                return a.localeCompare(b, 'fr')
              }).map(([groupRayon, groupItems]) => (
                <section key={groupRayon}>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">{groupRayon}</h2>
                    <span className="text-xs font-bold text-slate-400">{groupItems.length}</span>
                  </div>
                  <div className="space-y-2">
                    {groupItems.map(item => {
                      const days = daysUntil(item.date_peremption)
                      const urgent = days !== null && days <= 3
                      const expired = days !== null && days < 0
                      return (
                        <div key={`${item.source}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${item.source === 'frosti' ? 'bg-blue-50' : 'bg-amber-50'}`}>{item.source === 'frosti' ? '❄️' : '📦'}</div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-black text-slate-900">{item.produit}</div>
                              <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{item.pantry_ingredient_id ? (Number(item.qte)>0?'Présent':'Absent') : `${item.qte} ${item.unite}`} · {item.categorie || 'Sans catégorie'}</div>
                              <div className="mt-1 break-words text-xs font-semibold text-slate-600">📍 {item.source==='frosti' ? item.location_is_fridge===true?'Frigo · ':item.location_is_fridge===false?'Congélateur · ':'Stock froid · ' : ''}{item.location_name?.trim() || 'Lieu non renseigné'}</div>
                              {item.ingredient_name && <p className="text-xs text-slate-500">Ingrédient : {item.ingredient_name}</p>}{item.content_quantity && <p className="text-xs text-slate-500">{item.content_quantity} {item.content_unit} par unité · {stockContent(item).qte} {stockContent(item).unite} au total</p>}{item.date_peremption ? <div className={`mt-1 text-xs font-black ${expired ? 'text-red-600' : urgent ? 'text-orange-600' : 'text-emerald-700'}`}>{`${({dlc:'DLC',ddm:'DDM',apogee:'Apogée',indicative:'Date indicative'} as Record<string,string>)[item.date_role??'']??'Date de suivi'} ${formatDate(item.date_peremption)}`}</div> : <div className="mt-1 text-xs text-slate-400">Aucune date</div>}
                            </div>
                            {item.pantry_ingredient_id && Number(item.qte)>0 && <button type="button" disabled={savingSignal!==null} onClick={()=>void signalPantry(item)}
                              className={`min-h-11 max-w-32 rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${item.almost_finished?'bg-orange-100 text-orange-900':'border border-slate-300 text-slate-700'}`}>
                              {savingSignal===item.pantry_ingredient_id?'…':item.almost_finished?'Presque terminé · Annuler':'Presque terminé'}</button>}
                            <span className="shrink-0 text-lg text-slate-300">›</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))
            })()}
          </section>
        )}
      </div>
    </main>
  )
}
