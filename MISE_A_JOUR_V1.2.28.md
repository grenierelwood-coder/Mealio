# Mealio 1.2.28 — Historique et habitudes du foyer

À appliquer après la version 1.2.27. L’archive contient uniquement les fichiers nouveaux ou modifiés, complets, avec leurs répertoires.

## Installation
1. Dans le SQL Editor de Supabase MEALIO uniquement, exécuter sql/mealio_v1.2.28_history.sql.
2. Recopier les fichiers de l’archive dans Mealio en conservant les répertoires. Les dépendances ne changent pas.
3. Exécuter npm run verify:production, puis pousser et déployer si les quatre contrôles passent.

Aucun SQL à exécuter dans Frosti, Cellio ou Cookiwiki. Le SQL ajoute la mémoire des propositions et leur activation atomique ; il ne modifie aucun stock ni association commune. Il n’a pas été exécuté sur vos DB depuis cette session.

## Où trouver les nouveautés
Le menu Historique est accessible dans le bandeau et dans Plus sur smartphone. L’accueil et Réapprovisionnements donnent également accès à cet écran.

- Achats : toutes les lignes paginées de l’historique du foyer, recherche produit et dates. L’ancien écran Achats reste accessible pour ses filtres par catégorie.
- Repas & recettes : un repas antérieur au jour actuel à Paris, conservé au planning, est considéré comme réalisé. Le jour en cours et les dates futures sont exclus. Les anciennes confirmations et les anciens refus explicites restent distingués.
- Consommations : besoins estimés des repas, séparés du journal des déductions déjà enregistrées. Ces deux ensembles ne doivent pas être additionnés.
- Analyses & recommandations : besoins moyens, recettes utilisées et propositions de règles propres au foyer.

La fenêtre globale qui demandait de confirmer chaque repas passé est retirée. La lecture de l’historique ne crée ni consommation en DB ni déduction dans Frosti/Cellio. L’API de confirmation explicite existante reste disponible, notamment pour les tests du cycle complet.

## Comment Mealio apprend
Les besoins moyens utilisent au maximum 12 semaines, avec les portions du repas, les conversions connues et les modes de suivi actuels du foyer. Les semaines sans repas sont incluses. Un planning incomplet sous-estime donc les besoins.

Les besoins sont recalculés depuis les recettes actuelles, et ne constituent pas des mesures historiques exactes. Un ingrédient sans association, une dose encore estimée ou une conversion inconnue est affiché à vérifier et exclu des moyennes fiables. Aucun appel Claude et aucune modification du Matcher.

Pour les produits suivis en quantité : un seuil peut être proposé après au moins 28 jours observés et quatre semaines distinctes utilisant le produit, sans dose incomplète connue. La proposition couvre une semaine de besoin au seuil et deux semaines au stock cible. Elle n’est pas une quantité d’achat fixe : les règles existantes comparent ensuite le stock réel.

Pour l’épicerie suivie en présence : les recettes ne créent aucune quantité consommée. Une fréquence peut être proposée après quatre jours d’achat distincts à intervalles suffisamment réguliers. La quantité est le format d’achat paramétré pour le foyer. Les achats récents et jusqu’à 12 mois d’historique servent au calcul ; un historique trop ancien ou irrégulier ne crée pas de proposition.

Les recettes récurrentes peuvent être reconnues sur les 12 derniers mois, après au moins quatre dates distinctes à intervalles réguliers. Leur fréquence est affichée avec un lien vers le planning.

## Activer ou reporter une proposition
Ouvrir Analyses & recommandations, puis Vérifier et activer. Ajuster la quantité, le seuil ou l’intervalle ; cliquer sur Activer cette règle.

La règle est créée en mode suggestion : elle propose des achats, sans les ajouter silencieusement. La modifier ou la désactiver dans Réapprovisionnements. Une règle déjà existante, même désactivée, n’est pas écrasée. Les anciennes règles sans ID officiel sont aussi reconnues lorsque leur libellé est déterministe.

Me le reproposer dans 30 jours conserve le report pour ce foyer. Un double clic ou deux activations simultanées par ce nouvel écran sont protégés par une transaction SQL et un verrou par foyer/ingrédient.

Supprimer un repas passé sans confirmation explicite retire sa réalisation déduite des statistiques. Modifier ses portions recalcule ses besoins. Un journal de consommation existant est lu séparément et n’est pas réécrit par l’historique.

## Validation réalisée
624 tests automatisés, 14 scénarios laboratoire et tests d’interface réussis. Typage étendu des tests, de toutes les routes API et des écrans concernés : zéro erreur.

Les tests couvrent notamment deux foyers, l’absence de Claude et de mutation de stock en lecture, la pagination au-delà de 500 achats, les dates, les doses estimées, la suppression et les portions du planning, les cycles mensuels, les refus d’activation invalides et la portée du foyer connecté.

Le build Next.js complet et l’exécution SQL réelle restent à confirmer sur votre installation. Le contrôle de préparation à la production vérifie aussi l’accès aux nouvelles décisions de l’historique.

## Essai rapide sur KH
- Ouvrir Historique et retrouver un achat par produit et période.
- Vérifier un repas d’hier et ses portions ; contrôler qu’ouvrir l’écran ne change pas le stock.
- Retrouver les besoins en présence sans grammes consommés.
- Ouvrir Analyses. Au début, l’absence de proposition est normale si l’historique est insuffisant ou si les règles couvrent déjà les produits.
- Si une proposition apparaît, vérifier puis activer ; retrouver une seule règle dans Réapprovisionnements.
