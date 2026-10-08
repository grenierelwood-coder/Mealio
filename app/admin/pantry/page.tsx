'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import HouseholdPreparations from '../../components/HouseholdPreparations'
import { pantryPurchaseDefault } from '../../utils/pantry-purchase-default'
import type { PantryProduct } from '../../utils/pantry-policy'

type Product = PantryProduct & { nom: string; categorie: string }
type Ingredient = { id: string; nom: string; categorie: string; unite_reference?:string|null }

function ProductEditor({ product, units, onSave }: {
  product: Product; units: string[]; onSave: () => Promise<void>
}) {
  const [quantity, setQuantity] = useState(String(product.default_quantity))
  const [unit, setUnit] = useState(product.default_unit)
  const [enabled, setEnabled] = useState(product.enabled)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function save() {
    if(!unit){setMessage('Choisir une unité avant de passer au suivi quantitatif.');return}
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/admin/pantry', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredient_id: product.ingredient_id, default_quantity: Number(quantity), default_unit: unit, enabled }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Enregistrement impossible.')
      await onSave(); setMessage('Enregistré')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erreur') }
    finally { setBusy(false) }
  }
  return <article className="rounded-2xl border bg-white p-4">
    <h2 className="font-black">{product.nom}</h2>
    <p className="text-xs text-slate-500">{product.categorie}</p>
    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => {setEnabled(e.target.checked);setUnit(e.target.checked?product.default_unit:'');setMessage(e.target.checked?'':'Choisir explicitement l’unité du format acheté. Vérifier ensuite les quantités réelles dans Inventaire.')}} /> Gérer en présence (décocher pour suivre les quantités)</label>
    <details open={!enabled} className="mt-3"><summary className="text-sm font-bold">{enabled?`Format d’achat si absent : ${quantity} ${unit}`:"Choisir l’unité du format acheté pour le suivi quantitatif"}</summary><div className="mt-3 grid grid-cols-2 gap-2">
      <label className="text-xs font-bold">Quantité à acheter si absent<input aria-label={`Quantité ${product.nom}`} type="number" min="0.001" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-base" /></label>
      <label className="text-xs font-bold">Unité<select aria-label={`Unité ${product.nom}`} value={unit} onChange={e => setUnit(e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-base"><option value="">Choisir une unité</option>{[...new Set([product.default_unit,...units])].map(value => <option key={value}>{value}</option>)}</select></label>
    </div></details>
    <p className="mt-2 text-xs text-slate-500">{enabled ? 'Présence : on vérifie seulement s’il en reste. La quantité ci-dessus est le format d’achat proposé lorsqu’il est absent, pas une dose consommée.' : 'Suivi quantitatif et conversions habituelles.'}</p>
    <button disabled={busy} onClick={() => void save()} className="mt-3 min-h-11 rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
    <p role="status" className="mt-2 text-sm">{message}</p>
  </article>
}

export default function PantryPage() {
  const [household, setHousehold] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState('')
  async function load() {
    const response = await fetch('/api/admin/pantry', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Lecture impossible.')
    setProducts((result.products ?? []).sort((a: Product,b: Product) => a.nom.localeCompare(b.nom, 'fr')))
    const params=new URLSearchParams(window.location.search);const target=params.get('ingredient_id');const search=params.get('search');if(target){const existing=(result.products||[]).find((p:Product)=>p.ingredient_id===target);if(existing)setQuery(existing.nom);else setAdding(target)}else if(search){const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();const ingredient=(result.ingredients||[]).find((i:Ingredient)=>normalize(i.nom)===normalize(search));const existing=(result.products||[]).find((p:Product)=>p.ingredient_id===ingredient?.id);if(existing)setQuery(existing.nom);else if(ingredient)setAdding(ingredient.id);else setQuery(search)};setHousehold(result.household ?? ''); setIngredients(result.ingredients ?? []); setUnits((result.units ?? []).map((row: { unite: string }) => row.unite))
  }
  useEffect(() => { void load().catch(e => setError(e.message)) }, [])
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const filtered = products.filter(p => normalize(`${p.nom} ${p.categorie}`).includes(normalize(query)))
  const available = ingredients.filter(i => !products.some(p => p.ingredient_id === i.id))
  const selected = available.find(i => i.id === adding)
  return <main className="mx-auto max-w-5xl px-4 py-6 text-slate-900">
    <Link href="/admin" className="text-sm font-bold text-emerald-700">← Administration</Link>
    <h1 className="mt-3 text-2xl font-black">📦 Épicerie {household && <span className="text-base font-normal">· {household}</span>}</h1>
    <HouseholdPreparations/>
    <p className="mt-2 text-sm text-slate-600">Modes de suivi et formats d’achat propres à votre foyer. Dans Courses, les boutons − et + changent le nombre de formats. Un autre foyer peut choisir un suivi quantitatif pour le même produit.</p>
    <p className="mt-2 text-sm text-slate-600">Modifie les formats avant de générer une liste. Les formats des lignes déjà créées sont conservés ; termine les achats en cours avant de changer leur unité.</p>
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    <label className="mt-5 block text-sm font-bold">Rechercher<input value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="Produit ou catégorie" className="mt-1 w-full rounded-xl border p-3" /></label>
    <div className="my-4 flex items-center justify-between gap-2 text-sm"><button disabled={page===0} onClick={() => setPage(p=>p-1)} className="min-h-11 rounded-xl border px-3 disabled:opacity-40">Précédent</button><span>{filtered.length} produit(s) · {page+1}/{Math.max(1,Math.ceil(filtered.length/24))}</span><button disabled={(page+1)*24>=filtered.length} onClick={() => setPage(p=>p+1)} className="min-h-11 rounded-xl border px-3 disabled:opacity-40">Suivant</button></div>
    <div className="grid gap-3 sm:grid-cols-2">{filtered.slice(page*24,(page+1)*24).map(product => <ProductEditor key={`${product.ingredient_id}-${product.default_quantity}-${product.default_unit}-${product.enabled}`} product={product} units={units} onSave={load} />)}</div>
    <section className="mt-6 rounded-2xl border p-4"><h2 className="font-bold">Ajouter un ingrédient au suivi épicerie</h2><select aria-label="Ingrédient à ajouter" value={adding} onChange={e=>setAdding(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">Choisir un ingrédient officiel</option>{available.map(i=><option key={i.id} value={i.id}>{i.nom}</option>)}</select>
      {selected && <div className="mt-3"><ProductEditor key={selected.id} product={{ingredient_id:selected.id,nom:selected.nom,categorie:selected.categorie,...pantryPurchaseDefault(selected),enabled:true}} units={units} onSave={async()=>{await load();setAdding('')}} /></div>}
    </section>
  </main>
}
