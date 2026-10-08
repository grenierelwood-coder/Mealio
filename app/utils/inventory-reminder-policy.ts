export type InventoryReminder={source:'frosti'|'cellio';location_id:string;name:string;interval_weeks:number|null;last_completed_at:string|null;configured_at:string|null;due:boolean;due_at:string|null}
export function inventoryDeadline(row:{interval_weeks:number|null;last_completed_at:string|null;configured_at:string|null},now=Date.now()){
 const anchor=Date.parse(row.last_completed_at||row.configured_at||'');const weeks=Number(row.interval_weeks)
 if(!Number.isFinite(anchor)||!Number.isInteger(weeks)||weeks<1||weeks>104)return {due:false,due_at:null}
 const due=anchor+weeks*7*86400000;return {due:now>=due,due_at:new Date(due).toISOString()}
}
