/** Runs real production modules with local I/O doubles. No database, HTTP or AI traffic. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as nodeModule from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mealio-tests-'))
let transpile
if (typeof nodeModule.stripTypeScriptTypes === 'function') {
  transpile = source => nodeModule.stripTypeScriptTypes(source, { mode: 'strip' })
} else {
  const ts = (await import('typescript')).default
  transpile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const modules = [
 'tests/lot1/corrections-v1223.test.ts','app/utils/contextual-help.ts','app/utils/production-readiness-server.ts','app/utils/production-readiness-policy.ts','app/api/admin/readiness/route.ts',
 'tests/lot1/corrections-v1222.test.ts',
 'app/utils/expiry-policy.ts','app/utils/recipe-presence-policy.ts','app/utils/inventory-reminder-policy.ts','app/utils/inventory-reminder-server.ts','app/api/inventory/reminders/route.ts',
 'app/utils/pantry-purchase-default.ts','app/utils/recipe-watch-server.ts','app/api/admin/recipe-watch/route.ts','tests/lot1/corrections-v1221.test.ts',
 'app/api/admin/preparations/route.ts',
  'tests/lot1/corrections-v1220.test.ts',
  'app/utils/stock-analysis-cache.ts',
  'app/utils/ingredient-preparations-server.ts','app/utils/recipe-test-estimates.ts',
  'app/utils/shopping-issue-policy.ts', 'tests/lot1/shopping-corrections.test.ts',
  'app/utils/anti-gaspi-server.ts', 'app/api/anti-gaspi/route.ts', 'tests/lot1/anti-gaspi-v1214.test.ts',
  'app/utils/stock-source-link.ts',
  'tests/lot1/recipes-v1212.test.ts','app/api/meal-plans/route.ts','app/api/shopping-list/generate/route.ts','app/api/shopping-list/store/route.ts','app/api/shopping-list/finish/route.ts','app/api/meal-consumption/route.ts','app/api/purchases/route.ts','app/api/auth/me/route.ts','app/api/replenishment/route.ts','app/utils/storage-routing-server.ts','app/utils/recipe-quality-policy.ts','app/utils/recipe-structure-server.ts','app/utils/integration-campaign.ts','app/api/admin/recipes/route.ts',
  'tests/lot1/defaults-v1210.test.ts','app/api/point-frigo/route.ts','app/api/matcher/association/route.ts','app/utils/matcher-correction-link.ts',
  'app/utils/stock-location-policy.ts', 'tests/lot1/stock-location.test.ts',
  'app/utils/pantry-history-policy.ts', 'app/utils/pantry-signals-server.ts', 'app/api/pantry/signals/route.ts', 'app/api/stock/route.ts', 'app/api/replenishment/add/route.ts',
  'app/utils/replenishment-server.ts', 'app/utils/meal-consumption-server.ts', 'app/utils/meal-planner-server.tsx',
  'app/utils/pantry-policy.ts', 'app/utils/pantry-server.ts',
  'app/utils/matcher.tsx', 'app/utils/quantity-policy.ts', 'app/utils/data-quality.ts',
  'app/utils/auth-server.ts', 'app/utils/stock-fetcher.tsx', 'app/utils/household-server.tsx',
  'app/utils/cookiwiki-fetcher.tsx', 'app/lib/anthropic-server.ts',
  'app/api/shopping-list/route.ts', 'app/api/shopping-list/items/route.ts', 'app/api/admin/pantry/route.ts',
  'app/utils/shopping-requirement-policy.ts', 'app/utils/shopping-list-generator.ts', 'app/utils/official-unit-policy.ts',
  ...['lab', 'test', 'resolve', 'feedback'].map(name => `app/api/matcher/${name}/route.ts`),
  'scripts/matcher-test-fixtures.ts', 'scripts/matcher-contract.test.ts',
  'scripts/data-quality.test.ts', 'scripts/run-matcher-lab.ts',
  'tests/lot1/enrichment.test.ts', 'tests/lot1/recipe-campaign.test.ts', 'tests/lot1/pantry-history.test.ts',
  'tests/lot1/matcher-safety.test.ts', 'tests/lot1/api-session.test.ts', 'tests/lot1/shopping-requirements.test.ts', 'tests/lot1/pantry.test.ts',
]
const outputFor = relative => relative.replace(/\.(tsx?|mts)$/, '.mjs')
function resolveLocal(from, specifier) {
  if (specifier === 'next/server') return 'test-support/next.mjs'
  if (specifier === 'next/headers') return 'test-support/headers.mjs'
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  if (base === 'app/lib/supabase-server') return 'test-support/db.mjs'
  if (!specifier.startsWith('.')) return null
  const target = modules.find(module => module.replace(/\.(tsx?|mts)$/, '') === base)
  return target ? outputFor(target) : base
}

try {
  for (const relative of modules) {
    let code = transpile(fs.readFileSync(path.join(project, relative), 'utf8'))
    code = code.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g, (whole, prefix, quote, specifier) => {
      const target = resolveLocal(relative, specifier)
      if (!target) return whole
      let local = path.posix.relative(path.posix.dirname(outputFor(relative)), target)
      if (!local.startsWith('.')) local = './' + local
      return prefix + quote + local + quote
    })
    code = code.replace(/(\bfrom\s+['"][^'"\n]+\.json['"])(?!\s+with)/g, '$1 with { type: "json" }')
    const destination = path.join(temporary, outputFor(relative))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, code)
  }
  fs.cpSync(path.join(project, 'tests/lot1/support'), path.join(temporary, 'test-support'), { recursive: true })
  fs.cpSync(path.join(project,'tests/fixtures'),path.join(temporary,'tests/fixtures'),{recursive:true})
  const tests = ['tests/lot1/corrections-v1223.test.mjs','tests/lot1/corrections-v1222.test.mjs','tests/lot1/corrections-v1221.test.mjs','tests/lot1/corrections-v1220.test.mjs','tests/lot1/shopping-corrections.test.mjs','tests/lot1/anti-gaspi-v1214.test.mjs','tests/lot1/recipes-v1212.test.mjs','tests/lot1/defaults-v1210.test.mjs','tests/lot1/stock-location.test.mjs','tests/lot1/enrichment.test.mjs','tests/lot1/recipe-campaign.test.mjs','tests/lot1/pantry-history.test.mjs','scripts/matcher-contract.test.mjs', 'scripts/data-quality.test.mjs',
    'tests/lot1/matcher-safety.test.mjs', 'tests/lot1/api-session.test.mjs', 'tests/lot1/shopping-requirements.test.mjs', 'tests/lot1/pantry.test.mjs']
  const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: temporary, encoding: 'utf8', env:{...process.env,MEALIO_TEST_REPORT_DIR:path.join(project,'test-reports')} })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.status !== 0) process.exitCode = result.status || 1
  if (!process.exitCode) {
    const lab = spawnSync(process.execPath, ['scripts/run-matcher-lab.mjs'], { cwd: temporary, encoding: 'utf8', env:{...process.env,MEALIO_TEST_REPORT_DIR:path.join(project,'test-reports')} })
    process.stdout.write(lab.stdout ?? '')
    process.stderr.write(lab.stderr ?? '')
    process.exitCode = lab.status || 0
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
