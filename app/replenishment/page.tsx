'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AdminHelp from '../components/AdminHelp'

type Ingredient = { id: string; nom: string; categorie: string | null }
type Favorite = { ingredient_id: string; nom: string; categorie: string | null; purchase_count: number; unite: string }
type UnitOption = { unite: string; abreviation: string; type_unite: string }
type Threshold = { id: string; ingredient_id: string; min_quantity: number; target_quantity: number; unite: string; active: boolean }
type Recurring = { id: string; ingredient_id: string | null; produit: string; quantity: number; unite: string; rayon: string | null; interval_days: number; next_due_date: string; mode: 'suggestion' | 'systematic'; active: boolean }
type Suggestion = { key: string; source: 'threshold' | 'recurring'; rule_id: string; ingredient_id: string | null; produit: string; quantity: number; unite: string; reason: string; mode: 'suggestion' | 'systematic' }

function formatNumber(value: unknown) {
  const x = Number(value)
  return Number.isInteger(x) ? String(x) : String(Number(x.toFixed(2)))
}

export default function ReplenishmentPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [thresholds, setThresholds] = useState<Threshold[]>([])
  const [recurring, setRecurring] = useState<Recurring[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [thresholdIngredient, setThresholdIngredient] = useState('')
  const [thresholdUnit, setThresholdUnit] = useState('Pièce')
  const [thresholdMin, setThresholdMin] = useState('1')
  const [thresholdTarget, setThresholdTarget] = useState('2')

  const [recProduct, setRecProduct] = useState('')
  const [recIngredient, setRecIngredient] = useState('')
  const [recUnit, setRecUnit] = useState('Pièce')
  const [recQty, setRecQty] = useState('1')
  const [recInterval, setRecInterval] = useState('7')
  const [recDate, setRecDate] = useState('')
  const [recMode, setRecMode] = useState<'suggestion' | 'systematic'>('suggestion')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [r, i] = await Promise.all([
        fetch('/api/replenishment', { cache: 'no-store' }),
        fetch('/api/ingredients', { cache: 'no-store' }),
      ])
      const rd = await r.json()
      const id = await i.json()
      if (!r.ok) throw new Error(rd.error ?? 'Impossible de charger le réapprovisionnement.')
      if (!i.ok) throw new Error(id.error ?? 'Impossible de charger les ingrédients.')
      setFavorites(rd.favorites ?? [])
      setThresholds(rd.thresholds ?? [])
      setRecurring(rd.recurring ?? [])
      setSuggestions(rd.suggestions ?? [])
      setUnits(rd.units ?? [])
      setIngredients(id.ingredients ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger le réapprovisionnement.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const ingredientName = useMemo(() => new Map(ingredients.map(i => [i.id, i.nom])), [ingredients])

  async function addToCourses(s: Suggestion | Favorite) {
    setBusy(true)
    setMessage(null)
    setError(null)
    const isFavorite = 'purchase_count' in s
    try {
      const r = await fetch('/api/replenishment/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produit: s.nom ?? s.produit,
          ingredient_id: s.ingredient_id,
          quantity: isFavorite ? 1 : s.quantity,
          unite: isFavorite ? s.unite : s.unite,
          source: isFavorite ? 'favorite' : s.source,
          rule_id: isFavorite ? null : s.rule_id,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Impossible d’ajouter le produit.')
      setMessage(`✓ ${s.nom ?? s.produit} ajouté aux courses${d.merged ? ' (fusionné avec la ligne existante)' : ''}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’ajouter le produit.')
    } finally {
      setBusy(false)
    }
  }


  async function saveFavoriteUnit(ingredientId: string, unite: string) {
    setBusy(true); setError(null); setMessage(null)
    try {
      const r = await fetch('/api/replenishment/favorites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredient_id: ingredientId, unite }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Impossible d’enregistrer l’unité du favori.')
      setFavorites(current => current.map(f => f.ingredient_id === ingredientId ? { ...f, unite: d.favorite.unite } : f))
      setMessage('✓ Unité du favori mémorisée.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’enregistrer l’unité du favori.')
    } finally { setBusy(false) }
  }

  async function saveThreshold(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage(null)
    try {
      const r = await fetch('/api/replenishment/thresholds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredient_id: thresholdIngredient, unite: thresholdUnit, min_quantity: thresholdMin, target_quantity: thresholdTarget }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setMessage('✓ Seuil enregistré.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible d’enregistrer le seuil.') }
    finally { setBusy(false) }
  }

  async function deleteThreshold(id: string) {
    if (!confirm('Supprimer ce seuil ?')) return
    await fetch(`/api/replenishment/thresholds?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await load()
  }

  async function saveRecurring(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage(null)
    try {
      const r = await fetch('/api/replenishment/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produit: recProduct, ingredient_id: recIngredient || null, quantity: recQty, unite: recUnit, interval_days: recInterval, next_due_date: recDate, mode: recMode }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setRecProduct('')
      setMessage('✓ Récurrent enregistré.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible d’enregistrer le récurrent.') }
    finally { setBusy(false) }
  }

  async function deleteRecurring(id: string) {
    if (!confirm('Supprimer ce récurrent ?')) return
    await fetch(`/api/replenishment/recurring?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-600">🏠 Foyer</div>
              <h1 className="mt-1 text-3xl font-black">🛒 Réapprovisionnement intelligent</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">Un seul moteur pour les favoris, les seuils et les récurrents. Une proposition n’est jamais ajoutée silencieusement aux courses.</p>
            </div>
            <Link href="/admin" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-stone-50">⚙️ Retour Admin</Link>
          </div>
        </header>

        <AdminHelp
          title="Comprendre le réapprovisionnement"
          intro="Le réapprovisionnement prépare des propositions à partir du stock et de l’historique. Il ne crée pas une deuxième liste de courses : les ajouts rejoignent la liste active Mealio."
          sections={[
            { title: '⭐ Favoris fréquents', children: <p>Les favoris sont calculés à partir de l’historique d’achats. Le bouton <b>+1</b> sert à ajouter rapidement une unité aux courses ; un favori n’est pas une règle d’achat automatique.</p> },
            { title: '⚖️ Seuils de stock', children: <p>Un seuil définit une quantité minimale et une quantité cible. Lorsque le stock passe sous le seuil, Mealio propose la quantité nécessaire pour revenir vers la cible.</p> },
            { title: '🔁 Achats récurrents', children: <p>Un récurrent possède une fréquence et une prochaine échéance. Le mode <b>Suggestion</b> propose l’achat ; le mode <b>Ajout systématique</b> peut injecter la ligne lors de la génération des courses à échéance.</p> },
            { title: '🛒 Ajouter aux courses', children: <p>Les propositions ne constituent pas un stock parallèle. Lorsqu’on les accepte, Mealio les ajoute ou les fusionne avec la liste active selon les règles de génération.</p> },
          ]}
          warning="Un seuil ou un récurrent mal paramétré peut générer des achats répétés. Avant d’activer une règle, vérifie l’unité, la quantité cible, la fréquence et le mode choisi."
        />

        {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</div>}
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? <div className="mt-6 rounded-2xl bg-white p-6">Chargement…</div> : (
          <div className="mt-6 space-y-6">
            <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">⭐ Mes favoris fréquents</h2>
              <p className="text-sm text-slate-500">Les 15 ingrédients les plus achetés par le foyer. L’unité ci-dessous est mémorisée pour les prochains +1, puis conservée jusque dans le rangement du stock.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.length ? favorites.map(f => (
                  <div key={f.ingredient_id} className="rounded-xl bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><div className="truncate font-bold">{f.nom}</div><div className="text-xs text-slate-500">{f.purchase_count} achat{f.purchase_count > 1 ? 's' : ''}</div></div>
                      <button disabled={busy} onClick={() => addToCourses(f)} className="rounded-lg bg-white px-3 py-2 text-sm font-black shadow-sm hover:bg-amber-100">+1</button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs font-bold text-slate-600">Unité</label>
                      <select value={f.unite} disabled={busy} onChange={e => void saveFavoriteUnit(f.ingredient_id, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-sm">
                        {units.map(u => <option key={u.unite} value={u.unite}>{u.unite}{u.abreviation ? ` (${u.abreviation})` : ''}</option>)}
                      </select>
                    </div>
                  </div>
                )) : <p className="text-sm text-slate-500">Pas encore d’historique d’achats exploitable pour calculer les favoris.</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">⚠️ Propositions de réapprovisionnement</h2>
              <p className="text-sm text-slate-500">Les seuils déclenchent une proposition quand le stock est insuffisant. Les récurrents apparaissent à leur échéance.</p>
              <div className="mt-4 space-y-3">
                {suggestions.length ? suggestions.map(s => (
                  <div key={s.key} className="flex flex-col gap-3 rounded-xl bg-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><div className="font-black">{s.produit} · {formatNumber(s.quantity)} {s.unite}</div><div className="text-xs text-slate-600">{s.source === 'threshold' ? '⚖️ Seuil' : '🔁 Récurrent'} · {s.reason}</div></div>
                    <button disabled={busy} onClick={() => addToCourses(s)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">+ Ajouter aux courses</button>
                  </div>
                )) : <p className="text-sm text-slate-500">Aucune proposition pour le moment.</p>}
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-black">⚖️ Seuils de stock</h2>
                <p className="text-sm text-slate-500">Déclenche une proposition lorsque le stock passe sous le <b>seuil mini</b>, pour revenir à la <b>quantité cible</b>.</p>
                <form onSubmit={saveThreshold} className="mt-4 space-y-3">
                  <select required value={thresholdIngredient} onChange={e => setThresholdIngredient(e.target.value)} className="w-full rounded-xl border p-3"><option value="">Choisir un ingrédient…</option>{ingredients.map(i => <option key={i.id} value={i.id}>{i.nom}</option>)}</select>
                  <div className="grid grid-cols-3 gap-2"><input value={thresholdMin} onChange={e => setThresholdMin(e.target.value)} type="number" min="0" step="0.01" placeholder="Seuil mini" aria-label="Seuil mini" className="rounded-xl border p-3"/><input value={thresholdTarget} onChange={e => setThresholdTarget(e.target.value)} type="number" min="0" step="0.01" placeholder="Quantité cible" aria-label="Quantité cible" className="rounded-xl border p-3"/><input value={thresholdUnit} onChange={e => setThresholdUnit(e.target.value)} placeholder="Unité du seuil" aria-label="Unité du seuil" className="rounded-xl border p-3"/></div>
                  <button disabled={busy} className="rounded-xl bg-sky-700 px-4 py-3 font-bold text-white">Enregistrer le seuil</button>
                </form>
                <div className="mt-5 space-y-2">{thresholds.map(t => <div key={t.id} className="flex items-center justify-between rounded-xl bg-sky-50 p-3"><div className="text-sm"><b>{ingredientName.get(t.ingredient_id) ?? t.ingredient_id}</b><div className="text-slate-500">Seuil mini : {formatNumber(t.min_quantity)} {t.unite} · Cible : {formatNumber(t.target_quantity)} {t.unite}</div></div><button onClick={() => deleteThreshold(t.id)} className="text-xs font-bold text-red-600">Supprimer</button></div>)}</div>
              </section>

              <section className="rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-black">🔁 Achats récurrents</h2>
                <p className="text-sm text-slate-500">Définit quoi acheter, en quelle quantité, à quelle fréquence, à quelle échéance et selon quel mode.</p>
                <form onSubmit={saveRecurring} className="mt-4 space-y-3">
                  <input required value={recProduct} onChange={e => setRecProduct(e.target.value)} placeholder="Produit (ex. papier toilette)" className="w-full rounded-xl border p-3"/>
                  <select value={recIngredient} onChange={e => setRecIngredient(e.target.value)} className="w-full rounded-xl border p-3"><option value="">Pas de lien avec le référentiel</option>{ingredients.map(i => <option key={i.id} value={i.id}>{i.nom}</option>)}</select>
                  <div className="grid grid-cols-2 gap-2"><input value={recQty} onChange={e => setRecQty(e.target.value)} type="number" min="0.01" step="0.01" placeholder="Quantité à acheter" aria-label="Quantité à acheter" className="rounded-xl border p-3"/><input value={recUnit} onChange={e => setRecUnit(e.target.value)} placeholder="Unité d’achat" aria-label="Unité d’achat" className="rounded-xl border p-3"/></div>
                  <div className="grid grid-cols-2 gap-2"><input value={recInterval} onChange={e => setRecInterval(e.target.value)} type="number" min="1" step="1" placeholder="Fréquence (jours)" aria-label="Fréquence en jours" className="rounded-xl border p-3"/><input required value={recDate} onChange={e => setRecDate(e.target.value)} type="date" aria-label="Prochaine échéance" className="rounded-xl border p-3"/></div>
                  <select value={recMode} onChange={e => setRecMode(e.target.value as 'suggestion' | 'systematic')} className="w-full rounded-xl border p-3"><option value="suggestion">Suggestion</option><option value="systematic">Ajout systématique</option></select>
                  <button disabled={busy} className="rounded-xl bg-purple-700 px-4 py-3 font-bold text-white">Enregistrer le récurrent</button>
                </form>
                <div className="mt-5 space-y-2">{recurring.map(r => <div key={r.id} className="flex items-center justify-between rounded-xl bg-purple-50 p-3"><div className="text-sm"><b>{r.produit}</b> · {formatNumber(r.quantity)} {r.unite}<div className="text-slate-500">Fréquence : tous les {r.interval_days} jours · Prochaine échéance : {r.next_due_date} · Mode : {r.mode === 'systematic' ? 'Ajout systématique' : 'Suggestion'}</div></div><button onClick={() => deleteRecurring(r.id)} className="text-xs font-bold text-red-600">Supprimer</button></div>)}</div>
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
