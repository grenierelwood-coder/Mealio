let authResolver = null
export function setAuthResolver(next) { authResolver = next }
export const calls = []
export const authCalls=[]
export const controlCalls=[]
let resolver = () => ({ data: [], error: null })
export function setDbResolver(next) { resolver = next; calls.length = 0 }
function client(source) {
  return { rpc(table, payload) {
    const call={source,table,action:'rpc',filters:[],payload};if(table==='mealio_claim_job'){controlCalls.push(call);return Promise.resolve({data:true,error:null})}calls.push(call);return Promise.resolve(resolver(call))
  }, from(table) {
    const call = { source, table, action: 'select', filters: [], payload: null }
    calls.push(call)
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (accept, reject) => Promise.resolve(call.select==='id,username,password' ? (authResolver ? authResolver(call) : {data:{id:call.filters.find(f=>f[1]==='id')?.[2],username:call.filters.find(f=>f[1]==='username')?.[2],password:''},error:null}) : resolver(call)).then(accept, reject)
      return (...args) => {
        if (['insert', 'update', 'delete', 'upsert'].includes(key)) { call.action = key; call.payload = args[0] }
        if (key === 'select') {call.select = args[0];if(args[0]==='id,username,password'){calls.splice(calls.indexOf(call),1);authCalls.push(call)}}
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
