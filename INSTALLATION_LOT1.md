# Mealio V1.2.2 — Stabilisation, lot 1

Livraison du 7 octobre 2026, basée sur Mealio_V1.2.zip.

## Installation

1. Sauvegarder le dossier actuel et les bases avant toute installation.
2. Extraire cette archive dans un NOUVEAU dossier. Elle contient tous les fichiers du projet fourni et les corrections. Les données d'exemple et les anciens fichiers restent présents pour référence.
3. Recopier votre `.env.local` dans ce nouveau dossier. Le nom du foyer demeure la jonction entre Frosti et Cellio ; chaque application conserve ses propres UUID.
4. Avec les dépendances disponibles, exécuter `npm install`, puis `npm test`, `npm run typecheck`, `npm run lint` et `npm run build`.
5. Après un build réussi, lancer `npm start` ou effectuer votre déploiement habituel. Se reconnecter : le matcher utilise maintenant `mealio_session` comme les autres API.

Aucune migration SQL ni modification des mots de passe n'est nécessaire pour ce lot.
Le fichier package-lock fourni présente une incohérence npm préexistante autour de dépendances optionnelles WASM. Une installation propre et une régénération du verrou peuvent être nécessaires sur votre machine ; elles n'ont pas pu être validées hors ligne dans l'environnement de correction. Les versions de Next/React/Supabase n'ont pas été changées.

## Tests automatiques

`npm test` lance les modules de production avec des doublures locales de Supabase et des requêtes HTTP. Il n'utilise aucune base réelle, aucune clé réelle et aucun service Claude.
Sur Node récent disposant de stripTypeScriptTypes, les tests fonctionnent sans installation des dépendances. Sinon, le lanceur utilise TypeScript installé par npm. Node 22.13+ ou Node 24 est conseillé pour les tests autonomes.

Résultat de la livraison : 91/91 tests Node réussis et 14/14 scénarios du laboratoire historique réussis. Les scénarios historiques se recouvrent : cela ne représente pas 105 cas métier indépendants.
Les messages d'erreur de panne simulée figurant dans le rapport sont attendus ; seul le statut final détermine la réussite.

Les tests couvrent notamment les sessions absentes/falsifiées/expirées, les anciens cookies, le contrôle du foyer dans le feedback, les fausses identités de stock, les anciennes mémoires incompatibles, les exclusions, la présence à zéro, les conversions et leurs unités, les quantités inconnues et les pannes de lecture/IA.

Les suites Vitest V1.1 existantes restent présentes. Leurs imports relatifs sont corrects ; la nouvelle commande commune n'a pas besoin de Vitest ou d'une connexion Supabase.

## Comportements corrigés

- Les quatre routes matcher actives utilisent la session Mealio signée.
- Un feedback ne peut cibler qu'un article présent dans le stock du foyer connecté. Ses données sont relues côté serveur ; un nom de produit fourni par le navigateur n'est pas une preuve.
- Un identifiant officiel différent bloque le rapprochement avant la mémoire, le lexical et Claude. Un simple mot commun n'est plus une preuve d'équivalence.
- Une proposition Claude non validée ne réduit pas automatiquement les achats. Une correspondance inconnue peut demander plus de validations qu'avant : c'est volontaire.
- Une erreur fournisseur ou une réponse JSON invalide ne devient pas une décision AUCUN persistante. Les anciens AUCUN en attente ne bloquent plus les résolutions futures. Un délai de 15 secondes limite l'appel IA.
- Les quantités de conversion sont cohérentes avec leur unité retournée : g, mL ou unité discrète. Exemple : 2 cs de miel → 30 mL, et 42 g de miel → 30 mL via la densité explicite.
- Un stock nul/négatif/non fini ne compte pas comme disponible, y compris en mode Présence.
- Une quantité inférée depuis les instructions Cookiwiki, nulle ou invalide est signalée comme inconnue. Aucune pièce ni quantité d'achat n'est inventée. Courses journalise le problème et permet de corriger la recette ou d'ajouter un article manuel.
- L'agrégation sépare les unités incompatibles et les quantités inconnues des besoins connus.
- Courses et le laboratoire utilisent le service serveur de lecture du stock. Une panne ne devient pas un stock vide.
- Les erreurs de lecture du référentiel, de mémoire et d'exclusions interrompent le calcul.
- Les anciennes variantes sont conservées mais exclues du contrôle TypeScript et du lint.

## Vérifications à effectuer sur votre installation

Le build Next.js, le contrôle TypeScript complet, le lint, les permissions des bases et les parcours navigateur n'ont pas pu être exécutés ici, faute de dépendances disponibles. Les tests API utilisent les vrais routeurs avec des doublures Next/Supabase, pas un serveur Next démarré.

Après installation : connexion puis Matcher, test farine de blé avec seulement farine de riz, test miel, génération depuis une recette aux quantités inconnues, puis génération normale avec stock partagé Frosti/Cellio. Conserver les rapports de typecheck/build en cas d'erreur avant déploiement.

## Travaux du lot suivant

Cette version ne finalise pas la reprise des transferts pending, la consommation interrompue, les décréments atomiques concurrents, ni l'allocation d'un même stock entre plusieurs besoins distincts. Elle ne migre pas les mots de passe Frosti et ne certifie pas les politiques RLS ou les index uniques des bases réelles.
Le référentiel doit encore être audité sur les données réelles, notamment les synonymes ambigus et les unités/densités. Les anciennes décisions incorrectes sont écartées par les contrôles, sans suppression automatique de données.
