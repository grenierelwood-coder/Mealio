import Link from 'next/link'

const cards = [
  { href: '/admin/storage/pending', icon: '🧺', title: 'Articles à ranger', text: 'Relancer le rangement des achats en attente.', scope: 'Foyer' },
  { href: '/replenishment', icon: '🔁', title: 'Réapprovisionnements', text: 'Seuils, favoris et règles récurrentes.', scope: 'Foyer' },
  { href: '/admin/storage', icon: '⚙️', title: 'Règles de rangement', text: 'Exceptions ingrédient, catégories et règles par défaut Frosti / Cellio.', scope: 'Foyer' },
  { href: '/admin/pantry', icon: '📦', title: 'Épicerie', text: 'Modes de suivi et formats d’achat propres à votre foyer.', scope: 'Foyer' },
  { href: '/admin/data', icon: '🗄️', title: 'Tables & relations', text: 'Explorer les tables Mealio, leurs relations et les données réelles.', scope: 'Commun' },
  { href: '/admin/ingredients', icon: '🥕', title: 'Référentiel ingrédients', text: 'Ingrédients officiels, synonymes, unités et équivalences de poids.', scope: 'Commun' },
  { href: '/admin/recipes', icon: '🍳', title: 'Correction des recettes', text: 'Corriger les ingrédients, quantités et unités des recettes Cookiwiki.', scope: 'Commun' },
  { href: '/admin/integration', icon: '🧪', title: 'Intégration', text: 'Analyser les recettes ou vérifier le cycle complet sur un foyer de test.', scope: 'Foyer' },
  { href: '/matcher', icon: '🧠', title: 'Matcher', text: 'Tester les rapprochements et suivre le moteur de résolution.', scope: 'Commun' },
]

function Cards({items}:{items:typeof cards}){return <div className="mt-4 grid gap-4 md:grid-cols-2">{items.map(card=><Link key={card.href} href={card.href} className="rounded-2xl border bg-white p-5 shadow-sm"><span className="float-right text-xs text-slate-500">{card.scope}</span><h2 className="text-lg font-black">{card.icon} {card.title}</h2><p className="mt-2 text-sm text-slate-600">{card.text}</p><p className="mt-3 font-bold text-emerald-700">Ouvrir →</p></Link>)}</div>}
export default function AdminPage(){return <main className="min-h-screen bg-stone-50 text-slate-900"><div className="mx-auto max-w-5xl px-5 py-8"><h1 className="text-3xl font-black">Réglages du foyer</h1><p className="mt-2 text-slate-600">Ranger les achats, choisir les formats d’épicerie et organiser le réapprovisionnement.</p><Cards items={cards.slice(0,4)}/><details className="mt-7 rounded-2xl border p-5"><summary className="cursor-pointer font-bold">Outils avancés · référentiel, recettes et tests</summary><p className="mt-3 text-sm text-slate-600">Les corrections du référentiel et des recettes sont communes. Les erreurs de Courses proposent un lien direct vers l’outil nécessaire.</p><Cards items={cards.slice(4)}/></details></div></main>}
