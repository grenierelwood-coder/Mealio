'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

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
}

type StockResponse = {
  username: string
  items: StockItem[]
  frosti: StockItem[]
  cellio: StockItem[]
  total: number
  error?: string
}

export default function StockPage() {
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadStock()
  }, [])

  async function loadStock() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/stock', {
        method: 'GET',
        cache: 'no-store',
      })

      const data: StockResponse = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du chargement du stock.')
      }

      setItems(data.items || [])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erreur lors du chargement du stock.'
      )
    } finally {
      setLoading(false)
    }
  }

  const frostiItems = items.filter(
    item => item.source === 'frosti'
  )

  const cellioItems = items.filter(
    item => item.source === 'cellio'
  )

  return (
    <main className="min-h-screen bg-stone-50">

      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-slate-900">
              ❄️ Stocks Frosti + Cellio
            </h1>

            <p className="mt-2 text-slate-500">
              Vue du stock du foyer.
            </p>
          </div>

          <button
            type="button"
            onClick={loadStock}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Actualisation…' : '↻ Actualiser'}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            <div className="font-semibold">
              Erreur
            </div>

            <div className="mt-1 text-sm">
              {error}
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-6 rounded-2xl border bg-white p-8 text-center text-slate-500">
            Chargement du stock…
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border bg-white p-5">
                <div className="text-sm font-semibold text-slate-500">
                  Total
                </div>

                <div className="mt-1 text-3xl font-black text-slate-900">
                  {items.length}
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  articles dans le foyer
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-5">
                <div className="text-sm font-semibold text-slate-500">
                  ❄️ Frosti
                </div>

                <div className="mt-1 text-3xl font-black text-slate-900">
                  {frostiItems.length}
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  congélateurs et frigos
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-5">
                <div className="text-sm font-semibold text-slate-500">
                  🍷 Cellio
                </div>

                <div className="mt-1 text-3xl font-black text-slate-900">
                  {cellioItems.length}
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  caves et réserves
                </div>
              </div>
            </div>

            <div className="mt-8 overflow-hidden rounded-2xl border bg-white">
              <div className="grid grid-cols-[1fr_120px_110px_100px] border-b bg-stone-50 px-5 py-3 text-xs font-bold uppercase tracking-wider text-stone-400">
                <span>Produit</span>
                <span>Quantité</span>
                <span>Catégorie</span>
                <span>Source</span>
              </div>

              {items.map(item => (
                <div
                  key={`${item.source}-${item.id}`}
                  className="grid grid-cols-[1fr_120px_110px_100px] border-b px-5 py-3 last:border-0"
                >
                  <div>
                    <div className="font-medium text-slate-900">
                      {item.produit}
                    </div>

                    {item.date_peremption && (
                      <div className="mt-1 text-xs text-slate-400">
                        Péremption : {item.date_peremption}
                      </div>
                    )}
                  </div>

                  <span className="text-slate-700">
                    {item.qte} {item.unite}
                  </span>

                  <span className="text-sm text-slate-500">
                    {item.categorie}
                  </span>

                  <span className="text-sm font-semibold">
                    {item.source === 'frosti' ? '❄️ Frosti' : '🍷 Cellio'}
                  </span>
                </div>
              ))}

              {!items.length && (
                <div className="p-10 text-center text-slate-500">
                  Aucun article dans le stock.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}