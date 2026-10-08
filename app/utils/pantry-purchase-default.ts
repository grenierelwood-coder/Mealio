/** A purchase format is distinct from the presence check; 1 g is never the default package. */
export function pantryPurchaseDefault(ingredient:{nom:string;unite_reference?:string|null}){
 const key=ingredient.nom.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(key==='mayonnaise')return {default_quantity:250,default_unit:'Gramme'}
 const unit=ingredient.unite_reference||'Gramme'
 return {default_quantity:unit==='Gramme'?250:unit==='Millilitre'?1000:1,default_unit:unit}
}
