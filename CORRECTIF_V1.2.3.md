# Correctif Mealio V1.2.3 — huile et régénération

Cette archive contient uniquement les fichiers modifiés depuis V1.2.2, plus cette notice. Les chemins partent de la racine de votre projet. Copier en remplaçant les fichiers correspondants ; conserver .env.local. Arrêter et relancer npm run dev, puis Mettre à jour mes courses.

L'huile référencée en Millilitre et demandée en cuillères reste en volume : aucun détour obligatoire par les grammes. Les facteurs viennent du référentiel existant des unités. Une pièce de stock ne devient jamais une bouteille de contenance supposée.

Lorsqu'une unité change, la ligne automatique du même produit est réutilisée si elle n'a été ni cochée, ni achetée, ni rangée, et si aucun besoin actuel ne demande son ancienne clé. L'unité et la quantité sont changées ensemble ; les anciens grammes ne sont pas comparés numériquement aux nouveaux millilitres. Les lignes manuelles/achetées/rangées sont préservées.

Tests : npm test. Résultat local : 102/102 tests Node et 14/14 scénarios du laboratoire. Deux tests supplémentaires exécutent le vrai générateur de courses avec des doublures de bases pour vérifier la régénération g -> mL et la préservation des achats. Aucun accès aux bases réelles. Le build et le navigateur réel restent à vérifier sur votre machine.

Les messages offline et Simulated outage dans npm test correspondent à des pannes volontairement simulées. Les tests portant un titre FAIL vérifient qu'une donnée incorrecte est effectivement détectée ; ce titre ne signifie pas que le test a échoué. Lire le total fail en fin de campagne.

Les alertes restantes de données doivent être résolues explicitement : séparer Sel et poivre dans la recette ; préciser les associations pour les libellés non résolus ; vérifier si l'ail demandé est une tête ou des gousses ; préciser le poids des saucisses ou une masse par pièce vérifiée ; renseigner la contenance réelle des stocks d'huile, idéalement en mL/L. Aucune table ni donnée de votre foyer n'a été modifiée par cette livraison.
