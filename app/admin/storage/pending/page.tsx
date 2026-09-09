'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import AdminHelp from '../../../components/AdminHelp'

type PendingRow = {
  issue: {
    id: string
    list_id: string
    shopping_item_id: string
    produit: string
    unit: string | null
    message: string
    resolution_hint: string | null
    created_at: string | null
  }
  item: {
    id: string
    produit: string
    ingredient_id: string | null
    qte: number | null
    qte_achetee: number | null
    stock_stored_quantity: number | null
    unite: string | null
  }
  ingredient: {
    id: string
    nom: string
    categorie: string | null
    default_storage: string | null
  } | null
  list: { id: string; name: string; period_start: string | null; period_end: string | null } | null
  stored_quantity: number
  bought_quantity: number
}

type Processed = {
  issue_id: string
  ok: boolean
  produit: string
  message: string
  destination?: { storage: 'frosti' | 'cellio'; location_name: string; rule_label: string }
}

function prettyDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('fr-FR')
}

function prettyNumber(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

export default function PendingStoragePage() {
  const [rows, setRows] = useState<PendingRow[]>([])
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<Processed[]>([])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/storage/pending', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Impossible de charger les articles à ranger.')
      setUsername(data.username || '')
      setRows(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function retry(issueId?: string) {
    const key = issueId || 'all'
    setRunning(key)
    setError('')
    setMessage('')
    setResults([])
    try {
      const response = await fetch('/api/admin/storage/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issueId ? { issueId } : {}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Impossible de relancer le rangement.')
      setMessage(data.message || 'Traitement terminé.')
      setResults(Array.isArray(data.processed) ? data.processed : [])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du relancement.')
    } finally {
      setRunning(null)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Administration · foyer {username || '—'}</p>
            <h1 className="mt-1 text-3xl font-black">🧺 Articles à ranger</h1>
            <p className="mt-2 max-w-3xl text-slate-500">Les achats qui n’ont pas pu être rangés automatiquement sont conservés ici. Après correction des règles, relance le même moteur de rangement.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/storage" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">← Règles de rangement</Link>
            <button onClick={() => retry()} disabled={running !== null || rows.length === 0} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {running === 'all' ? 'Relancement…' : '🔄 Relancer tout'}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <AdminHelp
            title="Comment fonctionne le rangement différé ?"
            intro="Un article non rangé pendant la clôture des courses n’est pas perdu. Il reste dans cette file d’attente jusqu’à ce qu’une règle ou une donnée nécessaire soit corrigée."
            sections={[
              { title: '🔒 Même moteur', children: <p>Le bouton « Relancer » appelle <b>exactement le moteur existant</b> <code>resolveStorageLocation()</code>. Cette page ne recopie aucune règle de rangement.</p> },
              { title: '✏️ Corriger puis relancer', children: <p>Corrige d’abord la règle dans <b>Admin → Règles de rangement</b>, puis relance l’article. Si une règle est maintenant applicable, l’article est créé dans le bon stock et disparaît de cette file.</p> },
              { title: '🔄 Relancer tout', children: <p>Le bouton traite tous les articles encore en attente. Les articles qui restent impossibles à ranger restent visibles avec leur dernier motif.</p> },
              { title: '🛡️ Pas de doublon', children: <p>Chaque transfert utilise le même mécanisme d’opération idempotente que le rangement normal. Une relance ne doit pas créer deux fois le même stock.</p> },
            ]}
            warning="Cette page ne modifie pas les règles de fonctionnement du rangement. Elle permet uniquement de rejouer le rangement après correction des données ou des règles."
          />
        </div>

        {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {message && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}

        {results.length > 0 && (
          <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-black">Résultat du dernier traitement</h2>
            <div className="mt-3 space-y-2">
              {results.map(result => (
                <div key={result.issue_id} className={`rounded-xl border p-3 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <b>{result.ok ? '✓' : '⚠️'} {result.produit}</b> · {result.message}
                  {result.destination && <span className="ml-1 text-slate-600">({result.destination.storage} · {result.destination.location_name} · {result.destination.rule_label})</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="mt-6 rounded-2xl border bg-white p-10 text-center text-slate-500">Chargement…</div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <div className="text-4xl">✓</div>
            <h2 className="mt-3 text-xl font-black text-emerald-900">Aucun article en attente</h2>
            <p className="mt-2 text-sm text-emerald-800">Tous les achats connus du foyer ont été rangés, ou aucune anomalie de rangement n’est actuellement ouverte.</p>
          </div>
        ) : (
          <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-stone-50 px-5 py-4">
              <div>
                <h2 className="font-black">{rows.length} article{rows.length > 1 ? 's' : ''} en attente</h2>
                <p className="mt-1 text-xs text-slate-500">Ces articles proviennent des rangements échoués lors des courses.</p>
              </div>
              <button onClick={() => void load()} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold">↻ Actualiser</button>
            </div>
            <div className="divide-y">
              {rows.map(row => (
                <article key={row.issue.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black">{row.item.produit}</h3>
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">À ranger</span>
                      </div>
                      <div className="mt-2 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                        <div><span className="text-xs uppercase text-slate-400">Acheté</span><br/><b>{prettyNumber(row.bought_quantity)} {row.item.unite || row.issue.unit || 'pièce(s)'}</b></div>
                        <div><span className="text-xs uppercase text-slate-400">Déjà rangé</span><br/><b>{prettyNumber(row.stored_quantity)} {row.item.unite || row.issue.unit || 'pièce(s)'}</b></div>
                        <div><span className="text-xs uppercase text-slate-400">Ingrédient officiel</span><br/><b>{row.ingredient?.nom || 'Non associé'}</b></div>
                      </div>
                      {row.list && <p className="mt-2 text-xs text-slate-400">Liste : {row.list.name} · problème enregistré le {prettyDate(row.issue.created_at)}</p>}
                    </div>
                    <button onClick={() => retry(row.issue.id)} disabled={running !== null} className="shrink-0 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                      {running === row.issue.id ? 'Relancement…' : '🔄 Relancer'}
                    </button>
                  </div>

                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <div className="font-bold">Pourquoi il n’a pas été rangé ?</div>
                    <div className="mt-1">{row.issue.message}</div>
                    {row.issue.resolution_hint && <div className="mt-2 text-xs text-amber-800">💡 {row.issue.resolution_hint}</div>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
