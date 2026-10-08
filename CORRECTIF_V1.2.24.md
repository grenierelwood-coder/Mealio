# Mealio 1.2.24

Copier les fichiers par-dessus 1.2.23 et redémarrer. Aucun SQL, aucune modification de données.

## Bouton visible

Dans Admin → Intégration, « Avant la première mise en production » est désormais une section visible en permanence. Son fond clair et son texte sombre sont explicites. « Vérifier les connexions et réglages » a un fond indigo et un texte blanc explicites ; le bouton de téléchargement a un fond blanc et un texte sombre. Les instructions détaillées des quatre contrôles restent repliées pour garder l’écran court.

## Faux échec de l’historique corrigé

Le diagnostic introduit en 1.2.23 interrogeait `shopping_purchase_events.shopping_list_id`. La bonne colonne est **list_id**, déjà utilisée par les routes normales d’historique et de réappro. Seul le diagnostic avait ce mauvais champ. Il est corrigé ; ne pas créer ni renommer une colonne dans la DB pour contourner cette erreur.

Le test de diagnostic refuse désormais explicitement l’ancien champ et vérifie le filtre sur list_id, limité aux listes du foyer connecté.

## Bilan joint pour KH

11 contrôles réussis, 1 échec du diagnostic d’historique expliqué ci-dessus, 2 contrôles encore à faire.

- Frosti et Cellio retrouvent KH ; 117 lignes de stock accessibles.
- Cookiwiki accessible ; 396 ingrédients officiels et 117 produits configurés en présence.
- Frosti : 7 lieux, 6 règles actives ; Cellio : 4 lieux, 5 règles actives. Les destinations vérifiées existent.
- Tables de listes, signaux, rappels et surveillance de recettes accessibles.
- 11 lieux physiques, **aucun rappel d’inventaire activé**. Ce n’est pas un blocage : sélectionner un lieu dans Inventaire et enregistrer son délai si souhaité.

Après installation, relancer le même diagnostic pour confirmer la lecture réelle de l’historique. Restent le cycle complet sur un foyer de test, les essais réels de séparation de foyers, ainsi que build et smartphone sur l’installation. Ce correctif ne les annonce pas validés.

## Vérifications

605 tests locaux + 14 scénarios du laboratoire réussis ; tests de rendu des écrans et contrôles TypeScript ciblés UI/serveur réussis. Les tests vérifient la section visible, les couleurs explicites et le champ réel de l’historique. Pas de test de build complet ni de nouvelle lecture distante ici.
