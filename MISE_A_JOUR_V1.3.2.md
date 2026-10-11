# Mealio 1.3.2 — recherche des recettes dans le planning

Base utilisée : Mealio_V1.3.1.zip fourni le 10 octobre 2026.

## Cause et comportement corrigé

La recherche existante utilisait le titre, la description et les tags, mais pas les ingrédients, et conservait les accents. Elle appliquait aussi automatiquement le rôle du repas comme filtre : avec Plat sélectionné par défaut, une recette classée Entrée, Accompagnement ou Dessert était masquée. Enfin, la lecture du catalogue ne gérait pas la pagination Supabase. Ces défauts sont confirmés dans le code ; la recette précise de votre tentative n’a pas été communiquée.

- Recherche insensible aux accents et à la casse, dans les titres et les noms d’ingrédients. Comme Cookiwiki, tous les mots saisis doivent être présents ; ils peuvent être répartis entre titre et ingrédients. Les virgules séparent aussi les termes.
- Exclusions possibles, par exemple `gratin -courgette`, sur les ingrédients. Une simple mention en description ou dans un tag ne crée plus un résultat qui ne contient pas réellement le terme dans le titre ou la liste d’ingrédients.
- Les ingrédients structurés (composants et alternatives) sont recherchables sans changer les quantités ni le Matcher.
- Toutes les catégories sont visibles par défaut. Les boutons sous Place dans le repas choisissent le rôle à enregistrer dans le planning. Plat reste le rôle initial. La case Limiter à ce type de repas applique le filtre uniquement si elle est cochée.
- La difficulté reste un filtre explicite. Un bouton Retirer les filtres est disponible si une recherche filtrée ne donne aucun résultat, en conservant le texte recherché.
- Affichage du nombre trouvé / nombre total. Catalogue chargé par pages de 500 avec un ordre stable titre + id ; une erreur de page remonte une erreur au lieu de présenter une liste partielle comme complète.
- Version de navigation : v1.3.2.

Le build a aussi révélé deux signatures de routes incompatibles avec les types générés de Next : GET meal-consumption et POST shopping-list/store déclaraient Request facultatif. Le paramètre est maintenant obligatoire dans la déclaration, conformément à l’appel de Next. Leur logique est conservée.

## Validation

649 tests offline réussis, dont 11 nouveaux tests sur la recherche et la pagination. Les 14 scénarios du laboratoire Matcher passent. Les tests de rendu et d’interaction existants passent, ainsi que le nouveau test de l’écran Planning : titre sans accent, ingrédient absent du titre, filtre de rôle et retrait des filtres. TypeScript OK.

Compilation Next de production vérifiée avec `next build --webpack`, des variables Supabase fictives et des réponses Google Fonts substituées pour cette compilation locale. Cela ne valide ni les polices téléchargées, ni vos clés, ni les appels aux DB réelles. Le build par défaut de votre projet reste `next build` et doit être vérifié avec votre configuration. Aucun secret ou substitut de validation n’est ajouté à l’archive.

## Installation

Copier le contenu de cette archive à la racine du projet Mealio, en conservant vos fichiers .env. Cette archive contient le projet complet, pas seulement app/. Aucun nouveau SQL n’est nécessaire pour ce correctif.

```powershell
npm ci
npm run verify:production
git add .
git status
git commit -m "Fix planning recipe search and complete catalogue loading"
git push
```

Après le déploiement Vercel, vérifier v1.3.2 dans Mealio. Dans Planning, ouvrir Ajouter et rechercher le même mot que dans Cookiwiki. Laisser la case Limiter à ce type de repas décochée pour rechercher toutes les recettes. Tester un titre avec accents, un ingrédient absent du titre et l’ajout du résultat au bon créneau.
