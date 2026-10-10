'use client'

import {usePathname} from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface PendingMeal {
  plan: {
    id: string
    recipe_id: string
    scheduled_date: string
    meal_type: 'midi' | 'soir'
    servings: number
  }
  recipe_nom: string
}

export default function MealConsumptionPrompt() {
  const pathname=usePathname()
  const [closed,setClosed]=useState(false)
  const active=useRef<AbortController|null>(null)
  const dismissKey='mealio-consumption-later:'+new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date())
  async function api(url:string,options:RequestInit={}){
    active.current?.abort();const controller=new AbortController();active.current=controller
    const timer=setTimeout(()=>controller.abort(),15000)
    try{const response=await fetch(url,{...options,signal:controller.signal});const data=await response.json().catch(()=>({error:'Réponse serveur invalide.'}));if(!response.ok)throw new Error(data.error??'Service indisponible. Réessayez ou choisissez Plus tard.');return data}
    catch(e){if(e instanceof Error&&e.name==='AbortError')throw new Error('Le serveur ne répond pas. Réessayez ou choisissez Plus tard.');throw e}
    finally{clearTimeout(timer)}
  }
  function dismiss(){active.current?.abort();setClosed(true);sessionStorage.setItem(dismissKey,'1')}
  const [pending, setPending] = useState<PendingMeal[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview,setPreview]=useState<any>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    try {
      const data = await api('/api/meal-consumption',{cache:'no-store'})
      setPending(data.pending ?? [])
    } catch {
      // A failed reminder must never prevent access to Courses or Planning.
      setClosed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{if(pathname==='/login'){setClosed(true);return}const open=()=>{sessionStorage.removeItem(dismissKey);setClosed(false);setLoading(true);setPreview(null);setMessage(null);void load()};window.addEventListener('mealio:review-meals',open);if(!sessionStorage.getItem(dismissKey)){setClosed(false);void load()}else{setClosed(true);setLoading(false)}return ()=>{active.current?.abort();window.removeEventListener('mealio:review-meals',open)}},[pathname])

  async function respond(confirmed: boolean) {
    const meal = pending[0]
    if (!meal) return

    try {
      setBusy(true)
      setMessage(null)
      if(confirmed&&!preview){const d=await api(`/api/meal-consumption?meal_plan_id=${encodeURIComponent(meal.plan.id)}`,{cache:'no-store'});setPreview(d);return}
      const data = await api('/api/meal-consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_plan_id: meal.plan.id, confirmed,preview_key:preview?.preview_key }),
      })

      setPreview(null);
      setPending(current => current.slice(1))
      const result = data.result
      setMessage(
        confirmed
          ? result.shortages?.length
            ? 'Repas confirmé. Le stock disponible a été décrémenté ; certains besoins n’étaient pas disponibles en stock.'
            : 'Repas confirmé et stock décrémenté.'
          : 'Repas marqué comme non cuisiné.'
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erreur.');setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  if (closed || loading || !pending.length) return null

  const meal = pending[0]
  const remaining = pending.length - 1

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label="Confirmation du repas passé" className="max-h-[85dvh] overflow-y-auto w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Repas passé</p>
        <h2 className="mt-2 text-2xl font-black">🍽️ {meal.recipe_nom}</h2>{meal.recipe_nom==='Recette inconnue'&&<p className="mt-3 text-sm text-orange-800">La recette n’est plus disponible. Vous pouvez choisir Non ou Plus tard ; aucune déduction ne sera faite sans vérification.</p>}
        <p className="mt-2 text-slate-500">
          Ce repas était prévu le <b>{new Date(`${meal.plan.scheduled_date}T12:00:00`).toLocaleDateString('fr-FR')}</b> pour {meal.plan.servings} portion(s).
        </p>
        <p className="mt-4 font-semibold">Avez-vous cuisiné ce repas ?</p>

        {preview&&<div className="mt-4 rounded-xl border p-3"><p className="font-bold">Quantités proposées, dans l’ordre des dates qualifiées</p>{preview.preview.consumed.map((i:any,n:number)=><p key={n}>{i.produit} : {Number(i.qte.toFixed(6))} {i.unite} ({i.source})</p>)}{!preview.preview.consumed.length&&<p>Aucun stock quantifiable à déduire.</p>}{preview.preview.shortages.length>0&&<p className="mt-2 text-sm text-orange-700">Certains besoins sont absents du stock ou à vérifier. Ils ne seront pas déduits.</p>}</div>}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button disabled={busy} onClick={() => respond(true)} className="rounded-xl bg-emerald-700 px-4 py-3 font-black text-white disabled:opacity-40">{preview?'Confirmer ces quantités':'Oui, vérifier les quantités'}</button>
          <button disabled={busy} onClick={() => respond(false)} className="rounded-xl border px-4 py-3 font-bold hover:bg-stone-50 disabled:opacity-40">Non, pas cuisiné</button>
        </div>

        <button className="mt-3 min-h-11 text-sm text-slate-600" onClick={dismiss}>Plus tard</button>
        {remaining > 0 && <p className="mt-4 text-xs text-slate-400">{remaining} autre(s) repas passé(s) seront proposés ensuite.</p>}
        {message && <p role="alert" className="mt-4 rounded-xl bg-stone-50 p-3 text-sm text-slate-600">{message}</p>}
      </div>
    </div>
  )
}
