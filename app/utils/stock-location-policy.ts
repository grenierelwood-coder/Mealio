export type StockSource = 'frosti' | 'cellio'
export type StockLocation = {
  id: string | null
  name: string | null
  source: StockSource
  is_fridge?: boolean | null
}
export type LocatedStock = {
  source: StockSource
  location_id?: string | null
  location_name?: string | null
  location_is_fridge?: boolean | null
}

// IDs belong to separate databases. Names are display labels, never identifiers.
export function stockLocationKey(source: StockSource, id?: string | null) {
  return JSON.stringify([source, id || null])
}

export function stockLocationLabel(location: StockLocation) {
  const app = location.source === 'frosti' ? 'Frosti' : 'Cellio'
  const kind = location.source === 'frosti'
    ? location.is_fridge === true ? ' · Frigo' : location.is_fridge === false ? ' · Congélateur' : ''
    : ''
  return `${app}${kind} · ${location.name?.trim() || 'Lieu non renseigné'}`
}

export function stockLocationOptions(locations: StockLocation[], items: LocatedStock[]) {
  const options = new Map<string, StockLocation>()
  for (const location of locations) options.set(stockLocationKey(location.source, location.id), location)
  for (const item of items) {
    const key = stockLocationKey(item.source, item.location_id)
    if (!options.has(key)) options.set(key, {
      id: item.location_id || null, name: item.location_name || null,
      source: item.source, is_fridge: item.location_is_fridge,
    })
  }
  return [...options.values()].sort((a, b) => stockLocationLabel(a).localeCompare(stockLocationLabel(b), 'fr'))
}

export function matchesStockLocation(item: LocatedStock, source: 'all' | StockSource, selected: string[]) {
  return (source === 'all' || item.source === source)
    && (selected.length === 0 || selected.includes(stockLocationKey(item.source, item.location_id)))
}
