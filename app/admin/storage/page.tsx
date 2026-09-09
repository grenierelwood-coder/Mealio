'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import AdminHelp from '../../components/AdminHelp'

type Source = 'frosti' | 'cellio'
type Scope = 'default' | 'category' | 'ingredient'
type Mode = 'fridge' | 'freezer'

type Rule = {
  id: string
  user_id: string
  scope: Scope
  category: string | null
  ingredient_id: string | null
  location_id: string
  mode: Mode | 'any'
  priority: number
  is_active: boolean
}
type Location = { id: string; name: string; is_fridge?: boolean | null; is_secondary?: boolean | null }
type Ingredient = { id: string; nom: string; categorie: string | null }
type Data = { username: string; frosti: { rules: Rule[]; locations: Location[] }; cellio: { rules: Rule[]; locations: Location[] } }

const initialForm = { source: 'cellio' as Source, scope: 'category' as Scope, category: '', ingredient_id: '', location_id: '', mode: 'fridge' as Mode, priority: 50 }

export default function StorageAdminPage() {
  const [data, setData] = useState<Data | null>(null)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/admin/storage', { cache: 'no-store' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur de chargement.')
      setData(j)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur de chargement.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    fetch('/api/admin/storage/ingredients', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => setIngredients(Array.isArray(j?.ingredients) ? j.ingredients : [])).catch(() => {})
  }, [])

  const locations = data?.[form.source].locations ?? []
  const categories = useMemo(() => [...new Set([
    ...ingredients.map(i => i.categorie).filter((x): x is string => !!x?.trim()),
    ...(data ? [...data.frosti.rules, ...data.cellio.rules].map(r => r.category).filter((x): x is string => !!x?.trim()) : []),
  ])].sort((a, b) => a.localeCompare(b, 'fr')), [ingredients, data])

  function reset(source = form.source) {
    setEditingId(null); setForm({ ...initialForm, source, location_id: '' })
  }

  function edit(source: Source, rule: Rule) {
    setEditingId(rule.id)
    setForm({ source, scope: rule.scope, category: rule.category ?? '', ingredient_id: rule.ingredient_id ?? '', location_id: rule.location_id, mode: rule.mode === 'freezer' ? 'freezer' : 'fridge', priority: Number(rule.priority) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const r = await fetch('/api/admin/storage', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, id: editingId, priority: Number(form.priority) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur de sauvegarde.')
      await load(); reset(form.source)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur de sauvegarde.') }
    finally { setSaving(false) }
  }

  async function remove(source: Source, id: string) {
    if (!confirm('Supprimer cette règle ?')) return
    try {
      const r = await fetch('/api/admin/storage', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, id }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur de suppression.')
      await load(); if (editingId === id) reset(source)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur de suppression.') }
  }

  function locationName(source: Source, id: string) { return data?.[source].locations.find(l => l.id === id)?.name ?? 'Emplacement inconnu' }
  function description(rule: Rule) {
    if (rule.scope === 'ingredient') return ingredients.find(i => i.id === rule.ingredient_id)?.nom ?? rule.ingredient_id ?? 'Ingrédient'
    if (rule.scope === 'category') return rule.category ?? 'Catégorie'
    return rule.mode === 'fridge' ? 'Défaut — frigo' : rule.mode === 'freezer' ? 'Défaut — congélateur' : 'Défaut'
  }

  return <main className="min-h-screen bg-stone-50 text-slate-900">
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Administration</p><h1 className="mt-1 text-3xl font-black">📦 Règles de rangement</h1><p className="mt-2 max-w-3xl text-slate-500">Exception ingrédient → catégorie → défaut. Mealio choisit Frosti ou Cellio ; chaque application choisit l’emplacement physique.</p></div><div className="flex gap-2"><Link href="/admin/storage/pending" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">🧺 À ranger</Link><button onClick={load} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">↻ Actualiser</button></div></div>
      {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="mt-5">
        <AdminHelp
          title="Comprendre les règles de rangement"
          intro="Ce menu décide où Mealio range un achat. Mealio détermine d’abord l’application de stockage (Frosti ou Cellio), puis cette application choisit l’emplacement physique selon les règles disponibles."
          sections={[
            { title: '🥇 Priorité des règles', children: <p>La logique est <b>exception ingrédient → règle de catégorie → règle par défaut</b>. Une règle plus spécifique prend donc le dessus sur une règle générale.</p> },
            { title: '❄️ Frosti', children: <p>Frosti gère les produits froids. Les règles par défaut distinguent notamment le <b>frigo</b> et le <b>congélateur</b>. Les exceptions permettent de déroger au comportement général.</p> },
            { title: '🍷 Cellio', children: <p>Cellio gère les produits qui vont dans les espaces secs, réserves ou assimilés. Une règle de catégorie peut orienter un ensemble d’ingrédients vers un emplacement précis.</p> },
            { title: '🎯 Priorité numérique', children: <p>La priorité permet d’ordonner les règles lorsqu’elles sont comparées. Dans la pratique, il faut surtout conserver une hiérarchie lisible : les exceptions doivent rester plus spécifiques que les catégories et les défauts.</p> },
          ]}
          warning="Une règle de rangement agit sur les futurs rangements. Avant de modifier ou supprimer une règle, vérifie les ingrédients et catégories concernés ainsi que l’emplacement cible."
        />
      </div>

      <form onSubmit={save} className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between"><h2 className="text-lg font-black">{editingId ? 'Modifier la règle' : 'Ajouter une règle'}</h2>{editingId && <button type="button" onClick={() => reset()} className="text-sm font-semibold text-slate-500">Annuler</button>}</div>
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <label className="text-sm font-semibold">Application<select value={form.source} onChange={e => reset(e.target.value as Source)} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal"><option value="frosti">❄️ Frosti</option><option value="cellio">🍷 Cellio</option></select></label>
          <label className="text-sm font-semibold">Type<select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Scope })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal"><option value="default">Défaut</option><option value="category">Catégorie</option><option value="ingredient">Exception ingrédient</option></select></label>
          <label className="text-sm font-semibold">Emplacement<select required value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal"><option value="">Choisir…</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}{form.source === 'frosti' ? (l.is_fridge ? ' · frigo' : ' · congélo') : ''}</option>)}</select></label>
          {form.source === 'frosti' && form.scope === 'default' && <label className="text-sm font-semibold">Température<select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as Mode })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal"><option value="fridge">Frigo</option><option value="freezer">Congélateur</option></select></label>}
        </div>
        {form.scope === 'category' && <label className="mt-4 block text-sm font-semibold">Catégorie<input list="storage-categories" required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal"/><datalist id="storage-categories">{categories.map(c => <option key={c} value={c}/>)}</datalist></label>}
        {form.scope === 'ingredient' && <label className="mt-4 block text-sm font-semibold">Ingrédient officiel<select required value={form.ingredient_id} onChange={e => setForm({ ...form, ingredient_id: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal"><option value="">Choisir…</option>{ingredients.map(i => <option key={i.id} value={i.id}>{i.nom}{i.categorie ? ` · ${i.categorie}` : ''}</option>)}</select></label>}
        <div className="mt-4 flex items-end gap-4"><label className="text-sm font-semibold">Priorité<input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 w-32 rounded-xl border px-3 py-2 font-normal"/></label><button disabled={saving || loading} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Ajouter la règle'}</button></div>
      </form>
      {loading ? <div className="mt-6 rounded-2xl border bg-white p-8 text-center text-slate-500">Chargement…</div> : <div className="mt-6 grid gap-6 lg:grid-cols-2"><RuleTable title="❄️ Frosti" source="frosti" rules={data?.frosti.rules ?? []} locationName={locationName} description={description} onEdit={edit} onDelete={remove}/><RuleTable title="🍷 Cellio" source="cellio" rules={data?.cellio.rules ?? []} locationName={locationName} description={description} onEdit={edit} onDelete={remove}/></div>}
      <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900"><b>Ordre :</b> exception ingrédient → catégorie → défaut. Frosti possède deux défauts (frigo/congélo). Cellio possède un défaut unique.</div>
    </div>
  </main>
}

function RuleTable({ title, source, rules, locationName, description, onEdit, onDelete }: { title: string; source: Source; rules: Rule[]; locationName: (s: Source, id: string) => string; description: (r: Rule) => string; onEdit: (s: Source, r: Rule) => void; onDelete: (s: Source, id: string) => void }) {
  return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b bg-stone-50 px-5 py-4"><h2 className="font-black">{title}</h2></div>{rules.length === 0 ? <div className="p-6 text-sm text-slate-500">Aucune règle configurée.</div> : <div className="divide-y">{rules.map(r => <div key={r.id} className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-wider text-slate-400">{r.scope === 'ingredient' ? 'Exception' : r.scope === 'category' ? 'Catégorie' : 'Défaut'}</div><div className="mt-1 font-bold">{description(r)}</div><div className="mt-1 text-sm text-slate-500">→ {locationName(source, r.location_id)}</div><div className="mt-1 text-xs text-slate-400">Priorité {r.priority} · {r.is_active ? 'active' : 'inactive'}</div></div><div className="flex gap-2"><button onClick={() => onEdit(source, r)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Modifier</button><button onClick={() => onDelete(source, r.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">Supprimer</button></div></div></div>)}</div>}</section>
}
