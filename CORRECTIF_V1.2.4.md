# Mealio 1.2.4 — correctif incrémental depuis 1.2.3

Cette archive contient uniquement les fichiers nouveaux ou modifiés, avec leurs répertoires.

## Installation

1. Arrêter le serveur de développement.
2. Dans SQL Editor du projet Supabase **Mealio**, exécuter `sql/mealio_v1.2.4_reference.sql`. Le SQL ajoute `reference_signature` : il est indispensable avant de démarrer le nouveau moteur.
3. Copier les fichiers de l'archive à la racine de Mealio en conservant les répertoires.
4. Exécuter `npm test`, puis `npm run dev` et régénérer les courses.

Le SQL est transactionnel et réexécutable. Il retire deux synonymes incorrects, rejette deux types de propositions dangereuses encore en attente, ajoute six références absentes et un synonyme de bouquet. Il ne change pas les anciennes références, les stocks ni les comptes. Les nouveaux ingrédients ont un rangement général Frosti/Cellio ; configure ensuite leur emplacement physique dans les règles du foyer.

Le script est préparé à partir de ton export ; il n'a pas été exécuté sur Supabase. Si une contrainte inconnue de l'export le refuse, la transaction empêche une application partielle. Transmettre l'erreur avant de démarrer le nouveau code.

## Comportement corrigé

- Cookiwiki : une unité vide avec le nom exact « Gousses d'ail » devient Ail en gousses. Une unité déjà renseignée reste prioritaire ; la vanille n'est pas réécrite. Aucun nombre de gousses par tête n'est inventé.
- Proposition IA en attente : le nom original et la quantité restent visibles. L'ID proposé n'est pas utilisé pour le calcul, la conversion ou le rangement tant que l'identité n'est pas validée. Le message mentionne la proposition à vérifier.
- AUCUN : un résultat négatif récent est réutilisé pendant 24 h avec une empreinte des ingrédients, synonymes et mots ignorés. Une modification de ce référentiel invalide le cache ; l'expiration permet une nouvelle tentative. Les anciens journaux sans empreinte sont réessayés. Une panne Claude n'est toujours pas enregistrée comme AUCUN. Les doublons historiques sont conservés et aucune contrainte de concurrence n'est ajoutée : deux requêtes simultanées peuvent encore produire deux journaux.

## Validation

109 tests automatisés et 14 tests historiques passent avec les modules réels et des doubles locaux pour les accès externes. Couverture nouvelle : lecture gousses/vanille, proposition en attente, cache négatif récent/expiré/modifié, empreinte stable et pipeline ail avec stock en pièces incompatible.
Le build complet, le SQL sur Supabase et les essais navigateur restent à vérifier dans ton environnement.

## Points qui peuvent rester à vérifier

- Quatre saucisses en pièces ne sont pas comparables à 870 g sans masse vérifiée et identité compatible. La création de Saucisse fraîche ne valide aucune substitution de Toulouse. Si la recette vise des saucisses fraîches génériques, expliciter ce choix dans Cookiwiki ; si elle exige une spécialité bretonne, créer cette référence spécifique.
- Sel et poivre : remplacer la ligne composée par deux ingrédients, Sel fin et Poivre noir, avec quantité non précisée/0 pour le mode présence. Ne pas créer un synonyme Sel et poivre vers un seul produit.
- Oignon en pièce et Oignons frais en grammes : vérifier les identités, puis une masse par pièce si pertinente. Aucune masse n'est ajoutée par ce correctif.
- Ail en pièces : préciser si chaque ligne représente des gousses ou des têtes. Changer en Gousse uniquement lorsque cela décrit réellement le stock.
- Les 15 mL d'huile couvrent une cuillère à soupe de 15 mL si l'identité stock est validée. Les autres lignes en pièces et en grammes restent à clarifier ; ne pas additionner des doublons qui représentent le même stock physique.
