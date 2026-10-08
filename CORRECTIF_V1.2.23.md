# Mealio 1.2.23 — aide courte et préparation à la production

## Installer

Copier les fichiers de cette archive par-dessus 1.2.22 en conservant les répertoires. **Aucun nouveau SQL.** Les migrations précédentes restent nécessaires. Redémarrer Mealio ou redéployer.

L’archive contient uniquement les fichiers modifiés ou nouveaux ; les fichiers de code sont complets. Le numéro de version du package et celui du verrou des dépendances sont alignés. Les dépendances ne changent pas.

## Aide contextuelle

Un bouton **« Aide · [écran] »** apparaît sous le bandeau sur les écrans fonctionnels, y compris l’accueil et la connexion. L’aide est repliée par défaut et se referme lors d’un changement d’écran.

Elle indique le parcours global, la place de l’écran, sa logique, le prochain geste et un ou deux liens directs. Elle couvre Planning, Courses, Stock, Réapprovisionnements, Anti-gaspi, Inventaire, Achats, les réglages du foyer, rangement, épicerie, référentiel, recettes, Intégration et Matcher.

Pas de réseau ni de Claude pour afficher l’aide. L’ancien lien Point frigo utilise la même aide que l’écran Inventaire. Le libellé Réapprovisionnements est aussi harmonisé sur l’accueil.

## Contrôle des vraies connexions depuis ton installation

**Admin → Outils avancés → Intégration → Avant la première mise en production → Vérifier les connexions et réglages.**

Le bouton lit les vraies DB configurées dans TON serveur :

- résolution du foyer par username, avec ses UUID Frosti et Cellio distincts ;
- lecture Cookiwiki et référentiel Mealio ;
- stock complet, réglages présence et rappels du foyer ;
- lieux et règles de rangement Frosti/Cellio, avec destinations existantes ;
- accessibilité des tables utilisées pour les listes, signaux, rappels, surveillance de recettes et historique.

Les lectures de données privées sont limitées au foyer connecté. Le diagnostic ne modifie ni stock, ni achat, ni recette, ni signal, et ne fait aucun appel Claude. Le bouton indique « Vérification en cours », affiche les points à corriger avec leurs liens et permet de télécharger `mealio-preproduction.json`.

Une lecture réussie ne prouve pas que les écritures ou les fonctions SQL sont validées. Le diagnostic garde explicitement à faire **cycle réel / séparation réelle des foyers / build et smartphone**. Aucun faux feu vert « production prête ».

## Les quatre points avant production : bilan de ce travail

| Point | Ce qui est vérifié ici | Ce qui reste à faire sur ton installation |
|---|---|---|
| Cycle complet | Vrais handlers Planning → Courses → achat → rangement Frosti/Cellio → historique → clôture → consommation → signal, avec DB en mémoire. Régénération stable, rangement répété sans doublon, consommation répétée sans double déduction, présence conservée. | Exécuter le cycle technique sur un foyer dédié connecté, avec les vraies DB et fonctions SQL. |
| Deux foyers | Lecture des vrais endpoints stock pour deux foyers simulés, réglages présence privés, association commune réutilisée et tentative de changer le foyer via le body ignorée. Tests d’auth et refus de stock extérieur existants conservés. | Essayer deux comptes réels et vérifier leurs vues et modifications indépendantes. |
| Fonctions récentes | Tests dates/timestamps et J+3, signal Presque terminé, propositions de réappro, historique, échéance d’inventaire, liens vers lieux et alerte nouvelle recette exclusive KH. Rendu des écrans vérifié. | Vérifier un exemple connu dans les vraies données et dans la version déployée. |
| Déploiement | Tests automatiques et d’écrans réussis ; typage ciblé UI/serveur réussi. Commande unique de vérification ajoutée et testée. | Typage complet, build Next et essai smartphone sur ton installation dotée des dépendances. |

**605 tests automatiques locaux + 14 scénarios du laboratoire réussis.** Les tests d’écrans passent, dont aide repliée/contextualisée sans réseau, diagnostic en cours et séparation entre lectures réussies et parcours encore à faire.

Ici, `npm run typecheck` et `npm run build` ne peuvent pas être validés : les commandes `tsc` et `next` ne sont pas installées dans le projet de cet environnement. Le typage ciblé utilise les outils disponibles et des déclarations Next de contrôle ; il ne remplace pas le build complet. Nous n’avons pas les variables de connexion ou sessions de tes vraies DB, et aucune opération distante n’a été réalisée.

## Commande unique avant déploiement

Dans ton dossier Mealio, avec ses dépendances et variables habituelles :

    npm run verify:production

Elle lance successivement `npm test`, `npm run test:ui`, `npm run typecheck`, `npm run build`. Elle conserve les sorties dans `test-reports/preproduction-*.txt` et produit `test-reports/preproduction-local.json`. Elle renvoie un échec si un contrôle échoue. Elle n’exécute pas le cycle d’achats sur les DB.

Si les dépendances ne sont pas installées dans TON projet, faire d’abord `npm ci`. Les dépendances et versions du verrou n’ont pas été modifiées par ce correctif. Le script fonctionne avec npm sur Windows comme sur Linux.

## Terminer les essais sur les DB sans toucher aux achats KH

### 1. Connexions

Depuis KH, utiliser le nouveau bouton et télécharger son bilan. Tout échec mène à l’écran de correction. Une table lisible n’assure pas la présence ou les droits d’exécution d’une fonction SQL : c’est le cycle qui le vérifie.

### 2. Cycle réel dédié

Le bouton existant **« Exécuter le cycle sur ce foyer de test »** crée réellement un repas planifié, une liste, des achats et des stocks, puis consomme le repas. Il exige volontairement un foyer vide finissant par `-test` ou `_test`.

- Si tu n’en as pas : créer **KH-test** dans Frosti et Cellio avec le même username dans les deux applications ; les UUID restent propres à chaque DB.
- Créer au moins un lieu Frosti et un lieu Cellio et les règles de rangement nécessaires. Prévoir un produit en présence pour tester cette branche.
- Se déconnecter de KH puis se connecter à Mealio avec KH-test. Saisir le nom dans le champ de confirmation ne change pas la session.
- Dans Intégration, choisir une recette entièrement résolue dont les ingrédients couvrent les deux sources et la présence. Le test local utilise les Gougères avec des réglages de test ; choisir la recette en fonction des règles du foyer réel.
- Exécuter le cycle dans la section technique repliée et télécharger le rapport. Les données de test sont conservées. Le foyer ne sera plus vide pour une seconde campagne : examiner ses résultats avant de préparer un nouvel essai.

Tu n’as pas à refaire la bibliothèque ou les correspondances communes. Les lieux et règles du foyer de test sont nécessaires uniquement pour les écritures du cycle ; l’analyse des 56 recettes continue à fonctionner avec KH.

### 3. Foyers et fonctions récentes

- Avec KH puis un autre foyer, comparer les stocks, listes, lieux et réglages présence. Une correction de recette commune doit être retrouvée par les deux.
- Vérifier dans Anti-gaspi un produit disponible avec une date aujourd’hui ou à J+3 ; puis une date à J+4, qui ne doit pas être urgente. Les produits sans date sont comptés sans être inventés urgents.
- Sur un produit en présence, cliquer Presque terminé et vérifier sa proposition de réappro ; annuler le signal ensuite.
- Pour un lieu précis, vérifier son délai de rappel et le lien du bandeau lorsqu’il est échu. Une confirmation d’inventaire complet doit retirer l’échéance au prochain contrôle. Une correction isolée ne doit pas remettre le compteur à zéro.
- Après l’ajout d’une vraie nouvelle recette Cookiwiki, vérifier l’alerte chez KH et son absence chez l’autre foyer. L’analyse réussie doit faire disparaître cette recette de la liste des nouvelles au prochain contrôle.

### 4. Smartphone et décision

Après build réussi et déploiement, faire sur smartphone : connexion → aide → planning → courses → correction → retour → rangement → stock → inventaire. Vérifier que les boutons utiles et les liens restent accessibles.

La décision de lancer KH en pilote repose sur : contrôles locaux réussis, connexions sans échec, cycle réel sans anomalie, séparation des foyers constatée et parcours smartphone utilisable. Le diagnostic des connexions seul ne suffit pas.
