# Enrichir les conversions Mealio

## Ordre conseillé

1. Corriger les identités et les formes : frais/sec, cru/cuit, fumé/non fumé, poudre/gousse.
2. Saisir dans Cookiwiki la quantité et l'unité dans leurs champs respectifs. Exemple : nom Ail, quantité 2, unité Gousse.
3. Saisir le stock en g, mL ou unités physiques précises. Une bouteille de 750 mL doit être représentée par 750 Millilitre pour le calcul actuel, et non 1 Pièce.
4. Ajouter seulement les équivalences vérifiées nécessaires aux ingrédients réellement utilisés.
5. Tester un manque, un stock suffisant et une unité incompatible dans le laboratoire Matcher, puis régénérer les courses.

## Où renseigner les valeurs

Dans Mealio, Admin → Ingrédients : ouvrir l'ingrédient puis utiliser « Densités culinaires ». Chaque ligne signifie : **1 unité renseignée ≈ poids_g_approx grammes**, pour l'ingrédient sélectionné. Utiliser un libellé reconnu de `unit_mappings`, sans créer de doublons de la même unité. Pour corriger une valeur depuis cet écran, supprimer sa ligne puis ajouter la valeur vérifiée.

La table réelle est `ingredient_densities`. Ne pas remplir les anciennes tables de conversions/bridges : le moteur utilise les densités explicites et les unités.

| Besoin | Donnée à renseigner | Limite |
|---|---|---|
| kg ↔ g, L ↔ mL | `unit_mappings.equivalence_reference` | Le moteur actuel lit ces équivalences ; les multiplicateurs à 1 dans l'export ne justifient pas une modification générale |
| Concentré de tomate : cuillère ↔ g | Masse mesurée par Cuillère à soupe | Ton export contient déjà 18 g par cuillère |
| Huile : g ↔ mL | Masse de 1 Millilitre, valeur vérifiée propre à cette huile | Ne pas extrapoler automatiquement depuis deux cuillères incohérentes |
| Produit uniforme : pièce ↔ g | Masse vérifiée de 1 Pièce | Une valeur globale devient inadaptée si tailles/produits varient |
| Saucisses de plusieurs formats | Mesurer le poids nécessaire dans la recette, ou distinguer des références adaptées | Ne pas attribuer à toute saucisse le poids d'un seul paquet |
| Bouteille ↔ mL | Contenance réelle sur le stock, exprimée directement en mL | Une équivalence globale par ingrédient ne décrit pas plusieurs formats |
| Tête d'ail ↔ gousses | Compter les gousses disponibles et saisir ce stock en Gousse | Le schéma de densités actuel ne représente pas directement une relation tête/gousses |

## Contrôler les données actuelles

Pour Huile d'olive, l'export donne 14 g par Cuillère à soupe (15 mL) et 5 g par Cuillère à café (5 mL). Cela représente deux rapports différents : 14/15 et 5/5 g par mL. Vérifier la source ou mesurer, plutôt que conserver ces valeurs comme une densité physique exacte. Même attention aux cuillères bombées/rases pour les solides.

Pour établir une densité liquide : peser un volume connu en retirant la masse du récipient, puis diviser masse/volume. Dans Admin, renseigner l'unité Millilitre et ce rapport dans le champ Grammes. Choisir une précision raisonnable et noter la mesure/source hors du tableau actuel ; celui-ci n'a pas de champs de provenance ou de fiabilité.

Pour une masse par pièce : le poids doit correspondre à la partie consommable et à la même forme que le stock/recette. Une moyenne culinaire reste une approximation, même si elle est explicitement renseignée. Pour le calcul strict, préférer des quantités pesées.

## Vérification minimale après ajout

- Tester un besoin dans l'unité de recette et vérifier la quantité convertie à la main.
- Avec un stock compatible insuffisant, vérifier que l'achat égale le manque.
- Avec un stock suffisant, vérifier qu'aucun achat n'est demandé.
- Avec une autre identité ou un conditionnement sans contenance, vérifier qu'aucune déduction n'est faite.
- Exécuter `npm test` après les changements de code. Ces tests locaux n'auditent pas ton Supabase réel : lancer également l'audit de données Admin après enrichissement.

## Évolution future utile

Si tu veux conserver les stocks en « bouteilles », « paquets » et « têtes », il faudra ajouter des informations de contenu sur chaque ligne de stock ou chaque format de produit, puis les intégrer au Matcher et aux écrans Frosti/Cellio. Ajouter des densités globales ne suffit pas. Ce correctif n'ajoute pas ce modèle de conditionnement.
