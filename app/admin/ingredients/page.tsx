'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import AdminHelp from '../../components/AdminHelp'

type Ingredient = { id: string; nom: string; categorie: string | null; rayon: string | null; default_storage: 'frosti' | 'cellio' | null; default_is_fridge: boolean | null }
type Synonym = { mot_recette: string; ingredient_id: string }
type Unit = { unite: string; abreviation: string | null; type_unite: string | null; equivalence_reference: number | null; multiplicateur: number | null }
type Density = { ingredient_id: string; unite: string; poids_g_approx: number }
type Data = { ingredients: Ingredient[]; synonyms: Synonym[]; units: Unit[]; densities: Density[] }

const emptyIngredient = { nom: '', categorie: '', rayon: '', default_storage: 'cellio', default_is_fridge: false }
const emptySynonym = { mot_recette: '', ingredient_id: '' }
const emptyUnit = { unite: '', abreviation: '', type_unite: 'unité', equivalence_reference: '', multiplicateur: '1' }
const emptyDensity = { ingredient_id: '', unite: '', poids_g_approx: '' }

export default function IngredientsAdminPage() {
  const [data, setData] = useState<Data>({ ingredients: [], synonyms: [], units: [], densities: [] })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ingredient, setIngredient] = useState<any>(emptyIngredient)
  const [synonym, setSynonym] = useState<any>(emptySynonym)
  const [unit, setUnit] = useState<any>(emptyUnit)
  const [density, setDensity] = useState<any>(emptyDensity)

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/admin/ingredients', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur de chargement.')
      setData(j)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur de chargement.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data.ingredients
    return data.ingredients.filter(i => `${i.nom} ${i.categorie ?? ''} ${i.rayon ?? ''}`.toLowerCase().includes(q))
  }, [data.ingredients, search])

  const ingredientName = (id: string) => data.ingredients.find(i => i.id === id)?.nom ?? id

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', body: any) {
    setSaving(true); setError('')
    try {
      const r = await fetch('/api/admin/ingredients', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur de sauvegarde.')
      await load()
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur de sauvegarde.'); return false }
    finally { setSaving(false) }
  }

  async function addIngredient(e: React.FormEvent) { e.preventDefault(); if (await mutate('POST', { entity: 'ingredient', ...ingredient })) setIngredient({ ...emptyIngredient }) }
  async function addSynonym(e: React.FormEvent) { e.preventDefault(); if (await mutate('POST', { entity: 'synonym', ...synonym })) setSynonym({ ...emptySynonym }) }
  async function addUnit(e: React.FormEvent) { e.preventDefault(); if (await mutate('POST', { entity: 'unit', ...unit })) setUnit({ ...emptyUnit }) }
  async function addDensity(e: React.FormEvent) { e.preventDefault(); if (await mutate('POST', { entity: 'density', ...density })) setDensity({ ...emptyDensity }) }

  async function remove(entity: string, body: any) {
    if (!confirm('Supprimer cette donnée ?')) return
    await mutate('DELETE', { entity, ...body })
  }

  return <main className="min-h-screen bg-stone-50 text-slate-900">
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Administration · Phase 24.1</p><h1 className="mt-1 text-3xl font-black">🥕 Référentiel ingrédients</h1><p className="mt-2 max-w-3xl text-slate-500">Ingrédients officiels, synonymes, unités et équivalences de poids. Ces données alimentent directement le Matcher et les Courses.</p></div>
        <div className="flex gap-2"><Link href="/admin/storage" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">⚙️ Rangement</Link><button onClick={load} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">↻ Actualiser</button></div>
      </div>
      {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="mt-5">
        <AdminHelp
          title="Comprendre le référentiel ingrédients"
          intro="Ce menu contient les données de référence utilisées par Mealio pour reconnaître les ingrédients et interpréter leurs quantités. Il faut le voir comme le dictionnaire commun entre Cookiwiki, le Matcher et les Courses."
          sections={[
            { title: '🥕 Ingrédients officiels', children: <p>Un ingrédient officiel est l’identité canonique utilisée par Mealio. Sa <b>catégorie</b>, son <b>rayon</b> et son stockage par défaut servent notamment au rangement et à l’organisation des courses.</p> },
            { title: '🔤 Synonymes', children: <p>Un synonyme relie un terme rencontré dans une recette à un ingrédient officiel. Par exemple, plusieurs formulations d’une même recette peuvent ainsi converger vers la même identité.</p> },
            { title: '⚖️ Unités', children: <p>Les unités décrivent comment Mealio interprète une quantité : poids, volume ou unité discrète. Les équivalences et multiplicateurs servent aux conversions déterministes du Matcher.</p> },
            { title: '🧪 Densités', children: <p>Une densité permet d’estimer un poids en grammes à partir d’une unité comme une cuillère ou une pièce lorsque cette conversion est réellement connue. Il ne faut pas inventer une densité pour forcer une conversion.</p> },
          ]}
          warning="Une modification du référentiel peut changer les rapprochements futurs et les calculs de courses. Les suppressions doivent donc être utilisées avec prudence, surtout pour un ingrédient déjà référencé ailleurs."
        />
      </div>

      <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-black">Ingrédients officiels <span className="text-sm font-normal text-slate-400">({data.ingredients.length})</span></h2><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="w-full rounded-xl border px-3 py-2 text-sm md:w-72" /></div>
        <form onSubmit={addIngredient} className="mt-4 grid gap-3 rounded-xl bg-stone-50 p-4 md:grid-cols-6">
          <input required placeholder="Nom" value={ingredient.nom} onChange={e => setIngredient({ ...ingredient, nom: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" />
          <input placeholder="Catégorie" value={ingredient.categorie} onChange={e => setIngredient({ ...ingredient, categorie: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" />
          <input placeholder="Rayon" value={ingredient.rayon} onChange={e => setIngredient({ ...ingredient, rayon: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" />
          <select value={ingredient.default_storage ?? ''} onChange={e => setIngredient({ ...ingredient, default_storage: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="cellio">Cellio</option><option value="frosti">Frosti</option></select>
          <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"><input type="checkbox" checked={ingredient.default_is_fridge} onChange={e => setIngredient({ ...ingredient, default_is_fridge: e.target.checked })} /> Frigo</label>
          <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Ajouter</button>
        </form>
        <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-stone-100"><tr><th className="p-3">Nom</th><th className="p-3">Catégorie</th><th className="p-3">Rayon</th><th className="p-3">Stock</th><th className="p-3">Frigo</th><th className="p-3"></th></tr></thead><tbody className="divide-y">{filteredIngredients.map(i => <tr key={i.id}><td className="p-3 font-semibold">{i.nom}</td><td className="p-3">{i.categorie ?? '—'}</td><td className="p-3">{i.rayon ?? '—'}</td><td className="p-3">{i.default_storage ?? '—'}</td><td className="p-3">{i.default_is_fridge ? 'Oui' : 'Non'}</td><td className="p-3 text-right"><button onClick={() => remove('ingredient', { id: i.id })} className="text-xs font-semibold text-red-600">Supprimer</button></td></tr>)}</tbody></table></div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-black">🔤 Synonymes <span className="text-sm font-normal text-slate-400">({data.synonyms.length})</span></h2><form onSubmit={addSynonym} className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_auto]"><input required placeholder="mot recette" value={synonym.mot_recette} onChange={e => setSynonym({ ...synonym, mot_recette: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><select required value={synonym.ingredient_id} onChange={e => setSynonym({ ...synonym, ingredient_id: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Ingrédient…</option>{data.ingredients.map(i => <option key={i.id} value={i.id}>{i.nom}</option>)}</select><button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Ajouter</button></form><div className="mt-4 max-h-72 overflow-auto divide-y">{data.synonyms.map(s => <div key={`${s.mot_recette}-${s.ingredient_id}`} className="flex items-center justify-between gap-3 py-2 text-sm"><span><b>{s.mot_recette}</b> → {ingredientName(s.ingredient_id)}</span><button onClick={() => remove('synonym', { mot_recette: s.mot_recette })} className="text-xs font-semibold text-red-600">Supprimer</button></div>)}</div></section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-black">⚖️ Unités <span className="text-sm font-normal text-slate-400">({data.units.length})</span></h2><form onSubmit={addUnit} className="mt-4 grid gap-3 md:grid-cols-3"><input required placeholder="Unité canonique" value={unit.unite} onChange={e => setUnit({ ...unit, unite: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><input placeholder="Abréviation" value={unit.abreviation} onChange={e => setUnit({ ...unit, abreviation: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><input placeholder="Type" value={unit.type_unite} onChange={e => setUnit({ ...unit, type_unite: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><input placeholder="Équivalence" value={unit.equivalence_reference} onChange={e => setUnit({ ...unit, equivalence_reference: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><input placeholder="Multiplicateur" value={unit.multiplicateur} onChange={e => setUnit({ ...unit, multiplicateur: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Ajouter</button></form><div className="mt-4 max-h-72 overflow-auto divide-y">{data.units.map(u => <div key={u.unite} className="flex items-center justify-between gap-3 py-2 text-sm"><span><b>{u.unite}</b> {u.abreviation ? `(${u.abreviation})` : ''} · {u.type_unite ?? '—'} · ×{u.multiplicateur ?? '—'}</span><button onClick={() => remove('unit', { unite: u.unite })} className="text-xs font-semibold text-red-600">Supprimer</button></div>)}</div></section>
      </div>

      <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-black">⚗️ Équivalences de poids <span className="text-sm font-normal text-slate-400">({data.densities.length})</span></h2><p className="mt-1 text-sm text-slate-500">Exemple : 1 cuillère à soupe de miel ≈ 21 g. Cette table permet de convertir une unité en grammes quand le Matcher ne peut pas utiliser une conversion générique.</p><form onSubmit={addDensity} className="mt-4 grid gap-3 md:grid-cols-4"><select required value={density.ingredient_id} onChange={e => setDensity({ ...density, ingredient_id: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Ingrédient…</option>{data.ingredients.map(i => <option key={i.id} value={i.id}>{i.nom}</option>)}</select><input required placeholder="Unité" value={density.unite} onChange={e => setDensity({ ...density, unite: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><input required type="number" min="0.0001" step="0.0001" placeholder="Poids en g" value={density.poids_g_approx} onChange={e => setDensity({ ...density, poids_g_approx: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" /><button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Ajouter / mettre à jour</button></form><div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">{data.densities.map(d => <div key={`${d.ingredient_id}-${d.unite}`} className="rounded-xl border bg-stone-50 p-3 text-sm"><div className="font-bold">{ingredientName(d.ingredient_id)}</div><div className="mt-1 text-slate-600">1 {d.unite} ≈ <b>{d.poids_g_approx} g</b></div><button onClick={() => remove('density', { ingredient_id: d.ingredient_id, unite: d.unite })} className="mt-2 text-xs font-semibold text-red-600">Supprimer</button></div>)}</div></section>

      {loading && <div className="fixed inset-0 grid place-items-center bg-white/60 text-sm font-semibold">Chargement…</div>}
    </div>
  </main>
}
