# Mealio 1.2.12 — les quatre chantiers

Ce ZIP complète la version 1.2.11. Il contient uniquement les fichiers nouveaux ou modifiés, avec leurs répertoires.

## Installation : dans cet ordre

1. Copier les fichiers à la racine de Mealio, en conservant les répertoires, notamment `tests/fixtures` : une proposition de correction est aussi utilisée par le nouvel écran.
2. Dans le SQL Editor du projet Supabase **Mealio**, exécuter `sql/mealio_v1.2.12_reference.sql`. Le SQL 1.2.10 doit déjà être appliqué.
3. Dans le SQL Editor du projet Supabase **Cookiwiki**, exécuter `sql/mealio_v1.2.12_cookiwiki_recipes.sql`. Ce deuxième SQL ne doit pas être exécuté dans Mealio.
4. Redémarrer `npm run dev`, puis actualiser le navigateur. Pour un lancement avec `npm start`, refaire auparavant `npm run build`.
5. Régénérer les courses.

Aucun SQL Frosti ou Cellio supplémentaire. Les jonctions de foyers restent fondées sur le username, avec les UUID propres à chaque application.

## 1. Mélanges et alternatives

- Un mélange comporte des quantités propres à chaque composant. Le parent n'ajoute aucune quantité. Stock d'olives vertes et stock d'olives noires sont comparés séparément.
- Les répartitions non précisées sont initialisées à 50/50 et signalées comme estimées. La botte ciboulette/persil est proposée à 25 g de chaque : modifiable.
- Une alternative utilise exactement la branche sélectionnée. Le SQL initialise le premier choix, visible et modifiable dans l'Admin. Une alternative sans choix ne déduit aucun stock et déclenche une alerte.
- Les ingrédients facultatifs sont exclus par défaut et peuvent être inclus.
- Les choix enregistrés dans la recette sont communs aux foyers, comme la bibliothèque Cookiwiki. Le mode présence/quantité et les formats d'achat restent propres au foyer.
- Pas de découpage automatique de tout libellé contenant « et » : « Boursin ail et fines herbes » reste un produit.

## 2. Quantités manquantes

Des estimations ont été proposées pour beurre de cuisson, beurre pour le plat, gruyère à parsemer, persil, vin blanc, confiture et quelques assaisonnements. Elles sont enregistrées avec `quantity_source = estimated`.

Une estimation quantitative reste visible dans les alertes Courses, même si le stock couvre le besoin. Le lien ouvre directement la recette. Les produits gérés en présence par le foyer n'ajoutent pas une alerte de poids inutile. Une quantité réellement inconnue reste inconnue : elle ne devient pas un achat chiffré arbitraire.

L'eau du robinet est exclue des courses. Les équivalences complémentaires permettent aussi le suivi quantitatif des assaisonnements lorsqu'un foyer le souhaite. Les poids existants sont conservés.

## 3. Deux recettes reconstruites

Crevettes au bacon et Popcorn de poulet au sesame ont maintenant des propositions structurées, pour leurs quatre portions de base. Les quantités absentes du texte sont des estimations initiales, et non des quantités retrouvées dans une source originale.

Le SQL prépare 35 corrections parmi les 56 recettes et sauvegarde leurs ingrédients avant modification. Les 21 autres recettes restent inchangées.

Si une recette a été modifiée depuis l'export, elle est conservée : le SQL affiche une notice SKIPPED. Aller dans Admin → Correction des recettes, sélectionner la recette et utiliser « Charger la proposition Mealio ». Cela remplit seulement le brouillon ; vérifier puis enregistrer.

Dans ce nouvel écran : modifier les quantités, choisir les alternatives, ajuster les composants, inclure les facultatifs, ou désactiver « Estimation » après vérification. Une sauvegarde concurrente est refusée pour éviter d'écraser une autre modification.

Cookiwiki conserve une liste classique `name / qty / unit`. Les structures sont stockées séparément dans `mealio_recipe_structures`, dans sa propre DB. Si les ingrédients sont modifiés depuis Cookiwiki, Mealio utilise cette nouvelle liste plutôt qu'une ancienne structure. Les sauvegardes sont dans `mealio_recipe_change_log` ; elles ne sont pas supprimées lors d'une relance du SQL.

## 4. Campagne sur la DB réelle

Admin → Campagne d'intégration.

### Analyse des recettes

- Utilise les recettes, les modes épicerie et le stock réel du foyer connecté.
- Peut appeler Claude et enregistrer des propositions/mémoires. Ne crée ni courses ni stocks.
- Option de deuxième passage pour vérifier la stabilité des besoins.
- Budget Claude indicatif, contrôlé entre les analyses : la recette en cours peut le dépasser. En cas de requête échouée, le nombre d'appels peut être inconnu ; la campagne s'arrête.
- Arrêter attend la fin de la recette courante.
- Télécharger le rapport JSON. « À vérifier » distingue les estimations et les anomalies du moteur.

### Cycle complet avec écritures

1. Créer un **nouveau foyer de test** dans Frosti et Cellio, avec exactement le même username, terminé par `-test` ou `_test`.
2. Créer ses lieux de stockage et configurer ses règles de rangement dans Mealio. Activer au moins un produit en présence pour tester « presque terminé ».
3. Ce foyer doit n'avoir aucun planning, stock, liste active ou historique d'achat.
4. Se connecter à ce foyer dans Mealio, ouvrir Campagne d'intégration et choisir une recette simple ; les Gougères constituent un scénario testé ici.
5. Saisir exactement le nom du foyer et lancer le cycle.

Le cycle vérifie la résolution avant de créer un repas, puis planning, génération, régénération stable, achats, rangement dans les lieux précis, deuxième rangement sans doublon, historique, clôture, consommation, deuxième confirmation sans double déduction et signal presque terminé.

Les données créées sont conservées pour diagnostic. En cas d'échec, les étapes précédentes peuvent déjà avoir écrit dans les DB : le rapport indique où le cycle s'arrête. Utiliser un nouveau foyer vide pour une nouvelle campagne complète ou remettre manuellement le foyer de test à zéro.

Le calcul historique ne peut pas apprendre un rythme avec ce seul achat. Il lui faut au moins quatre jours d'achat distincts. Les cas temporels sont couverts par les tests automatiques existants ; leur validation réelle se fait avec les historiques accumulés. Un intervalle d'achat appris n'est pas une mesure exacte de consommation ou de stock restant.

## Résultats exécutés ici

- 510 tests automatiques réussis, plus 14 contrôles historiques du Matcher.
- 56 recettes corrigées/proposées : 475 besoins agrégés, 475 résolus sur le référentiel enrichi proposé, aucune quantité inconnue et aucune conversion manquante dans cette campagne.
- Toutes les variantes proposées passent aussi l'audit en suivi quantitatif ; les facultatifs y sont inclus pour contrôler leurs mesures.
- Cycle complet exécuté avec les vrais handlers de production et des DB en mémoire : sept étapes réussies, apprentissage historique explicitement non exécuté par ce cycle.
- Rendu Admin Ingrédients et édition 120 g : test existant toujours réussi.
- Vérification de syntaxe des fichiers TS/TSX modifiés et vérification ciblée des types. Les vérifications ciblées utilisent les dépendances disponibles et des déclarations Next minimales ; ce n'est pas un build Next complet.
- Les SQL n'ont pas été exécutés sur PostgreSQL ici. Ni ta DB réelle ni Claude réel n'ont été sollicités pendant cette préparation. Le nouvel écran permet leur campagne depuis ton installation.

Rapports détaillés : `test-reports/recipes-v1212-campaign.json`, `recipes-v1212-alternatives.json` et `integration-cycle-v1212.json`.
