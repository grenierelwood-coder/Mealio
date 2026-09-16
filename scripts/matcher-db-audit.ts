import { loadReferenceData } from '../app/utils/matcher'
import { getQuantityMode } from '../app/utils/quantity-policy'

async function main() {
  const ref = await loadReferenceData()
  const failures: string[] = []

  for (const ingredient of ref.officialList) {
    if (getQuantityMode(ingredient) !== 'presence') continue
    const densities = ref.densities.filter(d => d.ingredient_id === ingredient.id)
    if (densities.length) {
      failures.push(
        `PRESENCE_WITH_DENSITY: ${ingredient.nom} → ${densities.map(d => d.unite).join(', ')}`,
      )
    }
  }

  const officialIds = new Set(ref.officialList.map(i => i.id))
  for (const density of ref.densities) {
    if (!officialIds.has(density.ingredient_id)) {
      failures.push(`ORPHAN_DENSITY: ${density.ingredient_id} / ${density.unite}`)
    }
    if (!Number.isFinite(Number(density.poids_g_approx)) || Number(density.poids_g_approx) <= 0) {
      failures.push(`INVALID_DENSITY: ${density.ingredient_id} / ${density.unite} / ${density.poids_g_approx}`)
    }
  }

  if (ref.densities.length === 0) {
    console.log('Matcher DB audit: OK — aucune densité référencée.')
  } else {
    console.log(`Matcher DB audit: ${ref.densities.length} densité(s) contrôlée(s).`)
  }

  if (failures.length) {
    console.error(`Matcher DB audit: ${failures.length} échec(s)`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log('Matcher DB audit: PASS')
}

main().catch(error => {
  console.error('Matcher DB audit: ERROR', error)
  process.exitCode = 1
})
