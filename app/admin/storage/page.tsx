'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import AdminHelp from '../../components/AdminHelp'

type Source = 'frosti' | 'cellio'
type Scope = 'default' | 'category' | 'ingredient'
type Mode = 'fridge' | 'freezer'

type Rule = {
  id: string
  user_id: string
  scope: Scope
  category: string | null
  ingredient_id: string | null
  location_id: string
  mode: Mode | 'any'
  priority: number
  is_active: boolean
}

type Location = {
  id: string
  name: string
  is_fridge?: boolean | null
  is_secondary?: boolean | null
}

type Ingredient = {
  id: string
  nom: string
  categorie: string | null
}

type Data = {
  username: string
  frosti: { rules: Rule[]; locations: Location[] }
  cellio: { rules: Rule[]; locations: Location[] }
}

type FormState = {
  source: Source
  scope: Scope
  category: string
  ingredient_id: string
  location_id: string
  mode: Mode
}

/*
 * La priorité est désormais déterminée automatiquement par le type de règle.
 *
 * Plus la valeur est élevée, plus la règle est précise.
 * Cela permet de conserver une colonne technique "priority" en base
 * sans demander à l'utilisateur de comprendre ou saisir un chiffre.
 */
const SCOPE_PRIORITY: Record<Scope, number> = {
  default: 100,
  category: 200,
  ingredient: 300,
}

const initialForm: FormState = {
  source: 'cellio',
  scope: 'category',
  category: '',
  ingredient_id: '',
  location_id: '',
  mode: 'fridge',
}

const scopeHelp: Record<Scope, { title: string; text: string; example: string }> = {
  default: {
    title: 'Défaut',
    text: 'Règle générale utilisée lorsqu’aucune règle plus précise ne s’applique.',
    example: 'Ex. tout ce qui n’a pas de règle particulière → Placard',
  },
  category: {
    title: 'Catégorie',
    text: 'Règle appliquée à toute une catégorie d’ingrédients.',
    example: 'Ex. Biscuits → Placard',
  },
  ingredient: {
    title: 'Exception ingrédient',
    text: 'Règle particulière pour un ingrédient précis. Elle prend automatiquement le dessus.',
    example: 'Ex. Chips → Bar',
  },
}

function scopeLabel(scope: Scope) {
  if (scope === 'ingredient') return 'Exception ingrédient'
  if (scope === 'category') return 'Catégorie'
  return 'Défaut'
}

function priorityExplanation(scope: Scope) {
  if (scope === 'ingredient') return 'Priorité automatique : 3 — exception la plus précise'
  if (scope === 'category') return 'Priorité automatique : 2 — règle de catégorie'
  return 'Priorité automatique : 1 — règle générale'
}

export default function StorageAdminPage() {
  const [data, setData] = useState<Data | null>(null)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scopeInfoOpen, setScopeInfoOpen] = useState(false)

  async function load() {
    setLoading(true)
    setError('')

    try {
      const r = await fetch('/api/admin/storage', { cache: 'no-store' })
      const j = await r.json()

      if (!r.ok) {
        throw new Error(j.error || 'Erreur de chargement.')
      }

      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    fetch('/api/admin/storage/ingredients', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setIngredients(Array.isArray(j?.ingredients) ? j.ingredients : []))
      .catch(() => {})
  }, [])

  const locations = data?.[form.source].locations ?? []

  const categories = useMemo(
    () =>
      [
        ...new Set([
          ...ingredients.map(i => i.categorie).filter((x): x is string => !!x?.trim()),
          ...(data
            ? [...data.frosti.rules, ...data.cellio.rules]
                .map(r => r.category)
                .filter((x): x is string => !!x?.trim())
            : []),
        ]),
      ].sort((a, b) => a.localeCompare(b, 'fr')),
    [ingredients, data],
  )

  function reset(source: Source = form.source) {
    setEditingId(null)
    setForm({ ...initialForm, source, location_id: '' })
    setScopeInfoOpen(false)
  }

  function edit(source: Source, rule: Rule) {
    setEditingId(rule.id)

    setForm({
      source,
      scope: rule.scope,
      category: rule.category ?? '',
      ingredient_id: rule.ingredient_id ?? '',
      location_id: rule.location_id,
      mode: rule.mode === 'freezer' ? 'freezer' : 'fridge',
    })

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      /*
       * La priorité est calculée ici et n'est plus saisie par l'utilisateur.
       * Les anciennes règles peuvent continuer à avoir une valeur historique
       * en base ; toute règle nouvellement enregistrée reçoit la priorité
       * correspondant à son niveau de précision.
       */
      const priority = SCOPE_PRIORITY[form.scope]

      const payload = {
        ...form,
        id: editingId,
        priority,
      }

      const r = await fetch('/api/admin/storage', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const j = await r.json()

      if (!r.ok) {
        throw new Error(j.error || 'Erreur de sauvegarde.')
      }

      await load()
      reset(form.source)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(source: Source, id: string) {
    if (!confirm('Supprimer cette règle ?')) return

    try {
      const r = await fetch('/api/admin/storage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, id }),
      })

      const j = await r.json()

      if (!r.ok) {
        throw new Error(j.error || 'Erreur de suppression.')
      }

      await load()

      if (editingId === id) {
        reset(source)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de suppression.')
    }
  }

  function locationName(source: Source, id: string) {
    return (
      data?.[source].locations.find(l => l.id === id)?.name ??
      'Emplacement inconnu'
    )
  }

  function description(rule: Rule) {
    if (rule.scope === 'ingredient') {
      return (
        ingredients.find(i => i.id === rule.ingredient_id)?.nom ??
        rule.ingredient_id ??
        'Ingrédient'
      )
    }

    if (rule.scope === 'category') {
      return rule.category ?? 'Catégorie'
    }

    return rule.mode === 'fridge'
      ? 'Défaut — frigo'
      : rule.mode === 'freezer'
        ? 'Défaut — congélateur'
        : 'Défaut'
  }

  return (
    <main className="min-h-screen bg-stone-50 pb-24 text-slate-900">
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-5 sm:py-7">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-emerald-700">
              Administration
            </p>

            <h1 className="mt-1 text-2xl font-black sm:text-3xl">
              Règles de rangement
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Exception ingrédient → catégorie → défaut.
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <Link
              href="/admin/storage/pending"
              className="hidden min-h-11 items-center rounded-xl border bg-white px-3 text-xs font-bold sm:flex"
            >
              À ranger
            </Link>

            <button
              type="button"
              onClick={() => void load()}
              className="min-h-11 rounded-xl border bg-white px-3 text-sm font-bold text-slate-600"
              aria-label="Actualiser"
            >
              ↻
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="mt-4 rounded-3xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <div className="font-black">
            Comment Mealio choisit-il la règle ?
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/70 p-3">
              <b>1. Exception ingrédient</b>
              <div className="mt-1 text-xs">
                Un ingrédient précis peut déroger à sa catégorie.
              </div>
            </div>

            <div className="rounded-2xl bg-white/70 p-3">
              <b>2. Catégorie</b>
              <div className="mt-1 text-xs">
                Une règle commune à toute une famille d’ingrédients.
              </div>
            </div>

            <div className="rounded-2xl bg-white/70 p-3">
              <b>3. Défaut</b>
              <div className="mt-1 text-xs">
                Le filet de sécurité lorsqu’il n’y a rien de plus précis.
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-100/70 p-3 text-xs">
            <b>Exemple :</b> si « Biscuits → Placard » existe et que
            « Chips → Bar » est créée comme exception, les chips vont au Bar
            tandis que les autres biscuits vont au Placard.
          </div>
        </section>

        <div className="mt-4">
          <AdminHelp
            title="Pourquoi trois niveaux ?"
            intro="Mealio détermine d’abord si l’achat va vers Frosti ou Cellio. Ensuite, les règles déterminent l’emplacement physique sans le coder en dur dans Mealio."
            sections={[
              {
                title: 'Défaut',
                children: (
                  <p>
                    C’est la règle générale. Elle s’applique quand aucune
                    catégorie et aucune exception ingrédient ne correspond.
                  </p>
                ),
              },
              {
                title: 'Catégorie',
                children: (
                  <p>
                    Elle permet de définir un comportement pour une famille
                    entière, par exemple « Biscuits → Placard ».
                  </p>
                ),
              },
              {
                title: 'Exception ingrédient',
                children: (
                  <p>
                    Elle est la plus précise. Elle sert lorsqu’un ingrédient
                    particulier doit être rangé autrement que sa catégorie,
                    par exemple « Chips → Bar ».
                  </p>
                ),
              },
            ]}
            warning="La priorité est maintenant calculée automatiquement à partir du type de règle. Tu n’as plus besoin de saisir un nombre."
          />
        </div>

        <form
          onSubmit={save}
          className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black">
              {editingId ? 'Modifier la règle' : 'Ajouter une règle'}
            </h2>

            {editingId && (
              <button
                type="button"
                onClick={() => reset()}
                className="min-h-10 rounded-xl px-3 text-xs font-bold text-slate-500"
              >
                Annuler
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-500">
              Application

              <select
                value={form.source}
                onChange={e => reset(e.target.value as Source)}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
              >
                <option value="frosti">❄️ Frosti</option>
                <option value="cellio">🍷 Cellio</option>
              </select>
            </label>

            <label className="text-xs font-black text-slate-500">
              Type de règle

              <select
                value={form.scope}
                onChange={e =>
                  setForm({
                    ...form,
                    scope: e.target.value as Scope,
                    category:
                      e.target.value === 'category' ? form.category : '',
                    ingredient_id:
                      e.target.value === 'ingredient'
                        ? form.ingredient_id
                        : '',
                  })
                }
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
              >
                <option value="default">Défaut</option>
                <option value="category">Catégorie</option>
                <option value="ingredient">Exception ingrédient</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setScopeInfoOpen(value => !value)}
            className="mt-2 flex min-h-11 w-full items-center justify-between rounded-xl bg-slate-50 px-3 text-left text-xs font-bold text-slate-600"
          >
            <span>{scopeHelp[form.scope].text}</span>
            <span className="ml-3 shrink-0">
              {scopeInfoOpen ? '⌃' : '⌄'}
            </span>
          </button>

          {scopeInfoOpen && (
            <div className="rounded-b-xl bg-slate-50 px-3 pb-3 text-xs text-slate-500">
              <b>{scopeHelp[form.scope].example}</b>
            </div>
          )}

          {form.scope === 'category' && (
            <label className="mt-3 block text-xs font-black text-slate-500">
              Catégorie

              <input
                list="storage-categories"
                required
                value={form.category}
                onChange={e =>
                  setForm({ ...form, category: e.target.value })
                }
                placeholder="Ex. Biscuits"
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold"
              />

              <datalist id="storage-categories">
                {categories.map(c => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          )}

          {form.scope === 'ingredient' && (
            <label className="mt-3 block text-xs font-black text-slate-500">
              Ingrédient officiel

              <select
                required
                value={form.ingredient_id}
                onChange={e =>
                  setForm({ ...form, ingredient_id: e.target.value })
                }
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
              >
                <option value="">Choisir…</option>

                {ingredients.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.nom}
                    {i.categorie ? ` · ${i.categorie}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-500">
              Emplacement

              <select
                required
                value={form.location_id}
                onChange={e =>
                  setForm({ ...form, location_id: e.target.value })
                }
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
              >
                <option value="">Choisir…</option>

                {locations.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {form.source === 'frosti'
                      ? l.is_fridge
                        ? ' · frigo'
                        : ' · congélo'
                      : ''}
                  </option>
                ))}
              </select>
            </label>

            {form.source === 'frosti' && form.scope === 'default' ? (
              <label className="text-xs font-black text-slate-500">
                Température

                <select
                  value={form.mode}
                  onChange={e =>
                    setForm({
                      ...form,
                      mode: e.target.value as Mode,
                    })
                  }
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
                >
                  <option value="fridge">Frigo</option>
                  <option value="freezer">Congélateur</option>
                </select>
              </label>
            ) : (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
                <div className="font-black">Priorité gérée par Mealio</div>
                <div className="mt-1">{priorityExplanation(form.scope)}</div>
              </div>
            )}
          </div>

          <button
            disabled={saving || loading}
            className="mt-4 min-h-13 w-full rounded-2xl bg-emerald-700 px-4 text-sm font-black text-white shadow-sm disabled:opacity-50"
          >
            {saving
              ? 'Enregistrement…'
              : editingId
                ? 'Enregistrer les modifications'
                : 'Ajouter la règle'}
          </button>
        </form>

        {loading ? (
          <div className="mt-4 rounded-3xl border bg-white p-10 text-center text-sm text-slate-500">
            Chargement…
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RuleTable
              title="❄️ Frosti"
              source="frosti"
              rules={data?.frosti.rules ?? []}
              locationName={locationName}
              description={description}
              onEdit={edit}
              onDelete={remove}
            />

            <RuleTable
              title="🍷 Cellio"
              source="cellio"
              rules={data?.cellio.rules ?? []}
              locationName={locationName}
              description={description}
              onEdit={edit}
              onDelete={remove}
            />
          </div>
        )}
      </div>
    </main>
  )
}

function RuleTable({
  title,
  source,
  rules,
  locationName,
  description,
  onEdit,
  onDelete,
}: {
  title: string
  source: Source
  rules: Rule[]
  locationName: (s: Source, id: string) => string
  description: (r: Rule) => string
  onEdit: (s: Source, r: Rule) => void
  onDelete: (s: Source, id: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-4">
        <h2 className="font-black">{title}</h2>
      </div>

      {rules.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">
          Aucune règle configurée.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rules.map(r => (
            <div key={r.id} className="p-4">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                {scopeLabel(r.scope)}
              </div>

              <div className="mt-1 font-black">
                {description(r)}
              </div>

              <div className="mt-1 text-sm font-semibold text-slate-600">
                → {locationName(source, r.location_id)}
              </div>

              <div className="mt-1 text-xs text-slate-400">
                {r.scope === 'ingredient'
                  ? 'Exception prioritaire'
                  : r.scope === 'category'
                    ? 'Règle de catégorie'
                    : 'Règle générale'}{' '}
                · {r.is_active ? 'active' : 'inactive'}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(source, r)}
                  className="min-h-11 rounded-xl border border-slate-200 text-xs font-black text-slate-700"
                >
                  Modifier
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(source, r.id)}
                  className="min-h-11 rounded-xl border border-red-200 text-xs font-black text-red-700"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
