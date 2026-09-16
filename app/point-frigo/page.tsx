'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type StockItem = {
  id: string
  produit: string
  qte: number
  unite: string
  categorie: string
  source: 'frosti' | 'cellio'
}

export default function PointFrigoPage() {
  const [items, setItems] = useState<StockItem[]>([])
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setLoading(true)
      const response = await fetch('/api/point-frigo', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Impossible de charger le stock.')
      const loaded = data.items ?? []
      setItems(loaded)
      setDraft(Object.fromEntries(loaded.map((item: StockItem) => [key(item), item.qte])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function key(item: StockItem) { return `${item.source}:${item.id}` }

  function change(item: StockItem, delta: number) {
    setDraft(current => ({
      ...current,
      [key(item)]: Math.max(0, Number((current[key(item)] ?? item.qte) + delta)),
    }))
    setMessage(null)
  }

  function setValue(item: StockItem, value: string) {
    const parsed = Number(value.replace(',', '.'))
    if (!Number.isFinite(parsed)) return
    setDraft(current => ({ ...current, [key(item)]: Math.max(0, parsed) }))
    setMessage(null)
  }

  const changed = useMemo(() => items.filter(item => draft[key(item)] !== item.qte), [items, draft])

  async function save() {
    if (!changed.length) {
      setMessage('Aucune correction à enregistrer.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const response = await fetch('/api/point-frigo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: changed.map(item => ({ id: item.id, source: item.source, qte: draft[key(item)] })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Impossible d’enregistrer le point frigo.')
      setItems(current => current.map(item => ({ ...item, qte: draft[key(item)] ?? item.qte })))
      setMessage(`${changed.length} article(s) mis à jour.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d’enregistrement.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Stock</p>
            <h1 className="mt-1 text-3xl font-black">🧊 Point Frigo</h1>
            <p className="mt-2 max-w-3xl text-slate-500">Un contrôle rapide du stock réel du foyer. Corrige les quantités puis valide en une fois.</p>
          </div>
          <Link href="/stock" className="rounded-xl border bg-white px-4 py-2 text-sm font-bold hover:bg-stone-50">Retour au stock</Link>
        </div>

        {loading && <div className="mt-7 rounded-2xl bg-white p-6 shadow-sm">Chargement du stock…</div>}
        {error && <div className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div>}
        {message && <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">{message}</div>}

        {!loading && !error && (
          <>
            <div className="mt-7 overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b bg-stone-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">
                <span>Produit</span><span>Base</span><span>Quantité réelle</span>
              </div>
              {items.map(item => (
                <div key={key(item)} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b px-5 py-4 last:border-0">
                  <div>
                    <div className="font-bold">{item.produit}</div>
                    <div className="text-xs text-slate-400">{item.categorie || 'Sans catégorie'} · {item.unite}</div>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-slate-500">{item.source === 'frosti' ? 'Frosti' : 'Cellio'}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => change(item, -1)} className="h-9 w-9 rounded-lg border font-bold hover:bg-stone-50">−</button>
                    <input value={draft[key(item)] ?? item.qte} onChange={event => setValue(item, event.target.value)} className="h-9 w-20 rounded-lg border text-center font-bold" inputMode="decimal" />
                    <button onClick={() => change(item, 1)} className="h-9 w-9 rounded-lg border font-bold hover:bg-stone-50">+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-4 mt-5 flex items-center justify-between gap-4 rounded-2xl border bg-white p-4 shadow-lg">
              <span className="text-sm text-slate-500">{changed.length} modification(s) en attente</span>
              <button disabled={saving || !changed.length} onClick={save} className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40">
                {saving ? 'Enregistrement…' : '✓ Valider le point frigo'}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
