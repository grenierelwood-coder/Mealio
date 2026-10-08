'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Ingredient = { id: string; nom: string; unite_reference?: string | null }
export default function MatcherCorrectionPage() {
  const [name, setName] = useState(''), [target, setTarget] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [saving, setSaving] = useState(false), [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [filter, setFilter] = useState('')
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const raw = query.get('name') || ''
    setName(raw)
    void fetch('/api/admin/ingredients', { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Chargement impossible.')
      setIngredients(data.ingredients || [])
      setTarget(query.get('ingredient_id') || data.ingredients?.find((i: Ingredient) => i.nom.toLowerCase() === (query.get('target_name') || raw).toLowerCase())?.id || '')
      setLoaded(true)
    }).catch(err => setError(err.message))
  }, [])
  async function save() {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/matcher/association', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ingredient_id: target }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Enregistrement impossible.')
      setMessage(`Association enregistrée avec ${data.ingredient}. Retourne aux Courses et régénère. Le singulier/pluriel est reconnu ; une conversion d’unité reste indépendante.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Enregistrement impossible.') }
    finally { setSaving(false) }
  }
  const chosen = ingredients.find(i => i.id === target)
  const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
  const alreadyOfficial=Boolean(chosen&&key(chosen.nom)===key(name))
  return <main className="mx-auto max-w-2xl px-4 py-6 pb-24 text-slate-900">
    <Link href="/admin/integration#corrections" className="mb-4 inline-block font-bold text-emerald-700">← Retour à la liste des corrections</Link><h1 className="text-2xl font-black">Corriger une correspondance</h1>
    <p className="mt-2 text-sm text-slate-600">Choisis l’ingrédient désigné par ce libellé. L’association sera conservée dans le référentiel partagé et réutilisée pour les prochains achats.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    <label className="mt-5 block font-bold">Libellé à reconnaître<input value={name} onChange={e => { setName(e.target.value); setMessage('') }} className="mt-1 min-h-12 w-full rounded-xl border p-3" /></label>
    <details className="mt-4"><summary className="cursor-pointer text-sm font-bold">Chercher un autre ingrédient (facultatif)</summary><p className="mt-2 text-sm text-slate-600">Ce champ filtre la liste ci-dessous. Laisse-le vide si la proposition convient.</p><label className="mt-3 block font-bold">Rechercher l’ingrédient officiel<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Ex. saucisse" className="mt-1 min-h-12 w-full rounded-xl border p-3" /></label></details>
    <label className="mt-4 block font-bold">Ingrédient officiel<select disabled={!loaded || saving} value={target} onChange={e => { setTarget(e.target.value); setMessage('') }} className="mt-1 min-h-12 w-full rounded-xl border bg-white p-3">
      <option value="">Choisir un ingrédient…</option>
      {ingredients.filter(i => i.id === target || i.nom.toLocaleLowerCase('fr').includes(filter.toLocaleLowerCase('fr'))).map(i => <option key={i.id} value={i.id}>{i.nom}</option>)}
    </select></label>
    {chosen && <p className="mt-2 text-sm text-slate-600">Unité de référence : {chosen.unite_reference || 'Non renseignée'}</p>}
    {alreadyOfficial?<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm">Ce nom désigne déjà cet ingrédient officiel. Aucune nouvelle association à enregistrer. Revenir au test pour actualiser le diagnostic ; les unités et le stock se vérifient séparément.</p>:<button disabled={saving || !loaded || !target || !name.trim()} onClick={() => void save()} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer cette association'}</button>}
    <p className="mt-4 text-sm text-slate-600">Une association de nom ne crée pas de conversion. Pour un poids moyen ou une unité, ouvre la fiche de l’ingrédient dans Admin.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Link href={`/admin/ingredients?ingredient_id=${encodeURIComponent(target)}&search=${encodeURIComponent(chosen?.nom || name)}`} className="min-h-11 rounded-xl border px-3 py-3 font-bold">Unités et poids moyens →</Link>
      <Link href="/courses" className="min-h-11 rounded-xl border px-3 py-3 font-bold">Retour aux Courses</Link>
    </div>
  </main>
}
