'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function Home() {
  const [username, setUsername] = useState('KH')

  useEffect(() => {
    setUsername(localStorage.getItem('congelo_username') || 'KH')
  }, [])

  const logout = () => {
    document.cookie = 'congelo_user_id=; path=/; max-age=0'
    document.cookie = 'congelo_username=; path=/; max-age=0'
    localStorage.removeItem('congelo_user_id')
    localStorage.removeItem('congelo_username')
    window.location.href = '/login'
  }

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">

      <div className="mx-auto max-w-7xl px-5 py-8">
        <section className="rounded-3xl bg-emerald-800 p-7 text-white shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-200">Mealio V3.1</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">Le cerveau est prêt. Testons-le.</h1>
          <p className="mt-3 max-w-2xl text-emerald-50">
            Cette première interface sert à valider le moteur de normalisation,
            le rapprochement sémantique et le croisement Frosti + Cellio avant de
            construire tout le front-office définitif.
          </p>
          <Link
            href="/matcher"
            className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 font-bold text-emerald-800 hover:bg-emerald-50"
          >
            Ouvrir le laboratoire Matcher →
          </Link>
        </section>

        <section className="mt-7 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Link href="/matcher" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 hover:-translate-y-0.5 hover:shadow-sm">
            <div className="text-2xl">🧠</div>
            <h2 className="mt-3 font-bold">Matcher</h2>
            <p className="mt-1 text-sm text-slate-600">Tester une ligne Cookiwiki et voir la résolution, la source et le statut.</p>
          </Link>
          <Link href="/planning" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 hover:-translate-y-0.5 hover:shadow-sm">
            <div className="text-2xl">📅</div>
            <h2 className="mt-3 font-bold">Planning</h2>
            <p className="mt-1 text-sm text-slate-600">Préparer l'interface qui alimentera le moteur de besoins.</p>
          </Link>
          <Link href="/courses" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 hover:-translate-y-0.5 hover:shadow-sm">
            <div className="text-2xl">🛒</div>
            <h2 className="mt-3 font-bold">Courses</h2>
            <p className="mt-1 text-sm text-slate-600">Future vue de la liste tricolore, par rayon, avec validation.</p>
          </Link>
          <Link href="/stock" className="rounded-2xl border border-sky-200 bg-sky-50 p-5 hover:-translate-y-0.5 hover:shadow-sm">
            <div className="text-2xl">❄️</div>
            <h2 className="mt-3 font-bold">Stocks</h2>
            <p className="mt-1 text-sm text-slate-600">Contrôler les inventaires Frosti et Cellio utilisés par le moteur.</p>
          </Link>
        </section>

        <section className="mt-7 rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-bold">Ordre de construction</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {[
              ['1', '🧠', 'Cerveau', 'En test'],
              ['2', '⚖️', 'Stocks', 'En test'],
              ['3', '📅', 'Planner', 'À construire'],
              ['4', '🛒', 'Caddie', 'À construire'],
              ['5', '🛠️', 'Admin / bonus', 'Plus tard'],
            ].map(([n, icon, title, state]) => (
              <div key={n} className="rounded-xl bg-stone-50 p-4">
                <div className="text-xs font-bold text-stone-400">PHASE {n}</div>
                <div className="mt-2 text-lg">{icon}</div>
                <div className="mt-1 font-semibold">{title}</div>
                <div className="mt-1 text-xs text-stone-500">{state}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
