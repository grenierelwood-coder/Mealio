import { analyzeAndMatchIngredients } from '../app/utils/matcher'
import { getRecipeIngredientsFromCookiwiki } from '../app/utils/cookiwiki-fetcher'
import { getHouseholdStock } from '../app/utils/stock-fetcher'

async function runTest() {
  console.log("🚀 Lancement du test global avec vrais stocks (Frosti + Cellio)...")

  const TEST_RECIPE_ID = 'e2035bf0-c847-42e4-9f7a-adeb8059301e'


const { data: frostiData } = await frostiDb
    .from('items')
    .select('produit, qte, unite')
    .eq('user_id', KH) // Votre ID pour Frosti

  const { data: cellioData } = await cellioDb
    .from('items')
    .select('produit, qte, unite')
    .eq('user_id', KH) // Votre ID pour Cellio


  try {
    // 1. Récupération des ingrédients de la recette
    const recipeIngredients = await getRecipeIngredientsFromCookiwiki(TEST_RECIPE_ID)
    
    if (recipeIngredients.length === 0) return

    // 2. Récupération réelle des stocks depuis Frosti et Cellio
    const realStock = await getHouseholdStock(TEST_USER_ID)

    // 3. Exécution du Cerveau Mealio
    console.log("\n🧠 Démarrage du moteur de rapprochement sémantique...")
    const result = await analyzeAndMatchIngredients(
      recipeIngredients,
      realStock,
      TEST_USER_ID
    )

    console.log("\n🛒 Liste de courses finale (croisée avec les vrais stocks) :")
    console.dir(result, { depth: null })

  } catch (error) {
    console.error("❌ Erreur lors du test :", error)
  }
}

runTest()