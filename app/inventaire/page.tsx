'use client'
import InventoryReminderSettings from '../components/InventoryReminderSettings'
import Link from 'next/link'
import { APP_VERSION } from '../utils/app-version'
import { stockSourceLink } from '../utils/stock-source-link'
import { useEffect, useMemo, useState, useRef } from 'react'
import { stockLocationKey, stockLocationLabel, stockLocationOptions, type StockLocation } from '../utils/stock-location-policy'

type Item = { content_quantity?:number|null;content_unit?:string|null; version?: number; id: string; produit: string; qte: number; unite: string; categorie: string; pantry_ingredient_id?:string|null; ingredient_name?: string | null; ingredient_aliases?: string[]; source: 'frosti' | 'cellio'; location_id?: string | null; location_name?: string | null; location_is_fridge?: boolean | null }
type Draft = { qte: number; unite: string }
const key = (item: Item) => JSON.stringify([item.source, item.id])

export default function InventoryPage() {
  const receipts=useRef(new Map<string,string>())
  const [items, setItems] = useState<Item[]>([]), [locations, setLocations] = useState<StockLocation[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('all'), [draft, setDraft] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  async function load() {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/stock', { cache: 'no-store' }), data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Chargement impossible.')
      const rows: Item[] = data.items || []
      setItems(rows); setLocations(stockLocationOptions(data.locations || [], rows))
      setDraft(Object.fromEntries(rows.map(item => [key(item), { qte: item.qte, unite: item.unite }])))
    } catch (err) { setError(err instanceof Error ? err.message : 'Chargement impossible.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (typeof window !== 'undefined') {const params=new URLSearchParams(window.location.search);setSearch(params.get('search')||'');{const candidate=params.get('location');try{const pair=JSON.parse(candidate||'null');if(Array.isArray(pair)&&pair.length===2&&['frosti','cellio'].includes(pair[0])&&typeof pair[1]==='string')setSelected(candidate!)}catch{}}} void load() }, [])
  const scoped = useMemo(() => items.filter(item => selected === 'all' || stockLocationKey(item.source, item.location_id) === selected), [items, selected])
  const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const visible = scoped.filter(item => [item.produit, item.ingredient_name || '', ...(item.ingredient_aliases || [])].some(label => normalized(label).includes(normalized(search.trim()))))
  const changed = scoped.filter(item => draft[key(item)] && (draft[key(item)].qte !== item.qte || draft[key(item)].unite !== item.unite))
  function edit(item: Item, change: Partial<Draft>) {
    setDraft(current => ({ ...current, [key(item)]: { ...(current[key(item)] || item), ...change } })); setMessage('')
  }
  function choose(value: string) {
    if (changed.length && !window.confirm('Abandonner les corrections non enregistrées ?')) return
    // Never retain invisible edits when moving to another location.
    setSelected(value); setMessage(''); setError('')
    setDraft(Object.fromEntries(items.map(item => [key(item), { qte: item.qte, unite: item.unite }])))
  }
  async function save() {
    if (!changed.length) return
    setSaving(true); setError('')
    let saved = 0
    try {
      const groups = new Map<string, Item[]>()
      for (const item of changed) {
        const group = stockLocationKey(item.source, item.location_id)
        groups.set(group, [...(groups.get(group) || []), item])
      }
      for (const rows of groups.values()) {
        const first = rows[0]
        const edits=rows.map(item => ({id:item.id,source:item.source,...draft[key(item)],expected_qte:item.qte,expected_unite:item.unite,expected_version:item.version}));
        const fingerprint=JSON.stringify([first.source,first.location_id,edits]);
        let op=receipts.current.get(fingerprint);if(!op){op=crypto.randomUUID();receipts.current.set(fingerprint,op)}
        const response = await fetch('/api/point-frigo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          operation_id:op, source: first.source, location_id: first.location_id ?? null,
          items: edits,
        }) })
        const result = await response.json()
        if (!response.ok) {
          saved += result.updated?.length || 0
          throw new Error(result.error || 'Enregistrement impossible.')
        }
        saved += rows.length
      }
      await load(); setMessage(`${saved} correction(s) enregistrée(s) dans ${groups.size} lieu(x).`)
    } catch (err) {
      if (saved) await load()
      setError(`${err instanceof Error ? err.message : 'Enregistrement impossible.'}${saved ? ` ${saved} correction(s) déjà enregistrée(s) ; stock rechargé. Les autres corrections sont à ressaisir.` : ''}`)
    } finally { setSaving(false) }
  }
  return <main className="mx-auto max-w-3xl px-3 py-5 pb-28 text-slate-900">
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-black">📋 Inventaire</h1><Link href="/stock" className="min-h-11 rounded-xl border px-3 py-3 text-sm font-bold">Stocks →</Link></div>
    <p className="mt-1 text-xs text-slate-500">Écran {APP_VERSION}</p><p className="mt-2 text-sm text-slate-600">Recherche un produit dans tous les lieux, ou choisis un lieu pour son inventaire. Vérifie les quantités puis enregistre ses corrections. Frosti et Cellio sont mis à jour. Si tu changes une unité, saisis la quantité réelle correspondante.</p>
    <label className="mt-4 block text-sm font-bold">Chercher un ingrédient dans les stocks<input type="search" disabled={saving} value={search} onChange={e => setSearch(e.target.value)} placeholder="Saisir un ingrédient : ail, saucisse, huile…" className="mt-1 min-h-12 w-full rounded-xl border p-3" /></label>
    <button disabled={saving || loading} onClick={() => choose('all')} style={{backgroundColor:'#ecfdf5',color:'#065f46'}} className="mt-2 rounded-xl border px-3 py-2 text-sm font-bold">Voir tous les lieux Frosti et Cellio</button><p className="mt-2 text-sm font-semibold">{selected === 'all' ? 'Recherche dans TOUS les lieux' : 'Recherche limitée au lieu sélectionné'} · {visible.length} ligne(s) trouvée(s)</p>
    <label className="mt-5 block font-bold">Filtrer par lieu (facultatif)<select disabled={saving || loading} value={selected} onChange={e => choose(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white p-3"><option value="all">Tous les lieux · Frosti et Cellio</option>{locations.map(l => <option key={stockLocationKey(l.source, l.id)} value={stockLocationKey(l.source, l.id)}>{stockLocationLabel(l)}</option>)}</select></label>
    <button disabled={saving || loading} onClick={() => { if (!changed.length || window.confirm('Abandonner les corrections et actualiser ?')) void load() }} className="mt-3 rounded-xl border px-3 py-2 text-sm font-bold">Actualiser après une correction dans Frosti ou Cellio</button>
    <p className="mt-1 text-xs text-slate-500">Changer de lieu annule les modifications non enregistrées de l’inventaire en cours.</p>

    <p className="mt-2 text-xs text-slate-600">La recherche porte sur les noms et associations enregistrés. Elle affiche les lignes de stock existantes, y compris celles à zéro.</p>
    <InventoryReminderSettings selected={selected} blocked={saving||loading||changed.length>0||!!search.trim()}/>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {loading ? <p className="mt-4">Chargement…</p> : selected && <section className="mt-4 space-y-2">
      {!visible.length && <p className="rounded-xl border p-4">Aucun produit trouvé dans les lieux sélectionnés.</p>}
      {visible.map(item => {
        const current = draft[key(item)] || item
        const originLink = stockSourceLink(item)
        const garlic = item.produit.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === 'ail'
        return <article key={key(item)} className="rounded-xl border bg-white p-3">
          <h2 className="font-bold">{item.produit}</h2>{item.content_quantity!=null&&<p className="text-xs text-slate-600">Contenu : {item.content_quantity} {item.content_unit} par {item.unite}. Pour changer ce format, ouvrir {item.source}.</p>}{item.ingredient_name&&item.ingredient_name!==item.produit&&<p className="text-xs text-slate-500">Ingrédient : {item.ingredient_name}</p>}<p className="mt-1 text-sm font-semibold text-emerald-800">{stockLocationLabel(locations.find(l => stockLocationKey(l.source, l.id) === stockLocationKey(item.source, item.location_id)) || { source: item.source, id: item.location_id ?? null, name: item.location_name || 'Lieu non renseigné' })}</p><p className="text-xs text-slate-500">Enregistré : {item.pantry_ingredient_id?(item.qte>0?'Présent':'Absent'):`${item.qte} ${item.unite}`} · {item.categorie}</p>
          <div className="mt-3 flex flex-wrap gap-3">{item.pantry_ingredient_id?<label className="min-h-12 flex items-center gap-3 font-bold"><input aria-label={`Présence ${item.produit}`} type="checkbox" disabled={saving} checked={current.qte>0} onChange={e=>edit(item,{qte:e.target.checked?(item.qte>0?item.qte:1):0})}/>Il en reste</label>:<>
            <label className="min-w-0 flex-1 text-sm font-bold">Quantité réelle<input type="number" min="0" step="any" disabled={saving} value={current.qte} onChange={e => { const qte = Number(e.target.value); if (Number.isFinite(qte) && qte >= 0) edit(item, { qte }) }} className="mt-1 min-h-12 w-full rounded-xl border p-3" /></label>
            <label className="min-w-0 flex-1 text-sm font-bold">Unité<select disabled={saving || item.content_quantity!=null} value={current.unite} onChange={e => edit(item, { unite: e.target.value })} className="mt-1 min-h-12 w-full rounded-xl border bg-white p-3">
              {[...new Set([item.unite, ...(garlic ? ['Gousse'] : ['Pièce', 'Gramme', 'Millilitre', 'Gousse'])])].map(u => <option disabled={garlic && u !== 'Gousse'} key={u}>{u}</option>)}
            </select></label></>}
          </div>
          {originLink && <a href={originLink.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-lg border px-3 py-2 text-sm font-bold">{originLink.precise ? 'Ouvrir la fiche' : 'Ouvrir'} dans {item.source === 'frosti' ? 'Frosti' : 'Cellio'} ↗</a>}
          {garlic&&!item.pantry_ingredient_id && <p className="mt-2 text-xs font-bold text-amber-900">Ail : compte les gousses disponibles et choisis Gousse. Une tête n’est pas une gousse.</p>}
        </article>
      })}
    </section>}
    {selected && <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] mt-5 lg:bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-lg"><span className="text-sm">{changed.length} correction(s){changed.some(item => !visible.includes(item)) ? ' · certaines hors recherche' : ''} · {selected === 'all' ? 'tous les lieux' : 'ce lieu'}</span><button disabled={saving || loading || !changed.length} onClick={() => void save()} style={{backgroundColor:'#047857',color:'#fff'}} className="min-h-12 rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : 'Valider l’inventaire'}</button></div>}
  </main>
}
