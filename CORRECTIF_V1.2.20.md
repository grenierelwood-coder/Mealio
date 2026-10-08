# Mealio 1.2.20 — conversions, préparations maison et rapport pertinent

## Installation et nouveau test

1. Exécuter `sql/mealio_v1.2.20_corrections.sql` dans le SQL Editor de SUPABASE MEALIO, après les migrations déjà installées jusqu’à 1.2.12. Aucun SQL dans Frosti, Cellio ou Cookiwiki. Le script se termine par une lecture des poids enregistrés.
2. Copier les fichiers modifiés en respectant les répertoires ; redémarrer `npm run dev`. Vérifier la version 1.2.20 dans le bandeau.
3. Admin → Épicerie : vérifier « Préparer Mayonnaise maison » pour KH. Le SQL initialise ce choix seulement pour KH. Les autres foyers conservent leur comportement.
4. Intégration → Tester toutes les recettes pour obtenir un rapport neuf, plutôt que relire les alertes de l’ancien JSON. Le plafond d’appels existant reste réglable ; la reprise conserve les résultats si une exécution s’arrête.
5. Télécharger ce rapport puis rejouer la campagne à données identiques pour vérifier les appels réellement évités. Les propositions déjà validées dans le référentiel prennent priorité sur la mémoire des analyses.

## Poulet entier et correspondances

La capture montre Poulet entier → Poulet entier : le nom est déjà reconnu, pas de synonyme utile à ajouter. L’écran l’explique maintenant et n’affiche plus le bouton d’association dans ce cas. Le Matcher interdit le rapprochement automatique entre poulet entier et cuisses/blancs/ailes/filets, indépendamment d’un score lexical favorable.

Une réponse Claude valide « aucun produit compatible » signifie acheter ce besoin, pas créer une association avec lui-même. Elle n’engendre donc plus une alerte générique « Association à vérifier ». Une indisponibilité de Claude reste signalée et peut être retentée.

« Chercher un autre ingrédient » est facultatif et replié. Ce champ filtre la liste si la proposition ne convient pas ou si aucune proposition n’est disponible. Il ne faut rien y saisir si l’ingrédient sélectionné est correct. Les quatre premières correspondances ont été confirmées par l’utilisateur ; leurs validations enregistrées dans Admin restent réutilisées. Cette livraison ne recrée pas ces associations.

## Mayonnaise maison : choix du foyer

Le SQL configure pour KH une composition par recette de base :
- 1 Œuf (poule), en Pièce ;
- Huile d’olive, Sel fin, Poivre noir en présence, sans dose quantitative.

La quantité de mayonnaise de la recette est remplacée par cette composition ; elle n’est pas convertie gramme par gramme en œufs. Les portions du planning appliquent leur facteur à l’œuf. C’est la convention demandée pour une préparation maison, pas une formule de rendement : si une recette exige une quantité exceptionnelle de mayonnaise, adapter cette composition. Le choix d’huile initial est Huile d’olive, correspondant au stock communiqué ; la composition est enregistrée en DB et peut être ajustée.

Avec huile, sel et poivre disponibles, seul l’œuf peut rester à acheter. S’ils sont absents, leur besoin de présence et leur format de réapprovisionnement restent légitimement proposés. Activer ce choix ignore le stock de mayonnaise toute prête ; désactiver « Préparer Mayonnaise maison » dans Épicerie revient au produit Mayonnaise normal. Le choix est propre au foyer. Les recettes Cookiwiki communes ne sont pas réécrites.

## Poids moyens initialisés

| Ingrédient | Format | Poids net retenu |
|---|---|---:|
| Figue | Pot 250mL | 130 g |
| Figue | Sachet | 130 g |
| Pomme | Pot 250mL | 150 g |
| Pomme | Pot de 350mL / Pot 350mL | 210 g |
| Pomme | Pot 750mL | 450 g |
| Pomme | Pot 1L | 600 g |
| Pomme | Pot 1,5L | 900 g |
| Poire | Pot 250mL | 145 g |
| Pêche | Pot 250mL | 145 g |

Ce sont des moyennes de gestion choisies avec l’utilisateur, modifiables dans Admin → Référentiel ingrédients → ouvrir le produit → Poids moyens et conversions. Le poids net est hors liquide. Pour Sachet, le script suppose explicitement un remplissage équivalent à 250 ml de figues. Adapter cette masse si les sachets réels sont d’un autre format. Les moyennes des pots de pommes concernent les morceaux/quartiers ; elles ne conviennent pas à de la compote. Ces hypothèses ne changent pas l’identité ou la forme des produits.

Le script remplace les poids existants de ces formats précis par les valeurs du tableau et note leur origine. Relancer le script réapplique ces moyennes : après personnalisation dans Admin, éviter de le relancer pour ne pas remplacer ces changements. La création des tables et de la préparation est réexécutable ; une préparation maison désactivée n’est pas réactivée par l’insertion initiale. Les modes présence Huile d’olive/Sel fin/Poivre noir de KH sont explicitement activés par le SQL.

## Pourquoi les estimations d’épicerie apparaissaient

Le laboratoire comptait les marqueurs `quantityEstimated` des recettes sans tenir compte du mode réel du foyer. Le calcul des courses savait déjà distinguer présence et quantité. Le rapport était donc trop bruyant.

Le backend renvoie désormais seulement les estimations rattachées à des besoins effectivement quantitatifs. Le nom d’origine est conservé pour relier une ligne de recette à sa résolution officielle. Les produits suivis en présence, les lignes exclues et les ingrédients remplacés par une composition maison ne génèrent plus une alerte d’estimation inutile. Une association manquante reste à corriger ; un produit suivi finement par un autre foyer conserve ses alertes quantitatives.

Ce filtrage ne supprime pas les marqueurs dans les recettes partagées. Pour KH, huile/sel/poivre en présence ne seront plus comptés parmi les estimations. Pour une farine suivie en quantité par un autre foyer, une estimation demeure pertinente. Le mode dépend du réglage du foyer, pas seulement de l’appartenance à une catégorie Épicerie.

## Mémoire des analyses de stock

Une nouvelle table conserve les réponses exploitables du rapprochement ambigu : proposition de produit ou absence de candidat adapté, quelle que soit la confiance. Le cas est identifié par l’ingrédient officiel, l’état du référentiel et les libellés/sources des candidats pertinents ; les identifiants de lots et leurs quantités ne sont pas la clé.

Le même cas peut donc être repris après rechargement ou avec un nouveau lot équivalent, sans appeler Claude. Une proposition mémorisée est toujours à valider : aucun stock n’est déduit sur sa seule base. Un nouveau candidat ou une modification du référentiel change le contexte et peut justifier une nouvelle analyse. Les pannes, réponses invalides et candidats inexistants ne sont pas des connaissances et ne sont pas mémorisés comme décisions.

La nouvelle mémoire concerne l’analyse du stock. La résolution d’ingrédient conserve son mécanisme existant ; notamment une réponse négative non validée y possède un cache de 24 h. Cette version ne promet pas zéro appel pour toute entrée future, indépendamment des changements de contexte.

## Validation

588 tests locaux réussis et 14 tests historiques réussis. Tests ajoutés : composition maison et modes présence ; effet des portions ; absence de remplacement pour un autre foyer ou un choix désactivé ; séparation poulet entier/cuisses ; conversion de pot spécifique à un ingrédient ; mémoire de proposition et de réponse AUCUN ; reprise avec un lot neuf ; absence de mémorisation d’une panne ; authentification et filtrage par foyer des préparations.

Vérifications UI : exclusion des estimations en présence, association à soi-même déjà reconnue, recherche facultative, désactivation de la préparation, conservation du rapport et correction ciblée existantes. Typage ciblé serveur et UI : aucune erreur.

Aucune base distante n’a été modifiée et aucun appel Claude réel n’a été exécuté ici. Le SQL est fourni à exécuter ; il n’a pas été validé sur une instance PostgreSQL réelle dans cet environnement. Le nouveau rapport sur KH reste nécessaire pour confirmer le résultat sur tes DB.
