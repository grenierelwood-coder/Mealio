# Mealio 1.2.18 — parcours guidés et reprise des tests

Copier les fichiers de cette archive dans leurs répertoires, puis redémarrer `npm run dev`. Pas de SQL à exécuter pour cette version.

## Où est « Enregistrer et recalculer les courses » ?

Ce bouton appartient à la fenêtre de correction d’un produit, ouverte depuis « À vérifier » ou « Corriger ». Il enregistre une association ou un poids moyen puis régénère la liste. La capture 1.2.17 montre le haut de Courses sans alerte visible ; ce bouton n’est pas un bouton permanent de cette page.

Courses explique désormais ce parcours et affiche l’absence de correction signalée lorsqu’aucune anomalie n’est ouverte. Les corrections de recette ou de stock ouvrent leur écran dédié : enregistrer, revenir aux Courses, puis « Mettre à jour mes courses ». Le bouton de la fenêtre ne remplace pas la sauvegarde de ces écrans.

## Reprendre le rapport joint

Ton rapport du 8 octobre contient 35 résultats sur 56 recettes : 13 OK, 22 à vérifier, aucun résultat Erreur, 20 appels Claude. Les 35 mentionnent un deuxième passage stable. « Stable » signifie reproductible sur ces deux passages, pas nécessairement correct. Les estimations contribuent au statut « À vérifier ».

1. Ouvrir Admin → Outils avancés → Intégration, connecté avec KH.
2. Importer `mealio-integration.json` dans « Reprendre un rapport JSON ».
3. Cliquer « Continuer les recettes restantes ». Les 21 restantes seront ciblées si la bibliothèque est toujours la même. Les recettes en erreur ou sans deuxième passage stable sont également reprises.
4. Si le budget de 20 appels est atteint, continuer une nouvelle exécution ; son budget repart de zéro. On peut aussi augmenter explicitement ce budget. Une recette peut dépasser la limite, contrôlée entre les requêtes.
5. Télécharger le rapport consolidé. Après chaque correction, retester la recette concernée. Enfin, refaire « Tester toutes les recettes » pour vérifier les 56 sur le même état de données.

Pendant l’exécution : recette courante, premier/deuxième passage, progression. Arrêter attend la réponse en cours. Le rapport contient désormais les ingrédients, motifs, estimations et liens de correction, ainsi que les recettes encore à rejouer. Un ancien rapport ne permet pas de reconstituer ses diagnostics détaillés : retester ses recettes « À vérifier » pour les obtenir. Un rapport d’un autre foyer est refusé.

## Simplification et navigation

- Admin : les quatre réglages visibles sont Articles à ranger, Réapprovisionnements, Règles de rangement, Épicerie. Référentiel, correction des recettes, intégration, Matcher et tables sont dans une section repliée. Tous restent accessibles ; aucun nouveau rôle requis.
- Courses : un point d’entrée de correction par produit ; association et poids moyen traités sur place ; autres problèmes orientés vers leur écran avec instruction de retour.
- Recettes : accès aux tests de la recette sélectionnée et retour aux Courses.
- Référentiel : retour aux Courses et aux articles à ranger.
- Tests : diagnostic par ingrédient avec action appropriée ; estimations séparées des problèmes d’association/conversion dans le rapport.
- Rangement : trois étapes visibles — corriger, relancer, vérifier. Les liens de chaque article ouvrent la règle préremplie pour cet ingrédient, son stockage par défaut ou ses unités. Le résultat réussi mène à l’inventaire recherché sur ce produit, dans tous les lieux.

Le rangement continue à employer le moteur existant et ses protections de transfert : on n’ajoute pas un second formulaire qui écrirait directement dans les stocks. Les destinations résultent des règles du foyer (ingrédient → catégorie → défaut). Sur le lien prérempli, vérifier d’abord les règles existantes avant de créer une exception. Une unité incorrecte se corrige à sa source ; un synonyme ne constitue pas une conversion.

Pour un achat non associé, le lien renvoie à l’association de l’article dans Courses. Le mécanisme existant exige une liste active : un article d’une ancienne liste sans ingrédient officiel nécessitera une évolution dédiée de cette association. Cette version ne prétend pas résoudre ce cas automatiquement. Les adresses Frosti/Cellio ouvrent les applications ; les chemins de fiches spécifiques n’ont pas été confirmés.

## Campagne complète sur les bases réelles

L’analyse des 56 recettes couvre le calcul des besoins et la stabilité du Matcher sur le stock actuel. Elle n’exerce pas toutes les variations de stock et n’exécute pas un achat. Elle peut enregistrer les propositions/mémoires du Matcher, mais ne modifie pas les courses ni le stock.

### Étapes et critères

| Étape | Cas à couvrir | Résultat attendu |
|---|---|---|
| Bibliothèque réelle | 56 recettes, deux passages ; corrections puis nouveau passage complet | Quantités finies et positives ou présence explicite ; ambiguïtés expliquées ; rapport complet |
| Variations du Matcher | Stock absent, partiel, suffisant, réparti entre lieux et sources ; portions 1/4/8 | Agrégation juste ; aucun stock compté deux fois ; calcul proportionnel |
| Identité | Farine riz/blé, ail frais/poudre, frais/surgelé, synonymes enregistrés, mélanges/alternatives | Aucun rapprochement incompatible ; correction mémorisée lorsque valide |
| Mesures | Gousse/gramme, pièce/gramme, masse/volume, unité inconnue, ail en Pièce | Équivalences explicites réutilisées ; aucune conversion inventée ; cas ambigus conservés |
| Épicerie | Présent, presque terminé, absent ; formats multipliés ; suivi différent entre foyers | Présence sans consommation quantitative ; achats au format du foyer ; proposition de réappro cohérente |
| Courses et achats | Ajout manuel, modification, achat partiel, achat supplémentaire, régénération | Achats et ajouts conservés ; quantité réellement achetée prise en compte |
| Rangement | Règle générale/catégorie/exception, aucun lieu, lieu invalide, panne puis relance | Destination correcte ; attente explicite ; transfert sans doublon après reprise |
| Consommation | Repas consommé, annulation, répétition de l’action ; stocks multi-lieux | Déduction unique, cohérente avec les unités ; présence non déduite quantitativement |
| Historique/réappro | Plusieurs achats à des dates distinctes, période irrégulière, nouvel ingrédient | Prévision seulement si historique suffisant ; état presque terminé utilisable sans historique |
| Isolation et concurrence | Deux foyers ; double clic ; deux sessions ; interruption réseau | Pas de fuite entre foyers, pas de perte silencieuse, pas de double achat/transfert/consommation |
| Ergonomie | Mobile et bureau ; chaque alerte, correction, retour et recalcul | Action compréhensible, progression visible, message de succès/échec utile |

Les cas de stock artificiel, dates historiques et pannes se testent dans des clones de bases ou un environnement isolé, pas en modifiant le stock courant de KH. Le cycle technique existant est un scénario sur une recette, pas une campagne exhaustive à lui seul. Il conserve les données créées ; prévoir une remise à zéro maîtrisée entre scénarios. Un seul achat n’est pas suffisant pour valider une prévision historique de réapprovisionnement.

### Ce qu’il me faut pour les exécuter

- Sans accès supplémentaire : tu lances les analyses avec KH et me transmets les nouveaux rapports JSON détaillés. Je peux diagnostiquer leurs résultats, sans prétendre avoir exécuté les tests distants.
- Pour une exécution de ma part : une instance Mealio joignable depuis l’environnement de travail, avec session autorisée et configuration serveur pour ses quatre bases et Claude. Ton `localhost` n’est pas automatiquement joignable ici. Les accès éventuels se configurent de manière sécurisée dans l’environnement, jamais en collant les secrets dans la conversation.
- Pour les scénarios qui écrivent : clones des bases préférables, ou foyer dédié relié par le même nom dans les applications, avec lieux et règles. Les UUID de foyers peuvent différer entre bases. Les référentiels/recettes étant communs, un simple foyer de test ne suffit pas à isoler des modifications de ces données communes.
- Un budget Claude choisi, les plages d’exécution, et les données attendues pour les scénarios. La reprise par lots évite de refaire inutilement les passages stables.

## Validation de cette livraison

Batterie locale Matcher : 580 tests plus 14 tests historiques, sans échec. Vérifications UI : chargement/édition admin, sélection et campagne de recettes, import du mauvais foyer refusé, reprise des résultats stables, attente de requête visible, liens de conversion/rangement, correction et recalcul sans double enregistrement. Typage ciblé des écrans modifiés : aucune erreur.

Ces vérifications utilisent le code de production avec des doublures HTTP/DB/Claude. Aucun test distant Supabase ou appel réel à Claude n’a été exécuté ici ; aucune base distante n’a été modifiée. Un build Next complet et les scénarios réels ci-dessus restent à exécuter dans ton environnement.
