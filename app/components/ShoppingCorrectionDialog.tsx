'use client'
import Link from 'next/link'
import {useEffect,useRef,useState} from 'react'
import {correctionAction,shoppingProductKey,type IssueGroup} from '../utils/shopping-issue-policy'
type Ingredient={id:string;nom:string;unite_reference?:string|null}
type Reference={ingredients:Ingredient[];units:{unite:string;abreviation?:string;type_unite?:string}[];densities:{ingredient_id:string;unite:string;poids_g_approx:number}[]}
export default function ShoppingCorrectionDialog({group,ingredientId,onClose,onRegenerate}:{group:IssueGroup;ingredientId?:string|null;onClose:()=>void;onRegenerate:()=>Promise<boolean>}){
 const [index,setIndex]=useState(0),[reference,setReference]=useState<Reference|null>(null),[target,setTarget]=useState(''),[name,setName]=useState(''),[filter,setFilter]=useState(''),[unit,setUnit]=useState(''),[grams,setGrams]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false)
 const busy=useRef(false),box=useRef<HTMLDivElement>(null),initialFocus=useRef<HTMLButtonElement>(null)
 const issue=group.issues[index],action=correctionAction(issue),chosen=reference?.ingredients.find(i=>i.id===target)
 const units=(reference?.units||[]).filter(u=>u.type_unite!=='poids'&&!/^(gramme|kilogramme|milligramme|once|livre)$/i.test(u.unite)&&(shoppingProductKey(chosen?.nom||'')!=='ail'||u.unite==='Gousse'))
 const garlicStock=action.kind==='density'&&shoppingProductKey(chosen?.nom||'')==='ail'&&/pi[eè]ce/i.test(issue.message)
 useEffect(()=>{
  let active=true
  fetch('/api/admin/ingredients',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Chargement impossible.');if(active)setReference({ingredients:data.ingredients||[],units:data.units||[],densities:data.densities||[]})}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
  const previous=document.activeElement as HTMLElement|null, body=document.body, previousOverflow=body?.style.overflow
  if(body)body.style.overflow='hidden'
  initialFocus.current?.focus()
  function escape(event:KeyboardEvent){if(event.key==='Escape'&&!busy.current)onClose()}
  document.addEventListener('keydown',escape)
  return()=>{active=false;document.removeEventListener('keydown',escape);if(body)body.style.overflow=previousOverflow||'';if(previous?.isConnected)previous.focus()}
 },[])
 useEffect(()=>{
  if(!reference)return
  const a=correctionAction(group.issues[index]);setName(a.name);setTarget(a.kind==='association'?reference.ingredients.find(i=>shoppingProductKey(i.nom)===shoppingProductKey(a.target))?.id||ingredientId||'':ingredientId||reference.ingredients.find(i=>shoppingProductKey(i.nom)===shoppingProductKey(a.target))?.id||'');setUnit('');setGrams('');setSaved(false);setError('')
 },[index,reference,ingredientId])
 useEffect(()=>{
  if(!reference||!chosen)return
  const suggested=units.find(u=>shoppingProductKey(u.unite)===shoppingProductKey(issue.unit||'')||shoppingProductKey(u.abreviation||'')===shoppingProductKey(issue.unit||''))?.unite||units.find(u=>u.unite===chosen.unite_reference)?.unite||units[0]?.unite||''
  const selected=unit&&units.some(u=>u.unite===unit)?unit:suggested
  if(selected!==unit)setUnit(selected)
  const existing=reference.densities.find(d=>d.ingredient_id===target&&d.unite===selected)
  setGrams(existing?String(existing.poids_g_approx):'')
 },[target,unit,reference])
 async function save(){
  if(busy.current)return;busy.current=true;setSaving(true);setError('')
  try{
   if(!saved){
    const payload=action.kind==='association'?{name:name.trim(),ingredient_id:target}:{entity:'density',ingredient_id:target,unite:unit,poids_g_approx:Number(grams)}
    const response=await fetch(action.kind==='association'?'/api/matcher/association':'/api/admin/ingredients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Enregistrement impossible.');setSaved(true)
   }
   if(!await onRegenerate())throw new Error('Correction enregistrée, mais les courses n’ont pas pu être recalculées. Réessayer le recalcul ; la correction est conservée.')
   onClose()
  }catch(e){setError(e instanceof Error?e.message:'Correction impossible.')}finally{busy.current=false;setSaving(false)}
 }
 return <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-950/40 p-2 sm:items-center" onClick={e=>{if(e.target===e.currentTarget&&!busy.current)onClose()}}>
  <div ref={box} role="dialog" aria-modal="true" aria-labelledby="shopping-correction-title" onKeyDown={e=>{if(e.key!=='Tab')return;const focusable=box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary');if(!focusable?.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-4 text-slate-900 shadow-xl">
   <div className="flex items-center justify-between gap-3"><h2 id="shopping-correction-title" className="text-xl font-black">Corriger · {group.produit}</h2><button ref={initialFocus} disabled={saving} onClick={onClose} aria-label="Fermer la correction" className="min-h-11 rounded-xl border px-3 font-bold">×</button></div>
   {group.issues.length>1&&<label className="mt-3 block text-sm font-bold">Point à traiter<select disabled={saving} value={index} onChange={e=>setIndex(Number(e.target.value))} className="mt-1 w-full rounded-xl border p-3">{group.issues.map((i,n)=><option key={n} value={n}>{n+1}. {i.message}</option>)}</select></label>}
   <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">{issue.message}</p>
   <details className="mt-2 text-sm"><summary className="cursor-pointer font-bold">Conseil et détails</summary><p className="mt-2">{issue.resolution_hint}</p></details>
   {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
   {saved&&<p role="status" className="mt-3 text-sm font-bold text-emerald-800">Correction enregistrée dans le référentiel partagé.</p>}
   {loading?<p className="mt-4">Chargement…</p>:action.kind==='external'?<div className="mt-4"><Link href={action.href} className="block rounded-xl border p-3 font-bold">{action.href.startsWith('/admin/recipes')?'Corriger cette recette':action.href.startsWith('/admin/storage')?'Voir les articles à ranger':'Vérifier le référentiel et les unités'} →</Link><p className="mt-2 text-sm text-slate-600">Enregistrer dans cet écran, puis revenir aux Courses et cliquer sur « Mettre à jour mes courses ». Une correction de stock se fait dans l’Inventaire ou dans l’application de stockage.</p></div>:<fieldset disabled={saving||saved} className="mt-4 space-y-3">
    {action.kind==='association'&&<label className="block text-sm font-bold">Libellé à reconnaître<input aria-label="Libellé à reconnaître" value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label>}
    <label className="block text-sm font-bold">Chercher l’ingrédient officiel<input value={filter} onChange={e=>setFilter(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label>
    <label className="block text-sm font-bold">Ingrédient officiel<select aria-label="Ingrédient officiel" value={target} onChange={e=>setTarget(e.target.value)} className="mt-1 w-full rounded-xl border p-3"><option value="">Choisir…</option>{reference?.ingredients.filter(i=>i.id===target||shoppingProductKey(i.nom).includes(shoppingProductKey(filter))).map(i=><option key={i.id} value={i.id}>{i.nom}</option>)}</select></label>
    {chosen&&<p className="text-sm">Unité de référence : <b>{chosen.unite_reference||'À définir dans Admin'}</b></p>}
    {action.kind==='density'&&(garlicStock?<p className="rounded-xl bg-amber-50 p-3 text-sm">Le stock d’ail en Pièce doit être recompté en gousses. Une tête ne vaut pas une gousse. Corriger cette ligne dans l’Inventaire ; un poids moyen ne lève pas cette ambiguïté.</p>:<><label className="block text-sm font-bold">Unité dont on précise le poids<select aria-label="Unité du poids moyen" value={unit} onChange={e=>setUnit(e.target.value)} className="mt-1 w-full rounded-xl border p-3">{units.map(u=><option key={u.unite}>{u.unite}</option>)}</select></label><label className="block text-sm font-bold">1 {unit||'unité'} pèse combien de grammes ?<input aria-label="Poids moyen en grammes" type="number" min="0.000001" step="any" value={grams} onChange={e=>setGrams(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label></>)}
    <p className="text-xs text-slate-600">Une association de nom ne définit pas de conversion. Les associations et poids enregistrés sont communs aux foyers.</p>
   </fieldset>}
   {!loading&&action.kind!=='external'&&!garlicStock&&<button disabled={saving||!reference||(!saved&&(!target||(action.kind==='association'?!name.trim():!unit||!Number.isFinite(Number(grams))||Number(grams)<=0||!chosen?.unite_reference)))} onClick={()=>void save()} style={{backgroundColor:'#047857',color:'#fff'}} className="mt-4 min-h-12 w-full rounded-xl px-4 font-bold disabled:opacity-50">{saving?'Enregistrement et recalcul…':saved?'Recalculer les courses':'Enregistrer et recalculer les courses'}</button>}
   {garlicStock&&<Link href="/inventaire?search=Ail" className="mt-4 block rounded-xl border p-3 font-bold">Corriger les stocks d’ail →</Link>}
   {action.kind==='density'&&<Link href={action.href} className="mt-3 block text-sm font-bold underline">Autres unités et conversions dans Admin →</Link>}
  </div>
 </div>
}
