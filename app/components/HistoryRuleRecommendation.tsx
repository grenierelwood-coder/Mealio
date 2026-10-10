'use client'
import { useState } from 'react'
import type { HistoryRecommendation } from '../utils/household-history-policy'
const number=(n:number)=>Number(n.toFixed(2)).toLocaleString('fr-FR')
const date=(d:string)=>new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'})
const box='rounded-2xl border bg-white p-4 shadow-sm'
export default function HistoryRuleRecommendation({item,disabled,onAction}:{item:HistoryRecommendation;disabled:boolean;onAction:(item:HistoryRecommendation,action:string,values?:Record<string,number>)=>Promise<void>}){
 const [quantity,setQuantity]=useState(String(item.quantity)),[minimum,setMinimum]=useState(String(item.minimum)),[interval,setInterval]=useState(String(item.interval_days)),[editing,setEditing]=useState(false)
 const valid=Number.isFinite(Number(quantity))&&Number(quantity)>0&&(item.kind==='threshold'?Number.isFinite(Number(minimum))&&Number(minimum)>=0&&Number(quantity)>Number(minimum):Number.isInteger(Number(interval))&&Number(interval)>=1&&Number(interval)<=366)
 return <article className={`${box} mt-3`}><h3 className="font-bold">{item.produit} · {item.kind==='threshold'?'Seuil de stock':'Achat récurrent'}</h3><p className="mt-2 text-sm text-slate-600">{item.reason}</p>
  <p className="mt-2 text-sm font-semibold">{item.kind==='threshold'?`Seuil ${number(item.minimum)} ${item.unite} · cible ${number(item.quantity)} ${item.unite}`:`${number(item.quantity)} ${item.unite} tous les ${item.interval_days} jours · prochaine échéance ${date(item.next_due_date)}`}</p>
  {!editing?<button disabled={disabled} onClick={()=>setEditing(true)} className="mt-3 min-h-12 rounded-xl border px-4 font-bold disabled:opacity-50">Vérifier et activer →</button>:<fieldset disabled={disabled} className="mt-3 rounded-xl bg-emerald-50 p-3"><p className="text-sm">Cette règle proposera des achats. Elle ne les ajoutera pas automatiquement.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">
   <label className="text-sm font-bold">{item.kind==='threshold'?'Stock cible':'Quantité achetée'} ({item.unite})<input type="number" min="0.01" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white p-2"/></label>
   {item.kind==='threshold'?<label className="text-sm font-bold">Seuil ({item.unite})<input type="number" min="0" step="any" value={minimum} onChange={e=>setMinimum(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white p-2"/></label>:<label className="text-sm font-bold">Intervalle en jours<input type="number" min="1" max="366" step="1" value={interval} onChange={e=>setInterval(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border bg-white p-2"/></label>}
  </div><div className="mt-3 flex flex-wrap gap-2"><button disabled={disabled||!valid} onClick={()=>void onAction(item,'accept',{quantity:Number(quantity),minimum:Number(minimum),interval_days:Number(interval)})} style={{backgroundColor:'#047857',color:'#fff'}} className="min-h-12 rounded-xl px-4 font-bold disabled:opacity-50">Activer cette règle</button><button onClick={()=>setEditing(false)} className="min-h-12 rounded-xl border px-4">Annuler</button></div></fieldset>}
  <button disabled={disabled} onClick={()=>void onAction(item,'snooze')} className="ml-2 mt-3 min-h-12 rounded-xl border px-4 text-sm disabled:opacity-50">Me le reproposer dans 30 jours</button>
 </article>
}
