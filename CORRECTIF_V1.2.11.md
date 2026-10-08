# Mealio 1.2.11

Copier les fichiers du ZIP à la racine du projet en conservant les répertoires. Redémarrer `npm run dev` et actualiser le navigateur. Aucune migration SQL supplémentaire pour ce correctif. Le SQL 1.2.10 reste nécessaire si le lot précédent n'a pas été appliqué.

## Corrections

- Admin → Ingrédients : le filtre global des unités fonctionne sans fiche ouverte. La restriction Gousse pour Ail s'applique à sa fiche uniquement.
- La fiche affiche « Synonymes / correspondances » et « Poids moyens et conversions ».
- Chaque poids possède un bouton Modifier. « Enregistrer le poids » ajoute ou remplace l'équivalence de cet ingrédient et de cette unité.
- Menu principal et accueil : Inventaire, avec une icône de liste. Les inventaires par lieu restent ceux du lot précédent.

## Ail

Conformément à la règle choisie, Pièce reste interdite pour Ail. Dans Inventaire, sélectionner le lieu, remplacer Pièce par Gousse et garder la quantité uniquement si chaque pièce historique était une gousse. Si c'était une tête, renseigner le nombre de gousses réellement présentes. Ce n'est pas une conversion globale Pièce → Gousse.

Dans Admin → Ingrédients → Ail, le poids moyen de 1 Gousse est 5 g. Les autres équivalences physiques éventuelles se consultent dans sa fiche.

## Saucisse à 120 g

Admin → Ingrédients → Saucisse fraîche → Poids moyens et conversions → Modifier sur la ligne Pièce → saisir 120 → Enregistrer le poids. Ou ajouter Pièce / 120 si cette ligne manque. L'équivalence sera 1 Pièce ≈ 120 g pour cet ingrédient. Quatre saucisses correspondent à 480 g.

La même modification doit être faite séparément sur Saucisse de Toulouse si souhaitée : les poids sont propres à chaque ingrédient. Régénérer les courses après modification.

## Lire les données enregistrées

- Par ingrédient : sa fiche, rubriques Synonymes / correspondances et Poids moyens et conversions.
- Toutes les lignes : Admin → Données → ingredient_densities (poids), ingredient_synonyms (associations au référentiel), unit_mappings (unités).
- Associations de stock apprises : Matcher ; table matcher_memory dans Admin → Données.
- ingredient_unit_conversions est ancien et ne décrit pas les poids actuellement utilisés.

## Proposition pour terminer les quatre sujets

1. Mélanges : décomposer les ingrédients reliés par « et » dans Cookiwiki ; utiliser des quantités distinctes ou des proportions explicites. Pour « ou », enregistrer une alternative choisie avant génération. Ne pas assimiler l'ensemble du mélange à un seul composant.
2. Quantités absentes : présence pour les produits configurés ainsi par le foyer ; quantité estimée et identifiable dans Cookiwiki pour beurre/gruyère et autres produits suivis quantitativement. Les ingrédients facultatifs doivent pouvoir être inclus ou écartés. Aucune quantité inconnue ne doit devenir automatiquement zéro.
3. Recettes incomplètes : réécrire et valider les listes structurées de Crevettes au bacon et Popcorn de poulet au sesame à partir du texte et des portions. Une conversion supplémentaire ne répare pas une liste d'ingrédients manquante.
4. Intégration réelle : utiliser un foyer de test et des stocks contrôlés. Vérifier planning → génération → régénération → achats → rangement par lieu → consommation → presque terminé → proposition de réapprovisionnement. Ajouter les cas farine de riz/blé, conversions mixtes, mémoire après validation, refus d'association, isolation de deux foyers et doubles clics. Exécuter séparément les cas Claude et mesurer ses appels.

Ces quatre sujets sont une proposition pour la suite, pas des fonctionnalités ajoutées par ce ZIP. La campagne réelle sur Supabase/Claude n'a pas été exécutée ici.

## Vérifications

- `npm test` : 440 tests réussis + 14 contrôles historiques du Matcher réussis.
- `npm run test:ui` : rendu Admin avec des unités chargées et aucun brouillon, ouverture de fiche, édition et envoi de Pièce / 120 g. HTTP simulé, aucune écriture Supabase.
- Le test de rendu reproduit le crash avec l'ancien fichier et passe avec le correctif.
- Aucun build Next complet ni test dans un navigateur connecté à Supabase effectué ici.
