'use client'

import Link from 'next/link'

const mainActions = [
  {
    href: '/planning',
    icon: '📅',
    title: 'Planning',
    text: 'Organiser les repas de la semaine et ajuster les portions.',
    label: 'Planifier les repas',
  },
  {
    href: '/courses',
    icon: '🛒',
    title: 'Courses',
    text: 'Voir ce qu’il faut acheter et gérer les quantités réellement achetées.',
    label: 'Voir les courses',
  },
  {
    href: '/anti-gaspi',
    icon: '🥕',
    title: 'Anti-Gaspi',
    text: 'Utiliser en priorité les produits qui arrivent à leur date limite.',
    label: 'Trouver une recette',
  },
  {
    href: '/replenishment',
    icon: '🔄',
    title: 'Ravitaillement',
    text: 'Gérer les seuils, favoris et achats récurrents du foyer.',
    label: 'Gérer le ravitaillement',
  },
]

const secondaryActions = [
  {
    href: '/stock',
    icon: '❄️',
    title: 'Stock',
    text: 'Consulter le stock réel de Frosti et Cellio.',
  },
  {
    href: '/point-frigo',
    icon: '🧊',
    title: 'Point Frigo',
    text: 'Recaler rapidement le stock du foyer.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-3xl bg-emerald-800 p-6 text-white shadow-sm sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-200">
            Mealio
          </p>

          <div className="mt-2 max-w-3xl">
            <h1 className="text-3xl font-black leading-tight sm:text-4xl">
              Que fait-on aujourd’hui ?
            </h1>
            <p className="mt-3 text-base leading-7 text-emerald-50 sm:text-lg">
              Mealio relie le planning, les courses et le stock réel du foyer
              pour vous aider à décider quoi manger et quoi acheter.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
            <Link
              href="/planning"
              className="rounded-xl bg-white px-5 py-3 text-center font-bold text-emerald-800 transition hover:bg-emerald-50"
            >
              📅 Planifier les repas
            </Link>
            <Link
              href="/courses"
              className="rounded-xl border border-emerald-400 px-5 py-3 text-center font-bold text-white transition hover:bg-emerald-700"
            >
              🛒 Voir les courses
            </Link>
            <Link
              href="/anti-gaspi"
              className="rounded-xl border border-emerald-400 px-5 py-3 text-center font-bold text-white transition hover:bg-emerald-700"
            >
              🥕 Éviter le gaspillage
            </Link>
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-4">
            <h2 className="text-xl font-black">Les actions principales</h2>
            <p className="mt-1 text-sm text-slate-600">
              Les quatre fonctions que vous utiliserez le plus souvent.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {mainActions.map(action => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="text-3xl" aria-hidden="true">
                    {action.icon}
                  </span>
                  <span className="text-lg text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600">
                    →
                  </span>
                </div>

                <h3 className="mt-4 text-lg font-black">{action.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                  {action.text}
                </p>

                <span className="mt-4 text-sm font-bold text-emerald-700">
                  {action.label} →
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-4">
            <h2 className="text-xl font-black">Le stock du foyer</h2>
            <p className="mt-1 text-sm text-slate-600">
              Les outils pour vérifier et corriger le stock réel.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {secondaryActions.map(action => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
              >
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl"
                  aria-hidden="true"
                >
                  {action.icon}
                </span>

                <div className="min-w-0 flex-1">
                  <h3 className="font-black">{action.title}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    {action.text}
                  </p>
                </div>

                <span className="text-lg text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600">
                  →
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-emerald-100 bg-emerald-50 p-5 sm:p-6">
          <h2 className="font-black text-emerald-900">Le principe de Mealio</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900/80">
            Le planning détermine les besoins, les courses regroupent ce qu’il
            faut acheter, puis les achats alimentent le stock réel. L’Anti-Gaspi
            permet de repartir du stock pour privilégier les produits à utiliser
            rapidement.
          </p>
        </section>
      </div>
    </main>
  )
}
