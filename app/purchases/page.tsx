'use client'

import { useEffect, useMemo, useState } from 'react'

interface PurchaseEvent {
  id: string
  list_id: string
  shopping_item_id: string
  produit: string
  ingredient_id: string | null
  quantity: number
  unite: string | null
  purchased_at: string
  status: 'a_ranger' | 'range' | 'historique'
  storage: 'frosti' | 'cellio' | null
  location_name: string | null
  category: string | null
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date))
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
}

function formatTime(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export default function PurchasesPage() {
  const [events, setEvents] = useState<PurchaseEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function loadPurchases() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/purchases', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Impossible de charger l’historique.')
      setEvents(result.purchases ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger l’historique.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadPurchases() }, [])

  const categories = useMemo(() => Array.from(new Set(events.map(event => event.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'fr')), [events])

  const filteredEvents = useMemo(() => {
    const needle = normalizeSearch(search)
    return events.filter(event => {
      const matchesProduct = !needle || normalizeSearch(event.produit).includes(needle)
      const matchesCategory = category === 'all' || event.category === category
      const purchaseDate = event.purchased_at.slice(0, 10)
      const matchesFrom = !dateFrom || purchaseDate >= dateFrom
      const matchesTo = !dateTo || purchaseDate <= dateTo
      return matchesProduct && matchesCategory && matchesFrom && matchesTo
    })
  }, [events, search, category, dateFrom, dateTo])

  const groups = useMemo(() => {
    const map = new Map<string, PurchaseEvent[]>()
    for (const event of filteredEvents) {
      const key = new Date(event.purchased_at).toLocaleDateString('fr-FR')
      const list = map.get(key) ?? []
      list.push(event)
      map.set(key, list)
    }
    return Array.from(map.entries())
  }, [filteredEvents])

  function resetFilters() {
    setSearch('')
    setCategory('all')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto w-full max-w-6xl px-3 pb-16 pt-5 sm:px-5 sm:pt-7">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Mealio</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight">🧾 Historique des achats</h1>
            <p className="mt-1 text-sm text-slate-500">Recherche par produit, catégorie et période.</p>
          </div>
          <button type="button" onClick={loadPurchases} disabled={loading} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">↻ Actualiser</button>
        </header>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-black">🔎 Rechercher dans les achats</h2><p className="mt-1 text-xs text-slate-500">Les filtres peuvent être combinés.</p></div>
            <button type="button" onClick={resetFilters} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Réinitialiser</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Produit…" className="rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
            <select value={category} onChange={event => setCategory(event.target.value)} className="rounded-xl border px-3 py-2.5 text-sm"><option value="all">Toutes les catégories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select>
            <label className="text-xs font-semibold text-slate-500">Du<input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900" /></label>
            <label className="text-xs font-semibold text-slate-500">Au<input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900" /></label>
          </div>
          <div className="mt-3 text-xs text-slate-400">{filteredEvents.length} achat{filteredEvents.length > 1 ? 's' : ''} correspondant aux filtres.</div>
        </section>

        {loading && <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">Chargement…</div>}
        {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {!loading && !error && filteredEvents.length === 0 && <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Aucun achat ne correspond aux filtres.</div>}

        <div className="mt-6 space-y-5">
          {groups.map(([day, dayEvents]) => (
            <section key={day} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="font-black capitalize text-slate-900">{formatDate(dayEvents[0].purchased_at)}</h2>
              <div className="mt-3 divide-y divide-slate-100">
                {dayEvents.map(event => (
                  <div key={event.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-bold">{event.produit}</div>
                      <div className="text-xs text-slate-500">{formatTime(event.purchased_at)} · {formatShortDate(event.purchased_at)} · {event.category || 'Sans catégorie'} · {event.status === 'range' ? '✓ rangé' : event.status === 'a_ranger' ? '⚠ acheté, rangement à faire' : 'historique'}</div>
                    </div>
                    <div className="text-sm font-black">
                      {formatNumber(Number(event.quantity))} {event.unite ?? ''}
                      {event.location_name && <span className="ml-2 font-semibold text-slate-500">→ {event.storage === 'frosti' ? '❄️ Frosti' : '🍷 Cellio'} · {event.location_name}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
