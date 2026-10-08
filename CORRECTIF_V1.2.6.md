# Mealio 1.2.6 — Épicerie par foyer

## Installation

1. Après les correctifs 1.2.5, exécuter `sql/mealio_v1.2.6_household_pantry.sql` dans le SQL Editor du projet Supabase Mealio.
2. Copier uniquement les fichiers de cette archive dans le projet, en conservant les répertoires.
3. Exécuter `npm test`, puis redémarrer `npm run dev` et régénérer les courses.

La migration crée `household_pantry_products`, indexée par nom du foyer (`user_id`) et ingrédient. Elle copie les réglages actuels pour les foyers connus. Une réexécution ne remplace pas leurs choix. `pantry_products` reste le modèle initial pour les nouveaux foyers et les produits sans réglage privé. L’interface écrit exclusivement les réglages du foyer connecté ; un nom de foyer injecté dans la requête est ignoré. Les UUID des utilisateurs Frosti/Cellio ne sont pas utilisés pour joindre les foyers.

## Utilisation et contrôles

Dans Administration → Épicerie, cocher « Gérer en présence » ou décocher pour suivre les quantités. Les formats sont personnels au foyer. Vérifier avec deux foyers : la farine peut être gérée en présence dans l’un, quantitativement dans l’autre. Régénérer les listes après modification. Les formats des achats déjà engagés restent protégés.

La confirmation d’un repas ne décrémente plus les produits gérés en présence. Les quantités précises restent décrémentées selon les règles habituelles.

Correction des unités discrètes classées `divers` : 2 gousses restent 2 Gousse. Cela ne crée aucune conversion implicite de pièce d’ail en gousse.

Les associations proposées pour Oignon/Oignons frais et Saucisses bretonnes/Saucisse fraîche restent à valider. Même après validation, une quantité en grammes ne couvre pas un besoin en pièces sans masse explicite et vérifiée par pièce.

## Alertes et apprentissage : état actuel et suite proposée

Aujourd’hui, les règles de seuil en mode présence proposent le format par défaut quand le stock est absent. Un stock présent ne révèle pas combien il reste. Cette version n’ajoute ni bouton « presque terminé », ni notification prédictive, ni apprentissage de consommation.

Prochaine étape : enregistrer un signal manuel « presque terminé » par foyer et produit ; afficher une proposition de réapprovisionnement même si le produit est encore présent ; acquitter ce signal après réapprovisionnement confirmé. Ce signal ne doit pas transformer artificiellement le stock en zéro.

Pour apprendre une consommation moyenne, enregistrer des cycles datés « paquet ouvert / paquet terminé », avec leur format et les achats multiples. À partir de plusieurs cycles, proposer une estimation hebdomadaire et une date à vérifier, avec le nombre d’observations et une incertitude. Les achats seuls permettent d’estimer une fréquence de réapprovisionnement, mais peuvent inclure des réserves et ne mesurent pas directement la consommation. Les prévisions doivent rester distinctes du stock réel.

## Vérification

141 tests automatiques + 14 scénarios historiques passent sur les modules réels avec des doublures locales pour Supabase et HTTP. Contrôles de syntaxe TS/TSX effectués. Pas de connexion à votre Supabase ni de compilation Next complète dans cet environnement : exécuter la migration et vérifier l’application localement.
