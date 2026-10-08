# Mealio 1.2.19 — liste de corrections et écran ciblé

Copier les fichiers dans leurs répertoires puis redémarrer `npm run dev`. Aucun SQL pour cette version. Elle simplifie le traitement du rapport ; elle ne modifie pas encore la mémorisation des propositions Claude.

## Parcours simple

1. Admin → Outils avancés → Intégration : importer le rapport `mealio-integration (2).json` une fois.
2. Ouvrir « Liste des points à traiter », puis Correspondances, Stocks et conversions ou Estimations par recette.
3. Pour une estimation, « Ouvrir uniquement cet ingrédient » affiche quantité/unité et la recette concernée. Ajuster si nécessaire, puis « La quantité est correcte · confirmer l’estimation », puis « Enregistrer cette correction ». Une quantité encore approximative doit conserver son indicateur Estimation.
4. Cliquer « Retour à la liste des corrections ». Les résultats sont retrouvés dans le même onglet, pour le même foyer, grâce à sessionStorage. La liste décrit toujours le dernier test : enregistrer une correction ne suffit pas à retirer l’ancienne alerte. Sélectionner la recette corrigée et la retester pour actualiser son résultat sans effacer les autres.
5. À la fin, lancer une nouvelle campagne complète des 56 recettes. « Tester toutes les recettes » remplace volontairement le rapport par cette nouvelle campagne.

La restauration dépend de la conservation de la session du navigateur ; après fermeture de l’onglet, changement de navigateur, ou blocage du stockage local, importer à nouveau le rapport téléchargé. Télécharger régulièrement reste le moyen durable de conserver les résultats. Aucun résultat de KH n’est restauré pour un autre nom de foyer. Les fichiers de rapport ne prouvent pas que les DB sont encore dans le même état.

## Correspondances du rapport : cinq cas, pas dix corrections

| Libellé rencontré | Ingrédient officiel proposé | Action recommandée |
|---|---|---|
| Courgettes (rondelles/dés) | Courgette | Enregistrer le synonyme si le stock contient bien des courgettes seules ; leur découpe ne change pas leur identité. Vérifier séparément la compatibilité de préparation lorsque la recette exige un état particulier. |
| Ciboulette hachée | Ciboulette | Enregistrer le synonyme si c’est de la ciboulette seule. |
| Épinards hachés | Épinard haché surgelé | Confirmer que ce stock est réellement surgelé avant de créer un synonyme partagé. Le libellé seul ne permet pas cette conclusion. |
| Poulet - Cuisse et haut de cuisse | Cuisse de poulet | Préciser si ce libellé désigne des cuisses entières ou un assortiment de morceaux. Leur poids, portions et forme ne sont pas forcément équivalents ; ne pas transformer automatiquement en synonyme général. |
| Poulet entier | Aucun candidat détaillé dans le rapport | Ouvrir la recette concernée et retester cet ingrédient dans le Matcher ; le rapport dit seulement « Association à vérifier ». Ne pas l’associer à des cuisses par défaut. |

Les deux recettes « Poulet à la Gaston Gérard facile » ont des identifiants différents : `a1cfaf0a-c0b8-40c1-a5a5-45ded138315b` et `970eed2f-8df4-4f36-85fa-9e6b65e64e8d`. La première demande une cuisse, la seconde fait apparaître Poulet entier dans le diagnostic. Les vérifier séparément.

Les cinq propositions Courgette proviennent du même libellé de stock ; une association correcte règle plusieurs recettes. Même principe pour les deux propositions Ciboulette.

## Conversions : contenu à préciser, pas poids du récipient

| Produit | Formats en stock signalés | Correction à faire |
|---|---|---|
| Figues | Sachet(s), Pot 250mL | Préciser forme et quantité nette d’un sachet ou pot. Si contenu variable, renseigner chaque lot en grammes dans Frosti/Cellio. |
| Poires | Pot 250mL | Distinguer morceaux/fruits/compote ; renseigner masse nette ou nombre réel adapté à la recette. |
| Pommes | Pot 250mL, Pot de 350mL, Pot 750mL, Pot 1L, Pot 1,5L | Même contrôle. Ne pas faire couvrir des pommes fraîches par une compote sous le simple nom Pommes. |
| Pêches | Pot 250mL | Même contrôle du contenu et de sa quantité nette. |
| Mayonnaise | Pièce | Si tu veux le suivi en présence pour KH, choisir ce mode dans Épicerie. Sinon préciser le poids d’un pot ou corriger la ligne de stock en grammes. |

Une équivalence ingrédient+format est pertinente seulement si ce format est suffisamment stable pour tous les lots auxquels elle sera appliquée. Un poids moyen peut être approximatif, mais on ne peut pas déduire ici un poids de pommes d’un volume de récipient. Le rapport ne contient ni contenu détaillé ni poids mesuré.

## Estimations : ce que le rapport demande de vérifier

Le rapport signale 66 occurrences d’estimation. Il contient les noms des ingrédients, mais pas les chiffres estimés : ceux-ci s’affichent dans la correction ciblée à partir de la recette réelle. On ne peut pas approuver honnêtement ces quantités en lisant seulement ce JSON.

Pour les assaisonnements suivis en présence, une estimation de quantité n’influence pas les courses quantitatives : ces alertes de laboratoire restent à filtrer selon le mode réel du foyer. Cette version n’enlève pas arbitrairement les marqueurs de recette. Commencer par les ingrédients principaux de Crevettes au bacon et Popcorn de poulet, puis les fruits/olives/fromages/beurre. Laisser les estimations non vérifiées marquées comme telles.

| Recette | Ingrédients signalés |
|---|---|
| Barbotton | Huile d'olive, Beurre |
| Cake d'été | Olive noire, Olive verte, Thym séché |
| Cassoulet breton de Coco de Paimpol AOP | Sel fin, Poivre noir |
| Crevettes au bacon | Crevette, Bacon, Huile d'olive, Paprika, Ail en poudre, Mayonnaise, Sauce sriracha, Miel |
| Gratin de courgettes | Thym séché, Poivre noir, Muscade, Sel fin, Beurre |
| La Tartiflette au Reblochon | Huile d'olive, Sel fin, Poivre noir |
| Le michon breton | Confiture d'abricot |
| Mijoté de cocos de Paimpol au porc et oignons de Roscoff | Poivre noir |
| Mijoté de cocos de Paimpol au porc et oignons de Roscoff | Poivre noir |
| Œufs en meurette | Persil plat, Sel fin, Poivre noir |
| Œufs en meurette faciles | Sel fin, Poivre noir |
| Pommes de terre vigneronnes | Poivre noir |
| Popcorn de poulet au sesame | Blanc de poulet, Farine de blé, Maïzena, Ail en poudre, Paprika, Poivre noir, Graine de sésame, Huile de tournesol, Fromage frais, Yaourt nature, Huile d'olive, Ciboulette |
| Pot-au-feu | Sel gros / Fleur de sel, Poivre noir |
| Recette œuf Bénédicte | Sel fin, Poivre noir |
| Rillettes de saumon frais et fumé / recette d'Oma pour nos fiançailles !! | Vin blanc (cuisine), Sel fin, Poivre noir |
| Risotto aux champignons | Sel fin, Poivre noir |
| Salade estivale de Coco de Paimpol AOP | Ciboulette, Persil plat |
| Soupe à l’oignon (la meilleure) | Sel fin, Poivre noir |
| Tarte fine aux courgettes et Boursin | Gruyère |
| Tarte fine aux raisins, figues et fromage de chèvre | Sel fin, Poivre noir |
| Tarte Rustique à la crème de noix et prunes | Quetsche, Reine-Claude |
| Tendrons de veau à la gardiane | Olive noire, Olive verte, Sel fin, Poivre noir |

## État du rapport

55 recettes analysées sur 56 ; 18 OK, 37 à vérifier ; aucune Erreur ; 20 appels Claude. Une recette reste à exécuter : Velouté de châtaigne de Cyril Lignac. Les 55 deuxièmes passages sont stables ; cela ne valide pas automatiquement les choix sémantiques ou les estimations.

## Vérifications de cette version

Tests UI locaux et typage ciblé réussis : édition de la seule estimation ciblée, confirmation, sauvegarde conservant les autres ingrédients et alternatives, lien de retour, restauration du rapport par foyer, sélection/campagne/reprise et corrections existantes. Code de production avec doublures HTTP ; aucun appel Claude ni écriture Supabase distant. Le test d’apprentissage sans appel répété nécessite encore la correction du Matcher décrite précédemment.
