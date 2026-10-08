# Mealio 1.2.21

## Installation

1. Copier les fichiers de cette archive à la racine Mealio, en conservant les répertoires. Elle ne contient que les fichiers modifiés ou nouveaux depuis 1.2.20.
2. Dans le SQL Editor de Supabase **Mealio**, exécuter `sql/mealio_v1.2.21_recipe_watch.sql`, après le SQL 1.2.20. Ne pas le lancer dans Cookiwiki, Frosti ou Cellio.
3. Relancer `npm run dev` ou redéployer. Se connecter avec KH.

Aucune modification distante n’a été effectuée ici.

## Mayonnaise : présence et format d’achat

Le « 1 Gramme » était la valeur initiale du formulaire d’ajout, pas une consommation calculée. Présence signifie seulement vérifier s’il reste le produit ; le format d’achat sert à proposer une quantité lorsqu’il est absent.

Le formulaire propose désormais 250 g pour Mayonnaise, modifiable. Le SQL remplace uniquement l’ancien format 1 g de KH par 250 g ; il conserve les formats personnalisés. Les autres nouveaux produits proposent 250 g, 1 L ou 1 unité selon leur unité de référence : ce sont des valeurs de départ à ajuster.

Le libellé devient « Quantité à acheter si absent ». Si « Préparer Mayonnaise maison » est activé, les courses utilisent la composition configurée plutôt que le produit mayonnaise prêt à consommer. Ce correctif ne modifie pas cette composition.

## Nouvelles recettes : KH exclusivement

À chaque connexion, et lors des changements de page, le bandeau cherche les recettes Cookiwiki dont l’identifiant n’a pas encore été analysé par KH. Il affiche le nombre, quelques titres et un lien vers Intégration. Un bouton « Tester les nouvelles recettes » analyse seulement celles-ci.

Le SQL initialise le registre avec les 56 recettes de ton rapport du 8 octobre. Elles ne seront donc pas annoncées comme nouvelles, même si elles ont encore des estimations à vérifier. Chaque analyse réussie enregistre ensuite son identifiant côté serveur, même si le résultat contient des points à vérifier. Une analyse échouée avant le calcul des besoins ne le fait pas. Ce registre indique « analysé », pas « validé sans problème ».

L’alerte ne lance aucun appel Claude. Les autres foyers ne voient pas ce bandeau et ne font aucune requête de surveillance. Une modification d’une recette déjà connue n’est pas détectée comme une nouvelle recette. Le registre est protégé par RLS, accessible via les routes serveur authentifiées.

Si le SQL n’est pas installé, un message explicite signale le suivi indisponible ; il n’annonce pas faussement zéro nouvelle recette. Les tests restent utilisables.

## Crevette et bacon : ce que tu dois confirmer

La recette **Crevettes au bacon** a 4 portions de base. Son export Cookiwiki initial contenait des instructions mais une liste d’ingrédients vide. La proposition de correction a donc estimé **400 g de crevettes** et **200 g de bacon**.

L’app te demande de vérifier ces doses de recette, et non ton stock, une association ou une conversion. L’écran affiche désormais la question avec le nombre de portions, la quantité et l’ingrédient. Si les doses conviennent, cliquer « La quantité est correcte · confirmer l’estimation », puis enregistrer. Sinon, modifier la dose ou l’unité, confirmer et enregistrer. Le planning ajuste ensuite selon ses portions. Les doses estimées servent déjà au calcul des courses ; la confirmation retire leur avertissement.

Les nouveaux rapports affichent eux aussi la question chiffrée. Les anciens rapports importés conservent leur ancien texte jusqu’au nouveau test. Un lien mène du produit estimé au réglage présence du foyer, sans changer automatiquement la recette commune.

## Lecture du rapport joint

56 recettes analysées, 46 OK, 10 à vérifier, 1 appel Claude. Les 16 points restants concernent tous des estimations : aucune alerte d’association ou de conversion dans ce rapport.

| Produits signalés | Mode conseillé |
|---|---|
| Confiture d’abricot, vin blanc de cuisine | Présence adaptée si tu ne comptes pas les doses |
| Beurre (2 recettes) | Présence possible pour la cuisson ; quantitatif si tu souhaites suivre les doses |
| Persil plat (2 recettes), ciboulette (2 recettes) | Présence possible si « un bouquet disponible » suffit ; ce sont des herbes fraîches, donc choix du foyer |
| Crevette, bacon, blanc de poulet | Quantitatif : confirmer les portions et doses de recette |
| Fromage frais, yaourt nature, gruyère | Quantitatif conseillé |
| Quetsche, Reine-Claude | Quantitatif conseillé |

Aucun passage en présence n’est imposé par cette mise à jour. Dans Correction des recettes, le lien « Choisir le suivi en présence pour cet ingrédient » ouvre la configuration du produit ; enregistrer ensuite le choix et retester la recette. Le laboratoire exclut déjà les estimations lorsque le mode effectif du foyer est présence. Les modifications des doses de recette sont communes ; le choix présence reste propre au foyer.

## Vérifications

- 594 tests automatisés locaux réussis, plus 14 scénarios du laboratoire.
- Contrôles des écrans : notification exclusive KH, tests des nouvelles recettes seules, dose et portions explicites, retours vers les corrections, courses, inventaire et rangement.
- Contrôles TypeScript ciblés des écrans et routes serveur : aucune erreur.

Ces vérifications utilisent le code réel avec des doubles de DB, session, HTTP et Claude. Elles ne remplacent pas une campagne sur tes DB après installation. Aucun build Next complet ni SQL exécuté à distance ici.
