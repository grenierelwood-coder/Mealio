export const calls = []
let resolver = () => ({ data: [], error: null })
export function setDbResolver(next) { resolver = next; calls.length = 0 }
function client(source) {
  return { rpc(table, payload) {
    const call={source,table,action:'rpc',filters:[],payload};calls.push(call);return Promise.resolve(resolver(call))
  }, from(table) {
    const call = { source, table, action: 'select', filters: [], payload: null }
    calls.push(call)
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (accept, reject) => Promise.resolve(resolver(call)).then(accept, reject)
      return (...args) => {
        if (['insert', 'update', 'delete', 'upsert'].includes(key)) { call.action = key; call.payload = args[0] }
        if (key === 'range') call.range = args
        if (['eq', 'in', 'neq'].includes(key)) call.filters.push([key, ...args])
        if (['maybeSingle', 'single'].includes(key)) call.single = true
        return query
      }
    }})
    return query
  }}
}
export const mealioServerDb = client('mealio')
export const frostiServerDb = client('frosti')
export const cellioServerDb = client('cellio')
export const cookiwikiServerDb = client('cookiwiki')
