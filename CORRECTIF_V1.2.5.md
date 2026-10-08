# Mealio 1.2.5 — épicerie en présence et formats d'achat

Archive incrémentale depuis 1.2.4 : uniquement fichiers nouveaux ou modifiés, avec leurs répertoires.

## Installation

1. Arrêter `npm run dev`.
2. Dans SQL Editor du projet **Supabase Mealio**, exécuter `sql/mealio_v1.2.5_pantry.sql`. La migration 1.2.4 doit déjà être appliquée.
3. Copier les fichiers de cette archive à la racine de Mealio.
4. Lancer `npm test`, puis `npm run dev`.
5. Ouvrir **Admin → Épicerie**, vérifier les formats proposés et régénérer les courses.

La table `pantry_products` n'existait pas dans les fichiers/schémas fournis. Le script la crée si nécessaire, puis initialise 113 références existantes. Il joint les ingrédients par leur nom exact ; une référence renommée ou supprimée n'est pas recréée. Le SELECT final affiche les références réellement initialisées.
Une réexécution du script préserve les réglages existants. Aucun stock, compte, nom de foyer, ingrédient officiel ou historique n'est réécrit. L'accès applicatif passe par les routes serveur authentifiées, avec RLS activée sur la nouvelle table.

Le SQL n'a pas été exécuté sur ton Supabase : vérifier son résultat avant de redémarrer l'application. Les nouvelles colonnes et la table sont indispensables au code 1.2.5.

## La liste complète

`PRODUITS_EPICERIE.md` contient les 113 produits et leur quantité/unité d'achat par défaut. Les formats sont des propositions de départ, à adapter à vos habitudes. Exemples : farines et principaux sucres 1000 Gramme, sel et poivres 250 Gramme, huile d'olive 750 Millilitre, thym séché 25 Gramme. Le safran, la vanille et les levures ont des formats spécifiques.

Les produits frais ne basculent pas en présence. Pesto, mayonnaise, galettes de sarrasin et graisses fraîches sont exclus de la sélection initiale. Une nouvelle référence peut être ajoutée depuis Admin → Épicerie.

## La table

- `ingredient_id` : identifiant officiel, clé primaire ; une règle par ingrédient.
- `default_quantity` : quantité physique d'un achat habituel, strictement positive.
- `default_unit` : unité d'achat connue dans Mealio.
- `enabled` : true = disponible/épuisé, false = calcul quantitatif habituel.
- `updated_at` : dernière modification depuis l'écran Admin.

Les formats sont communs à tous les foyers, comme le référentiel des ingrédients. Les stocks et listes restent strictement ceux du foyer connecté. Une préférence de format par foyer n'est pas ajoutée dans cette version.

## Matcher et Courses

Pour un ingrédient activé dans cette table :

- Une identité compatible avec une quantité de stock finie et positive signifie « disponible », quelle que soit son unité.
- Zéro, valeur négative, NaN ou infini ne signifie jamais disponible.
- Les identités restent protégées : farine de riz ≠ farine de blé, frais ≠ sec, proposition IA non validée ≠ identité officielle.
- Aucune conversion ni déduction de consommation de recette n'est faite pour cet ingrédient.
- Si absent, un seul format habituel est proposé, même si plusieurs recettes ou beaucoup de portions l'utilisent.
- Dans Courses, « + » et « − » changent le nombre de formats (minimum ×1 ; supprimer la ligne pour ne pas l'acheter). Par exemple sucre ×2 = 2000 g si le format vaut 1000 g.
- La coche enregistre la quantité physique choisie. L'historique et le rangement reçoivent cette quantité réelle, pas le nombre de formats.
- La progression, la clôture et la reprise tiennent compte de la quantité d'achat choisie : ×1 acheté sur ×2 souhaité reste partiel.
- Le format est mémorisé sur la ligne via `shopping_items.pantry_pack_quantity`. Une régénération conserve ce format et la quantité choisie lorsque l'unité et le mode restent compatibles.

Le format d'achat peut être différent de l'unité de référence culinaire, s'il est explicitement approuvé par la table. Exemple : herbes sèches achetées en grammes malgré une ancienne référence en cuillères. Il ne s'agit pas d'une conversion de stock.
Les anciennes densités sont conservées mais ignorées en mode présence. Désactiver ce mode réactive les conversions explicites. L'administration et l'audit des ingrédients lisent le nouveau mode.

Cookiwiki conserve les quantités nécessaires pour cuisiner. La ligne exacte « Sel et poivre » à quantité 0 est séparée lors de la lecture en Sel fin et Poivre noir, sans modifier la recette enregistrée. Les autres ingrédients composés ne sont pas séparés arbitrairement.

## Favoris et réapprovisionnement

Les favoris d'épicerie ajoutent le format habituel. Une règle de seuil active sur un produit d'épicerie propose ce format uniquement lorsque le produit est absent/épuisé ; elle ne cherche plus un manque en grammes.
Les règles récurrentes explicites conservent leur échéance : pour l'épicerie, leur proposition utilise le format habituel. Elles restent des achats périodiques, même si du stock existe, contrairement aux règles de seuil. Les réglages des règles du foyer ne sont pas réécrits.
Les suggestions restent soumises aux modes déjà choisis par le foyer (suggestion ou systématique).

## Quand un paquet est terminé

Retirer la ligne concernée dans Frosti/Cellio, ou y mettre sa quantité à zéro si l'application le permet. Mealio ne mesure pas la consommation de ces produits. Tant qu'une autre ligne compatible positive existe, le produit reste disponible. Nettoyer les anciens doublons de test qui représenteraient le même stock physique.

Le stock brut peut encore afficher « 14 Gramme » ou « 1 Pièce » pour une huile : cela ne déclenche plus de conversion en mode présence. L'identité reste essentielle.
Un fond de paquet est considéré disponible même si une recette en demande beaucoup. Si tu souhaites vérifier la suffisance réelle d'un ingrédient, désactive son mode présence et conserve un stock quantifié.

## Vérification

135 tests automatiques et 14 tests historiques passent avec les modules réels et des doubles locaux pour les services externes. Tests nouveaux : disponibilité quelle que soit l'unité, identité farine riz/blé, stock nul/invalide, un format pour plusieurs recettes, mode désactivé, format invalide, panne de table, session Admin, modification de format, achats ×2, conservation du format à la régénération, générateur réel huile et règles de seuil.
La syntaxe des 21 fichiers TS/TSX modifiés est également vérifiée. Les 113 valeurs SQL sont distinctes, positives et utilisent les unités de ton export.
Le build complet, le SQL en base réelle et les essais navigateur restent à vérifier localement.

Essai conseillé : aucun sucre en stock → génération d'un format ; passer à ×2 → cocher → vérifier 2000 g achetés et le rangement. Puis stock positif → prochaine génération sans achat de sucre. Farine de riz seule → le besoin de farine de blé doit rester à acheter.
