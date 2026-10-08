# Mealio 1.2.14 — recherche et écrans simplifiés

Le ZIP contient uniquement les fichiers nouveaux ou modifiés depuis la version 1.2.12. Il inclut aussi les corrections 1.2.13, afin de fonctionner si cette dernière copie n’a pas encore été faite. Les SQL des versions précédentes restent nécessaires ; aucun SQL supplémentaire dans cette livraison.

## Installation et repère de version

1. Arrêter le serveur de développement.
2. Copier les fichiers à la racine de Mealio en conservant les répertoires.
3. Relancer `npm run dev`, puis actualiser le navigateur avec Ctrl+F5. En production : refaire `npm run build` avant `npm start`.
4. Inventaire et Campagne d’intégration doivent afficher **Écran 1.2.14**. Si ce repère n’apparaît pas, vérifier que les fichiers ont remplacé ceux du projet réellement lancé.

La capture fournie montrait le précédent écran d’intégration, sans sélecteur d’analyse d’une recette. Les actions principales ont maintenant une couleur explicite, pour conserver un contraste lisible même si leurs utilitaires de fond ne sont pas chargés.

## Rangement

Retiré du menu principal et du menu mobile. Reste dans Admin → Règles de rangement.

## Anti-gaspi

Défauts corrigés :

- Les ingrédients Cookiwiki sans association officielle étaient proposés avec un identifiant `label:…`, puis ignorés lorsque la recherche attendait seulement des IDs officiels. Ils sont maintenant recherchés par leur libellé normalisé exact.
- Une sélection mixte d’ingrédients et de lignes du stock ignorait les lignes du stock. Les deux sélections sont désormais combinées et dédupliquées.
- Les synonymes/pluriels utilisent la normalisation du Matcher. Les identités officielles contradictoires restent distinctes : farine de riz et farine de blé ne sont pas assimilées.
- La recherche lit les ingrédients actifs des recettes : choix retenu, composants séparés, facultatifs exclus. Une structure ancienne n’écrase pas une modification plus récente faite dans Cookiwiki.
- Les choix issus d’un même ID officiel sont regroupés dans les résultats de recherche.
- Une erreur de recherche laisse les commandes accessibles pour permettre de réessayer.

Le sélecteur **Recherche des ingrédients** propose :

- **OU** : au moins un produit sélectionné dans la recette ; celles qui en utilisent le plus passent en tête. C’était le comportement précédent.
- **ET** : tous les produits sélectionnés doivent être présents dans la même recette.

La recherche ne porte pas sur le titre d’une recette. Elle ne fait pas appel à Claude, ne modifie pas les stocks et n’invente pas une conversion. Les propositions d’Anti-gaspi ne signifient pas que toutes les quantités d’une recette sont disponibles : le calcul des courses reste assuré par le Matcher.

Pour les ingrédients sans association, la recherche est exacte après normalisation ; elle ne suppose pas une équivalence entre deux produits différents. Les recettes dont les données d’ingrédients sont encore vides doivent être complétées dans Admin → Correction des recettes.

## Inventaire

Le champ **Chercher un ingrédient dans les stocks** est placé avant le filtre de lieu. Le périmètre initial est **Tous les lieux · Frosti et Cellio**. Le bouton **Voir tous les lieux Frosti et Cellio** permet d’y revenir après un inventaire limité à un lieu.

La recherche porte sur le nom de la ligne de stock, l’ingrédient officiel et ses synonymes enregistrés. « Saucisse fraîche » peut donc retrouver une ligne « Saucisses » si l’association est enregistrée. Chaque résultat indique la source et le lieu précis. Les lignes à quantité zéro restent affichées.

Il s’agit des lieux où une ligne de ce produit est enregistrée, pas d’une présence supposée dans tous les placards ni des lieux de rangement futurs. Les noms de lieux restent des libellés ; les écritures utilisent les identifiants propres à chaque source et le username du foyer pour l’isolation.

La validation reste séparée par lieu/source avec vérification des anciennes valeurs. Changer de périmètre ou actualiser demande d’abandonner les corrections non enregistrées. Le compteur signale les corrections masquées par la recherche mais incluses dans la validation du périmètre courant.

## Intégration

Admin → Campagne d’intégration, premier bloc :

1. Choisir une recette dans **Recette à analyser**.
2. Cliquer **Tester la recette sélectionnée**, bouton vert.
3. Ou cliquer **Tester toutes les recettes**, bouton violet.

Ces analyses utilisent les données du foyer habituel. Elles peuvent appeler Claude et alimenter la mémoire ; elles n’écrivent pas de courses ou de stock. Le budget est indicatif et peut arrêter la campagne avant la dernière recette.

Le second bloc est un cycle d’achats réel réservé à un foyer vide avec username finissant par `-test` ou `_test`. Il crée des données de test. Son verrou n’empêche pas d’utiliser les deux boutons d’analyse du premier bloc.

## Recettes : saisie simple

Les boutons « Décomposer en mélange » et « Créer une alternative » sont retirés. Pour une nouvelle correction :

- « Ciboulette et persil » : saisir deux lignes, chacune avec sa quantité.
- « X ou Y » : garder l’ingrédient réellement choisi.
- Corriger nom, quantité et unité, puis enregistrer et régénérer les courses.

Les structures déjà préparées restent compatibles. Un choix existant propose simplement **Ingrédient retenu**, et seul ce choix est édité à l’écran. Les composants existants sont affichés comme des ingrédients séparés. Les choix enregistrés dans Cookiwiki restent communs aux foyers.

Sur chaque ligne, les indications distinguent :

- **Quantité absente** : champ de quantité vide.
- **Quantité libre / non chiffrée** : quantité zéro, comme sel selon le goût ; cela n’impose pas de peser les produits gérés en présence.
- **Quantité estimée — à vérifier** : un chiffre a été proposé par Mealio, pas retrouvé dans la recette originale.

Si les SQL 1.2.12 ont déjà été appliqués, beaucoup de quantités auparavant absentes sont maintenant des estimations. Exemple de la proposition **Gratin de courgettes** : « beurre pour le plat » était à zéro sans unité ; il a été proposé à **10 g de Beurre**, avec la case Estimation et une note. Ajuster si nécessaire, puis décocher Estimation après vérification. L’écran ne garantit pas la justesse d’un chiffre simplement parce que cette case est décochée.

## Accès à Frosti et Cellio

Mealio sait déjà lire et corriger leurs bases via Supabase. L’Inventaire modifie donc directement quantité et unité dans la source du foyer ; il n’est pas nécessaire d’ouvrir ces apps pour cela.

Ouvrir un écran d’édition est une navigation web distincte. Les adresses Supabase ne donnent pas l’adresse publique de l’application ni la route d’une fiche. Il manque l’URL d’une fiche ouverte dans chaque app pour configurer les liens précis.

Les variables facultatives et le fonctionnement des liens sont détaillés dans `CORRECTIF_V1.2.13.md` : `NEXT_PUBLIC_FROSTI_APP_URL`, `NEXT_PUBLIC_CELLIO_APP_URL`, et les chemins de fiche `NEXT_PUBLIC_FROSTI_STOCK_PATH` / `NEXT_PUBLIC_CELLIO_STOCK_PATH`. Les liens ouvrent un nouvel onglet ; Mealio reste ouvert. Ne pas confondre ces adresses avec les variables existantes des projets Supabase.

## Vérifications

- 577 tests locaux réussis, dont les recherches sur les ingrédients actifs des 56 recettes corrigées, les modes OU/ET, les libellés sans ID officiel, les sélections mixtes et l’isolation du foyer.
- Les 14 cas historiques du laboratoire réussissent.
- Écrans réels exercés avec React et HTTP simulés : recherche globale par nom officiel dans deux lieux/sources, sauvegardes séparées, boutons d’intégration et leur contraste, absence du menu Rangement, quantités absentes/estimées et seul choix actif édité.
- Contrôles de typage ciblés client/serveur sans erreur.

Ces tests utilisent des données et accès simulés. Aucun test sur ton Supabase ou Claude réel, ni build Next complet ici. Pour rejouer localement : `npm test`, puis `npm run test:ui` après installation des dépendances. La campagne réelle se lance dans l’écran Intégration.
