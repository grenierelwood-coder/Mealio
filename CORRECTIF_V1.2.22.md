# Mealio 1.2.22

## Installer

1. Copier les fichiers de cette archive par-dessus Mealio 1.2.21 en conservant les répertoires. Seuls les fichiers modifiés ou nouveaux sont inclus.
2. Dans Supabase **Mealio**, exécuter `sql/mealio_v1.2.22_presence_inventory.sql`. Il vient après les migrations précédentes, dont 1.2.21. Aucune requête à lancer dans Cookiwiki, Frosti ou Cellio.
3. Redémarrer le serveur ou redéployer, puis refaire « Tester toutes les recettes » avec KH. Un ancien rapport ne se met pas à jour tout seul.

Aucun SQL n’a été exécuté sur tes DB depuis cet environnement.

## Présence : ce qui est corrigé

Le rapport 1.2.21 fourni contient 56 recettes : 46 OK, 10 à vérifier, 16 estimations, **0 appel Claude**. Il ne contient pas d’alerte de correspondance ou conversion.

Tu as raison : persil et ciboulette ne devraient pas générer ces estimations s’ils sont effectivement en présence pour KH. Le rapport montre qu’ils ont été traités en quantitatif. Sans lecture de tes DB, il ne permet pas de distinguer une ligne officielle non configurée, une mauvaise identité ou une dérogation du foyer. Le correctif rend le réglage observable et initialise les identités officielles exactes.

Le SQL active **pour KH seulement** : Persil, Persil plat, Ciboulette, Confiture d’abricot, Vin blanc (cuisine), lorsqu’ils existent dans le référentiel. Les formats d’achat existants sont conservés. Pour les nouveaux réglages sans modèle initial, formats proposés : 1 Bouquet, 350 g de confiture, 750 ml de vin de cuisine. Aucun autre foyer n’est modifié. Ces choix sont réversibles dans Admin → Épicerie. Relancer ce SQL réapplique ces choix de présence à KH.

La requête finale du SQL affiche le mode réellement retenu pour ces produits, avec la dérogation KH et le modèle initial : la ligne privée du foyer prévaut. Si un nom officiel manque, il faut vérifier cette identité dans le référentiel ; le SQL n’invente pas un nouvel ingrédient.

Les nouveaux rapports contiennent les `effectiveModes` utilisés pour chaque recette et une section repliée « Modes de suivi utilisés pour ce foyer », avec un lien direct vers son réglage. Un produit réellement en présence ne génère ni estimation de dose ni conversion quantitative.

### Unités

- Matcher : un besoin de présence porte l’unité sémantique « Présence », sans afficher un faux besoin 1 g.
- Correction des recettes : pas de champs dose/unité ni demande de confirmation d’estimation pour les ingrédients connus en présence dans ce foyer. Les doses de la recette commune restent conservées pour les autres foyers quantitatifs.
- Stock et Anti-gaspi : « Présent » ou « Absent » remplace les quantités et unités des produits en présence.
- Inventaire : case « Il en reste », sans unité à saisir. Décocher met la ligne de stock à zéro. Cocher conserve sa quantité existante positive ; pour une ancienne ligne à zéro, un marqueur positif 1 est utilisé. L’unité brute de Frosti/Cellio reste conservée, sans conversion artificielle.
- Épicerie : le format d’achat reste dans un panneau replié. Il sert seulement à proposer l’achat lorsque le produit est absent. Sortir du mode présence oblige à choisir explicitement l’unité du format acheté avant d’enregistrer. L’unité de référence commune et les conversions du matcher restent inchangées. Vérifier les quantités et unités **réelles** des stocks dans Inventaire après le changement de mode : un marqueur de présence ne constitue pas une mesure physique.

Une association inconnue peut toujours être signalée : même en présence, il faut identifier correctement le produit, sans confondre deux aliments.

## Pourquoi les crevettes et le bacon ?

L’export initial de **Crevettes au bacon** avait `ingredients: []`. Ses instructions citaient crevettes, bacon, etc., mais **aucun grammage exploitable**. Les 400 g et 200 g ont été proposés par Mealio pour les 4 portions ; ils n’ont pas été lus comme doses certaines dans la recette d’origine.

L’alerte est donc une vérification de la reconstruction initiale. Elle ne demande ni de confirmer ton stock ni de résoudre une ambiguïté entre unités. Si tu acceptes ces doses : cliquer « La quantité est correcte · confirmer l’estimation », puis enregistrer. Sinon, modifier les doses avant de confirmer. Même principe pour **Popcorn de poulet au sesame**, dont la liste initiale était incomplète. Les écrans expliquent maintenant cette origine.

Les autres estimations proviennent notamment de mentions non chiffrées comme beurre pour la cuisson ou fromage pour parsemer, et de répartitions initiales de mélanges. Une dose explicitement indiquée et exploitable n’est pas soumise systématiquement à cette confirmation.

### Les 16 estimations du rapport joint

| Recette | Estimations signalées | Après le SQL pour KH |
|---|---|---|
| Barbotton | Beurre 15 g | À confirmer, quantitatif conservé |
| Crevettes au bacon, 4 portions | Crevette 400 g, Bacon 200 g | À confirmer |
| Gratin de courgettes | Beurre 10 g | À confirmer |
| Le michon breton | Confiture d’abricot 30 g | Présence, estimation ignorée |
| Œufs en meurette | Persil plat 6,25 g | Présence, estimation ignorée |
| Popcorn de poulet au sesame | Blanc de poulet 600 g, Fromage frais 100 g, Yaourt nature 100 g, Ciboulette 5 g | Les 3 premières restent à confirmer ; ciboulette en présence |
| Rillettes de saumon | Vin blanc de cuisine 30 ml | Présence, estimation ignorée |
| Salade estivale de Coco de Paimpol | Ciboulette 25 g, Persil plat 25 g | Présence, estimations ignorées |
| Tarte fine aux courgettes et Boursin | Gruyère 45 g | À confirmer |
| Tarte Rustique à la crème de noix et prunes | Quetsche 250 g, Reine-Claude 250 g | À confirmer |

Si ces identités correspondent à ta DB, six alertes disparaîtront, laissant dix doses quantitatives à confirmer. Le beurre reste quantitatif car passer l’ingrédient en présence concerne aussi les recettes de pâtisserie. Tu peux choisir la présence pour le beurre si c’est bien ton fonctionnement pour toutes ses utilisations.

## Anti-gaspi : validité du contrôle

Défaut trouvé : le calcul ajoutait `T12:00:00Z` à la valeur de péremption. Cela fonctionnait pour une date `2026-10-08`, mais produisait une date invalide si la DB envoyait déjà un timestamp tel que `2026-10-08T12:00:00Z`. Ce produit disparaissait alors silencieusement du contrôle.

Le calcul accepte désormais dates et timestamps, compare les jours dans Europe/Paris, conserve J+3 inclus et les dates déjà dépassées. Dates inexistantes ou invalides sont comptées séparément. Les boissons alcoolisées et les lignes de stock à zéro restent exclues.

Les lectures Frosti/Cellio parcourent aussi toutes les pages de stock : le plafond par défaut Supabase ne doit pas masquer les péremptions des lignes suivantes. Les erreurs de lecture restent des erreurs explicites, jamais un stock vide.

L’écran affiche la date du contrôle, le nombre de produits alimentaires disponibles, ceux avec date exploitable, ceux sans date, les dates invalides et les dates dépassées. « Aucun produit » signifie uniquement aucun produit **daté et exploitable** à signaler. Cela ne garantit rien pour les produits sans date.

Le code a été testé localement. Sans accès à tes DB, je ne peux pas affirmer que toutes tes dates réelles sont renseignées. Le nouveau bilan permettra de le vérifier. Les dates se corrigent dans Frosti/Cellio ; les liens d’Inventaire permettent d’y retourner.

## Rappels d’inventaire par lieu

Nouveau paramétrage dans Inventaire après sélection d’un lieu physique précis : délai de 1 à 104 semaines, champ vide pour désactiver. Les rappels sont désactivés tant qu’un délai n’a pas été enregistré pour le lieu. Pour un lieu jamais inventorié, le délai commence à son activation ; sinon il part du dernier inventaire complet.

« J’ai vérifié tout ce lieu » enregistre un inventaire complet même s’il n’y avait aucune correction. Le bouton exige une recherche vide et aucune correction en attente. Enregistrer des changements de produits ne remet pas ce compteur à zéro : cela peut être un contrôle partiel.

Quand le délai est atteint, un bandeau non bloquant dans Mealio donne un lien direct vers chaque lieu concerné. Les rappels sont vérifiés à la connexion et lors des changements de page. Pas d’e-mail, pas de notification externe, pas de tâche Claude. Continuer à utiliser Mealio reste possible.

Le paramétrage appartient au foyer, à la source et à l’UUID du lieu : un lieu Frosti ne peut pas être confondu avec Cellio. Les routes vérifient l’appartenance du lieu au foyer connecté avant l’écriture. La fonction SQL met à jour atomiquement délai ou dernière confirmation en conservant l’autre valeur.

## Vérifications

- **600 tests automatisés locaux + 14 scénarios du laboratoire** réussis.
- Tests du pipeline réel DB → présence → matcher → stock → filtrage des estimations, avec unités de recette inconnues.
- Tests de dates/timestamps, Paris, dates invalides, J+3/J+4, dates dépassées, exclusions et lecture de seconde page.
- Tests de rappels : échéance, désactivation, authentification, lieux privés, délais, table manquante et écriture serveur.
- Contrôles de rendu des écrans, choix d’unité en sortie de présence, confirmation complète distincte et liens contextualisés.
- Contrôles TypeScript ciblés UI et serveur : aucune erreur.

Doubles locaux de session, DB, HTTP et Claude ; aucune campagne distante ni build Next complet exécuté ici.
