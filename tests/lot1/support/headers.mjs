let values = new Map()
export function setCookies(next) { values = new Map(Object.entries(next)) }
export async function cookies() { return { get: name => values.has(name) ? { value: values.get(name) } : undefined } }
