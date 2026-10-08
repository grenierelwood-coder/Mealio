/** A quantity estimate matters only for effective quantitative requirements of this household. */
export function quantitativeRecipeEstimates(ingredients:{name:string;qty:number;unit:string;quantityEstimated?:boolean}[],resolved:{source_ingredient_name?:string;quantity_mode:string}[]){
 return ingredients.filter(i=>i.quantityEstimated&&resolved.some(r=>r.source_ingredient_name===i.name&&r.quantity_mode!=='presence')).map(i=>({name:i.name,qty:i.qty,unit:i.unit}))
}
