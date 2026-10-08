import test from 'node:test'
import assert from 'node:assert/strict'
import { stockLocationOptions, stockLocationKey, matchesStockLocation, stockLocationLabel } from '../../app/utils/stock-location-policy'

const cold = { source: 'frosti' as const, location_id: 'shared-id', location_name: 'Cuisine', location_is_fridge: true }
const dry = { source: 'cellio' as const, location_id: 'shared-id', location_name: 'Cuisine' }
test('lieux : même nom et même ID dans deux bases ne fusionnent pas', () => {
  const options = stockLocationOptions([], [cold, dry])
  assert.equal(options.length, 2)
  assert.ok(matchesStockLocation(cold, 'all', [stockLocationKey('frosti', 'shared-id')]))
  assert.ok(!matchesStockLocation(dry, 'all', [stockLocationKey('frosti', 'shared-id')]))
  assert.equal(stockLocationLabel(options.find(location => location.source === 'frosti')!), 'Frosti · Frigo · Cuisine')
})
test('lieux : sélection mixte Frosti/Cellio et intersection avec la source', () => {
  const selected = [stockLocationKey('frosti', 'shared-id'), stockLocationKey('cellio', 'shared-id')]
  assert.ok(matchesStockLocation(cold, 'all', selected))
  assert.ok(matchesStockLocation(dry, 'all', selected))
  assert.ok(!matchesStockLocation(dry, 'frosti', selected))
  assert.ok(!matchesStockLocation({ source: 'frosti', location_id: 'garage' }, 'all', selected))
})
test('lieux : stocks sans emplacement restent consultables par application', () => {
  const unknown = [{ source: 'frosti' as const }, { source: 'cellio' as const, location_id: null }]
  assert.equal(stockLocationOptions([], unknown).length, 2)
  const selected = [stockLocationKey('cellio', null)]
  assert.ok(matchesStockLocation(unknown[1], 'all', selected))
  assert.ok(!matchesStockLocation(unknown[0], 'all', selected))
  assert.ok(matchesStockLocation(unknown[0], 'all', []))
})
test('lieux : liste serveur conserve les lieux vides et le renommage', () => {
  const options = stockLocationOptions([
    { source: 'frosti', id: 'shared-id', name: 'Cuisine RDC', is_fridge: true },
    { source: 'cellio', id: 'reserve', name: 'Réserve vide' },
  ], [cold, cold])
  assert.equal(options.length, 2)
  assert.equal(options.find(location => location.id === 'shared-id')?.name, 'Cuisine RDC')
  assert.ok(matchesStockLocation(cold, 'all', [stockLocationKey('frosti', 'shared-id')]))
})
