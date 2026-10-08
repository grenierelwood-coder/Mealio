import test from 'node:test'
import assert from 'node:assert/strict'
import { groupShoppingIssues, correctionAction } from '../../app/utils/shopping-issue-policy'
test('Courses : une entrée par produit, doublons masqués et recettes distinctes conservées',()=>{
 const base={produit:"Huile d’olive",issue_type:'CONVERSION_MISSING',message:'Poids inconnu',unit:'g'}
 const groups=groupShoppingIssues([base,{...base,id:'other'}, {...base,recipe_id:'r1'},{...base,recipe_id:'r2'},{...base,produit:'Oignon'}])
 assert.equal(groups.length,2);assert.equal(groups[0].issues.length,3);assert.deepEqual(groups[0].issues.map(i=>i.recipe_id),[undefined,'r1','r2'])
})
test('Courses : proposition stock et recette gardent les deux libellés dans le bon sens',()=>{
 assert.deepEqual(correctionAction({produit:'Saucisse fraîche',issue_type:'STOCK_MATCH_REVIEW',message:'Proposition IA à valider : « Saucisses ».'}),{kind:'association',href:'/matcher/correction?name=Saucisses&target_name=Saucisse%20fra%C3%AEche',name:'Saucisses',target:'Saucisse fraîche'})
 const action=correctionAction({produit:'Saucisses bretonnes',issue_type:'INGREDIENT_REVIEW',message:'Proposition « Saucisse fraîche » pour « Saucisses bretonnes » à valider.'})
 assert.equal(action.name,'Saucisses bretonnes');assert.equal(action.target,'Saucisse fraîche')
})
test('Courses : quantité et rangement ouvrent leurs écrans, unité inconnue ne devient pas un poids moyen',()=>{
 const recipe=correctionAction({produit:'Beurre',issue_type:'RECIPE_QUANTITY_ESTIMATED',message:'Estimation',recipe_id:'r'})
 assert.equal(recipe.kind,'external');assert.equal(recipe.href,'/admin/recipes?recipe_id=r')
 assert.equal(correctionAction({produit:'Ail',issue_type:'UNIT_UNKNOWN',message:'Unité inconnue'}).kind,'external')
 assert.equal(correctionAction({produit:'Oignon',issue_type:'CONVERSION_MISSING',message:'Conversion impossible'}).kind,'density')
 assert.equal(correctionAction({produit:'Oignon',issue_type:'MATCH',phase:'storage',message:'Rangement impossible'}).href,'/admin/storage/pending')
})
