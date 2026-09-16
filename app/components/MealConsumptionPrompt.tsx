'use client'

import { useEffect, useState } from 'react'

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
  const [pending, setPending] = useState<PendingMeal[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    try {
      const response = await fetch('/api/meal-consumption', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      setPending(data.pending ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function respond(confirmed: boolean) {
    const meal = pending[0]
    if (!meal) return

    try {
      setBusy(true)
      const response = await fetch('/api/meal-consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_plan_id: meal.plan.id, confirmed }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Impossible d’enregistrer la consommation.')

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
      setMessage(error instanceof Error ? error.message : 'Erreur.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !pending.length) return null

  const meal = pending[0]
  const remaining = pending.length - 1

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">Repas passé</p>
        <h2 className="mt-2 text-2xl font-black">🍽️ {meal.recipe_nom}</h2>
        <p className="mt-2 text-slate-500">
          Ce repas était prévu le <b>{new Date(`${meal.plan.scheduled_date}T12:00:00`).toLocaleDateString('fr-FR')}</b> pour {meal.plan.servings} portion(s).
        </p>
        <p className="mt-4 font-semibold">Avez-vous cuisiné ce repas ?</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button disabled={busy} onClick={() => respond(true)} className="rounded-xl bg-emerald-700 px-4 py-3 font-black text-white disabled:opacity-40">✓ Oui, décrémenter le stock</button>
          <button disabled={busy} onClick={() => respond(false)} className="rounded-xl border px-4 py-3 font-bold hover:bg-stone-50 disabled:opacity-40">Non, pas cuisiné</button>
        </div>

        {remaining > 0 && <p className="mt-4 text-xs text-slate-400">{remaining} autre(s) repas passé(s) seront proposés ensuite.</p>}
        {message && <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm text-slate-600">{message}</p>}
      </div>
    </div>
  )
}
