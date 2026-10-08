# Mealio 1.2.9 — lieux de stockage et clarification du référentiel

## Installation

Cette archive contient uniquement les changements depuis 1.2.8. Installer d’abord 1.2.8 si nécessaire, puis copier les fichiers en respectant les répertoires. Aucune nouvelle migration n’est nécessaire pour le filtre des stocks. Lancer `npm test`, redémarrer `npm run dev`, puis régénérer les courses pour actualiser leurs messages d’aide.

## Filtrer les stocks par lieu

Dans Stocks, ouvrir « Tous les lieux de stockage · Choisir » et cocher un ou plusieurs lieux. Exemple : Frigo Cuisine (Frosti) + Placard Cuisine (Cellio). Les lieux proviennent de l’API existante, qui lit les emplacements propres au foyer dans les deux applications.

- « Tous » permet une sélection mixte Frosti + Cellio.
- Les boutons Frosti/Cellio limitent les lieux proposés à l’application choisie et réinitialisent la sélection précédente.
- Aucun lieu coché signifie tous les lieux de l’application sélectionnée.
- « Tous les lieux » ou « Réinitialiser les filtres » enlève la sélection.
- Les autres filtres (recherche, catégorie, rayon, péremption) continuent à s’appliquer.
- Deux lieux de même nom restent distincts grâce au couple application + ID. Les stocks sans lieu renseigné restent consultables.
- La sélection est conservée lors d’une actualisation, mais pas après avoir quitté la page.

## Où en est l’enrichissement de la DB ?

Le fichier transmis contient 206 lignes de `reference_enrichment_review`. Il expose les demandes à examiner, avec `source_label`, `ingredient_name`, `unite`, `source_note`. Il ne contient ni `kind`, ni `status`, ni `value`, ni `measurement_note` : on ne peut donc pas en déduire quels dossiers sont vérifiés ou quelles masses sont réellement renseignées.

169 lignes ont une unité vide. Beaucoup concernent des noms à associer, pas des conversions de poids. Une ligne « Oignon » laissée en attente dans cette table n’implique pas que l’oignon soit encore inconnu dans le référentiel actif : cette file a été initialisée à partir d’un ancien instantané et n’est pas automatiquement nettoyée par les corrections faites ailleurs.

Le premier SQL de 1.2.8 active les alias non conflictuels dont la cible existe, ajoute des unités de comptage et dérive des équivalences en mL uniquement à partir de mesures existantes cohérentes. Les demandes sans information suffisante restent en attente. Il ne fabrique ni un poids par fruit, ni un nombre de gousses par tête, ni un contenu standard par paquet.

Lancer `sql/mealio_v1.2.9_reference_status.sql` si l’on souhaite consulter les statuts, les équivalences actuellement actives et les trois cas signalés. C’est un diagnostic en lecture seule dans Supabase Mealio, après le premier SQL 1.2.8.

## Quand lancer le second SQL 1.2.8 ?

Deux parcours sont possibles. Ils alimentent les mêmes tables actives.

### Parcours simple : depuis Mealio

Dans **Admin → Ingrédients**, ouvrir l’ingrédient officiel :

1. **Synonymes** : ajouter le libellé exact à reconnaître, après avoir vérifié qu’il désigne bien cet ingrédient.
2. **Densités culinaires** : saisir l’unité canonique et les grammes pour 1 unité, avec une mesure adaptée au produit. Par exemple, pour convertir des grammes d’oignon en pièces, l’équivalence est celle de « Oignon / Pièce ». Ne pas changer son unité de référence seulement pour supprimer une alerte.
3. Régénérer les courses.

Ces ajouts sont actifs directement. **Le second SQL n’est pas nécessaire pour les modifications faites dans Admin.** Le mode épicerie « présence » se règle séparément dans Admin → Épicerie pour chaque foyer.

### Parcours par lots : depuis Supabase

Dans le Table Editor de `reference_enrichment_review`, sélectionner les dossiers réellement vérifiés :

| Type (`kind`) | Champs à compléter avant activation |
| --- | --- |
| `alias` | `source_label` = libellé à reconnaître ; `ingredient_name` = nom exact d’un ingrédient officiel existant ; `status` = `verified` |
| `unit_mass` | `ingredient_name` exact ; `unite` existante ; `value` = grammes pour **1 unité** ; `measurement_note` = origine de la mesure et limites ; `status` = `verified` |

Lancer ensuite **`mealio_v1.2.8_apply_verified_measures.sql`** dans Supabase Mealio, puis régénérer les courses. On peut vérifier 2 ou 3 lignes, appliquer ce petit lot, puis recommencer plus tard. Le script est réexécutable ; les lignes `pending` restent sans effet. Les dossiers `unit_definition`, `compound` et `recipe_quantity` ne sont pas activés par ce script.

Ne pas passer toutes les lignes en `verified`. Le script refuse les cibles inconnues, mesures incomplètes et contradictions ; il n’écrase pas les équivalences existantes. Il laisse les statuts `verified` tels quels après application : ce statut ne constitue pas un journal distinct « appliqué ».

Les synonymes et densités de référence sont partagés entre foyers. Une masse valable seulement pour un paquet ou un format particulier ne doit pas devenir une règle universelle. Pour un produit variable, préciser la recette en grammes est souvent préférable.

## Les trois alertes actuelles

| Alerte | Ce qu’elle signifie | Action adaptée |
| --- | --- | --- |
| Ail : besoin en Gousse, stock en Pièce | L’ingrédient est reconnu ; « Pièce » ne dit pas si le stock compte des têtes ou des gousses. | Si les unités enregistrées sont réellement des gousses, corriger l’unité du stock dans Frosti/Cellio. Si ce sont des têtes, compter les gousses disponibles et ajuster la quantité et l’unité. Ne pas inventer une conversion universelle. |
| Oignon : besoin en Pièce, stock de 100 g | L’association « Oignons frais » est maintenant reconnue ; la masse par pièce manque. | Renseigner une masse moyenne explicite et acceptée pour Oignon/Pièce dans les Densités culinaires, ou exprimer le besoin de cette recette en grammes. Le nombre obtenu à partir d’un poids moyen reste une estimation. |
| Saucisses bretonnes (ou saucisses fraîches) → Saucisse fraîche, à valider | Le moteur propose une identité, mais ne peut pas choisir à ta place l’alternative de la recette. | Préciser d’abord le produit retenu dans Cookiwiki. Si c’est Saucisse fraîche, ce nom exact est reconnu. Pour un autre libellé de même sens, ajouter un synonyme sous Saucisse fraîche. Il faut ensuite connaître le poids des pièces pour comparer au stock de 870 g. |

Un paquet de 870 g ne donne pas à lui seul le poids d’une saucisse : il faut connaître le nombre de pièces. Vérifier également que le stock générique « Saucisses » désigne le même produit ; ne pas le faire correspondre indistinctement à toutes les variétés.

## « À valider » et apprentissage

« À valider » signifie : la proposition ne dispose pas encore d’une association assez fiable pour déduire automatiquement le stock. L’article reste dans les courses pour éviter un oubli.

Une association enregistrée dans **Synonymes** est durable et réutilisée pour ce libellé et sa normalisation, y compris après un nouvel achat. Elle porte sur l’identité, pas sur les unités : une association correcte peut donc révéler ensuite une conversion manquante. Les décisions restent modifiables dans Admin.

Le moteur possède également une mémoire des propositions IA et des rapprochements de stock. Une proposition mémorisée mais non validée reste une proposition. La mémoire de validation du stock est liée à l’ID d’une ligne de stock : ce n’est pas un remplacement d’un synonyme durable pour de futurs lots.

**Limite actuelle :** le laboratoire Matcher affiche les diagnostics mais ne propose pas encore un parcours complet de validation/correction depuis chaque alerte des Courses. Le correctif rend les messages d’aide plus précis vers Admin ; il n’ajoute pas ce parcours complet.

## Point de situation du matcher

Déjà couvert : normalisation des noms et unités, résolution par référentiel/synonymes, propositions et mémoire IA, agrégation des repas/portions, rapprochement de plusieurs lots, conversions explicites, préservation des besoins non convertibles, gestion de présence par foyer, diagnostics. Les tests protègent notamment farine de riz ≠ farine de blé et les distinctions frais/sec.

La campagne hors ligne sur les 56 recettes montre 170 lignes résolues avant enrichissement et 232 après sur l’ancien instantané fourni. C’est une progression, pas une couverture complète ni une mesure de la DB actuelle.

Les priorités restantes :

1. **Compléter les données réellement utiles** : associations sans ambiguïté, unités de stock correctes, équivalences mesurées, choix « ou », préparations composites et recettes sans ingrédients structurés. Les produits gérés en présence ne nécessitent pas de précision de consommation.
2. **Rendre la validation accessible depuis Courses** : choisir l’ingrédient, confirmer/refuser la proposition, distinguer correction de nom et correction d’unité, indiquer ce qui sera mémorisé et son périmètre.
3. **Fiabiliser le retour des écritures de mémoire** : certaines fonctions actuelles journalisent une erreur DB sans la remonter au demandeur ; un succès affiché doit garantir la persistance. Cette amélioration reste à implémenter.
4. **Tester en intégration réelle** : migration PostgreSQL, référentiel actuel, lots Frosti/Cellio, session du foyer, retours Claude, génération puis mise à jour, achats/rangement/consommation et concurrence. Vérifier également `npm run build` dans l’environnement du projet.

La robustesse attendue n’est pas de reconnaître automatiquement toute formulation : c’est aussi de conserver les besoins et d’expliquer les incertitudes sans déduire un stock incompatible.

## Validation de ce correctif

367 tests automatiques passent, dont 4 tests de lieux (collision d’ID entre applications, sélection mixte, stocks sans lieu, renommage et lieux vides), plus 14 scénarios historiques du matcher. Les tests sont hors ligne, avec doubles locaux de DB/HTTP ; ils ne prouvent pas l’exécution des migrations sur la DB distante ni le comportement du service Claude réel.
