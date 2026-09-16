import Link from 'next/link'
import AdminHelp from '../components/AdminHelp'

const cards = [
  {
    href: '/admin/storage',
    icon: '⚙️',
    title: 'Règles de rangement',
    text: 'Exceptions ingrédient, catégories et règles par défaut Frosti / Cellio.',
    scope: 'Foyer',
  },
  {
    href: '/admin/storage/pending',
    icon: '🧺',
    title: 'Articles à ranger',
    text: 'Rejouer le rangement des achats qui n’ont pas pu être rangés automatiquement.',
    scope: 'Foyer',
  },
  {
    href: '/admin/data',
    icon: '🗄️',
    title: 'Tables & relations',
    text: 'Explorer les tables Mealio, leurs relations, les données réelles et les contrôles de cohérence.',
    scope: 'Commun',
  },
  {
    href: '/admin/ingredients',
    icon: '🥕',
    title: 'Référentiel ingrédients',
    text: 'Ingrédients officiels, synonymes, unités et équivalences de poids.',
    scope: 'Commun',
  },
  {
    href: '/matcher',
    icon: '🧠',
    title: 'Matcher',
    text: 'Tester les rapprochements et suivre le moteur de résolution.',
    scope: 'Commun',
  },
  {
    href: '/replenishment',
    icon: '🔁',
    title: 'Réapprovisionnement',
    text: 'Seuils, favoris et règles récurrentes.',
    scope: 'Foyer',
  },
]

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-5 py-8">

        <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">
          Administration
        </p>

        <h1 className="mt-1 text-3xl font-black">
          ⚙️ Centre d’administration
        </h1>

        <p className="mt-2 max-w-3xl text-slate-500">
          Les référentiels qui pilotent le Matcher, les Courses, le stockage et le
          réapprovisionnement. On modifie les données sans toucher au code métier.
        </p>

        <div className="mt-7">
          <AdminHelp
            title="Comment fonctionne l’administration ?"
            intro="Les écrans ci-dessous pilotent des référentiels et des règles utilisés par le moteur de Mealio. Ils sont puissants : une modification peut changer la façon dont les recettes sont rapprochées, les unités converties, les achats rangés ou les propositions de réapprovisionnement générées."
            sections={[
              {
                title: '🥕 Référentiel ingrédients',
                children: (
                  <p>
                    Définit les ingrédients officiels, leurs synonymes, les unités
                    connues et les densités utilisées pour certaines conversions.
                    Le Matcher et les Courses s’appuient directement sur ces données.
                  </p>
                ),
              },
              {
                title: '📦 Règles de rangement',
                children: (
                  <p>
                    Détermine vers quelle application et quel emplacement un
                    ingrédient doit être rangé. La priorité métier est{' '}
                    <b>exception ingrédient → catégorie → défaut</b>. Ces règles
                    sont propres au foyer.
                  </p>
                ),
              },
              {
                title: '🧺 Articles à ranger',
                children: (
                  <p>
                    Conserve les achats qui n’ont pas pu être rangés et permet de
                    relancer le <b>même moteur de rangement</b> après correction
                    des règles.
                  </p>
                ),
              },
              {
                title: '🧠 Matcher',
                children: (
                  <p>
                    Permet de tester le rapprochement entre une ligne de recette,
                    un ingrédient officiel et les lignes de stock disponibles,
                    notamment les synonymes et les conversions d’unités.
                  </p>
                ),
              },
              {
                title: '🔁 Réapprovisionnement',
                children: (
                  <p>
                    Regroupe les favoris fréquents, les seuils de stock et les
                    achats récurrents. Ces mécanismes alimentent la même liste
                    de courses.
                  </p>
                ),
              },
            ]}
            warning="Avant de modifier une donnée, il faut comprendre son rôle : le référentiel est une source de vérité, les règles de rangement pilotent le stockage, et les règles de réapprovisionnement influencent les futures courses."
          />
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="text-3xl">
                  {card.icon}
                </div>

                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-slate-500">
                  {card.scope}
                </span>
              </div>

              <h2 className="mt-5 text-xl font-black">
                {card.title}
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                {card.text}
              </p>

              <div className="mt-5 text-sm font-bold text-emerald-700">
                Ouvrir →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}