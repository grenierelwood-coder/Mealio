/** Calendar comparisons, including timestamp columns, always use the household timezone. */
export function parisDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(now)}
export function expiryDay(raw:string|null|undefined):string|null{
 if(!raw)return null
 const value=raw.trim()
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const stamp=Date.parse(`${value}T12:00:00Z`);return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?value:null}
 if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value))return null
 const prefix=value.slice(0,10);if(!expiryDay(prefix))return null
 // A timestamp without offset uses its declared calendar date, never the server timezone.
 if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(value))return Number.isFinite(Date.parse(value.replace(' ','T')+'Z'))?prefix:null
 const stamp=Date.parse(value);return Number.isFinite(stamp)?parisDate(new Date(stamp)):null
}
export function expiryDays(raw:string|null|undefined,today:string):number|null{
 const day=expiryDay(raw);if(!day)return null
 return Math.round((Date.parse(`${day}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000)
}
