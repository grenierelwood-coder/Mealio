# Mealio 1.2.16 — version visible et simplification

Cette livraison complète la 1.2.15. Copier uniquement les fichiers fournis à la racine de Mealio, répertoires conservés, puis redémarrer `npm run dev` et Ctrl+F5. En production : refaire `npm run build`. Aucun nouveau SQL.

## Changements

- Version **v1.2.16** dans le bandeau principal, sur ordinateur et smartphone. La valeur vient du `package.json`, également utilisé par les repères Inventaire et Intégration. Il n’y a plus plusieurs numéros saisis séparément pour ces écrans.
- Liens de l’Inventaire vers `https://frosti-ten.vercel.app/` et `https://cellio-ten.vercel.app/`, sans configuration supplémentaire. Les variables existantes `NEXT_PUBLIC_FROSTI_APP_URL` / `NEXT_PUBLIC_CELLIO_APP_URL` peuvent toujours remplacer ces adresses si renseignées.
- Ces liens ouvrent l’application dans un nouvel onglet. Une route de fiche connue et prise en charge par l’app reste nécessaire pour ouvrir directement un article. Les adresses d’accueil fournies n’indiquent pas cette route. Quantité et unité restent corrigeables directement dans l’Inventaire Mealio.
- Cycle complet regroupé dans une rubrique repliée **Tests techniques avancés**. L’analyse des recettes avec le foyer habituel reste visible.
- Cases Estimation / Facultatif / Hors courses et note regroupées dans **Options de l’ingrédient**, replié par défaut. Nom, quantité et unité restent directement accessibles. Les badges quantité absente/estimée et l’état facultatif/exclu restent visibles.

## Le compte de test : faut-il recréer quelque chose ?

Pour utiliser Mealio, planifier, générer les courses ou analyser les recettes sur KH : **non**.

Pour lancer le cycle technique automatique actuel : **oui**, il faut créer un foyer distinct dans Frosti/Cellio, par exemple KH-test, avec ses propres lieux et règles, puis se connecter à Mealio avec ce foyer. C’est une limite pratique de l’outil de test actuel, pas une étape normale du produit.

Ce cycle écrit réellement planning, achats, stock et historique puis confirme une consommation. Il ne copie pas automatiquement KH et n’est pas une simulation avec annulation. Un simple champ « KH-test » ne crée rien et ne change pas la session. Le foyer est vérifié vide avant l’exécution ; les données créées restent disponibles pour examen.

Il est possible de simplifier cet outillage à l’avenir par un bac à sable automatiquement préparé, mais ce mécanisme n’est pas implémenté ici. Il devrait créer des données isolées et garder une séparation fiable des foyers dans les trois bases, sans toucher aux données réelles.

## Avis de maturité du Matcher

**Bêta fonctionnelle en stabilisation, avec une base technique désormais bien testée.** Pas encore une validation complète en conditions réelles. Il serait trompeur d’attribuer un pourcentage de maturité à partir du seul nombre de tests.

Acquis testés localement :

- Normalisation, résolution officielle et réutilisation des synonymes validés ; priorité sur d’anciennes propositions IA stock.
- Protection des identités incompatibles, dont farine de blé et farine de riz ; stock ambigu ou non convertible conservé sans déduction injustifiée.
- Conversions explicites, poids moyens modifiables et conservation des besoins quand une conversion manque.
- Quantités et portions, ingrédients actifs, exclusions et choix préparés ; mode épicerie propre au foyer.
- Recalcul des courses et scénarios de rangement/consommation sans doublon, avec accès DB simulés.
- Recherche Anti-gaspi indépendante des IDs officiels manquants et modes OU/ET.

Restant à valider avant de considérer le cœur éprouvé :

1. Campagne des 56 recettes sur le référentiel et le stock Supabase actuels, puis correction des associations/conversions réellement en attente.
2. Claude réel : propositions, refus, erreurs et réutilisation après validation. Les appels simulés ne valident pas la qualité du modèle réel.
3. Plusieurs cycles d’achat/rangement/consommation avec les vrais lieux et historiques, sur des données isolées pour le test automatique.
4. Cas de concurrence, interruption et reprise, ainsi que temps de réponse avec les données réelles.
5. Une période d’usage normal avec examen des anomalies restantes et confirmation des résultats attendus.

L’objectif n’est pas de supprimer tous les avertissements : une quantité réellement absente ou un produit ambigu doit rester explicable et corrigeable. La qualité du référentiel est distincte de celle du moteur.

## Simplifications prioritaires proposées

Ces propositions ne sont pas toutes implémentées dans ce correctif.

1. **Courses** : une seule alerte regroupée par produit ; une action Corriger ouvre le choix d’ingrédient ou d’unité déjà prérempli, puis propose de recalculer. Réduire les messages répétés en haut et sur les lignes.
2. **Stock / Inventaire** : réutiliser une même recherche et les mêmes filtres de lieux ; un mode consultation et un mode mise à jour évitent deux expériences différentes. Conserver les points d’entrée demandés dans le menu.
3. **Planning** : action principale explicite Ajouter au planning, puis Générer/mettre à jour mes courses. Garder les diagnostics du moteur hors du parcours ordinaire.
4. **Recettes** : privilégier nom / quantité / unité, options secondaires repliées ; deux lignes pour un mélange et un seul produit retenu pour un choix. Conserver les cas déjà préparés sans demander de manipuler une structure technique.
5. **Admin** : préserver l’ordre des menus choisi, mais rendre les outils techniques identifiables comme avancés. Le cycle automatique ne doit pas ressembler à une étape obligatoire.

La priorité recommandée est Courses et ses corrections, puis Stock/Inventaire. Éviter une nouvelle refonte du moteur avant d’avoir les résultats de la campagne réelle.

## Vérifications

577 tests locaux et les 14 cas historiques passent. Tests des écrans réussis, dont la version du bandeau lue depuis le package, les analyses de recettes, les recherches et les sauvegardes par lieu. Typage ciblé des écrans sans erreur.

Pas de campagne sur ton Supabase actuel, d’appel Claude réel ou de build Next complet effectué ici. Les adresses des applications sont celles fournies par l’utilisateur ; aucune route d’édition de fiche n’a été supposée.
