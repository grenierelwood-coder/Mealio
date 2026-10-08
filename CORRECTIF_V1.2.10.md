# Mealio 1.2.10 — moyennes, associations et inventaires par lieu

## Installation

Installer ce correctif après 1.2.9 : l’archive contient uniquement les fichiers modifiés ou ajoutés.

1. Dans **Supabase Mealio → SQL Editor**, exécuter **`sql/mealio_v1.2.10_defaults.sql`**. La migration 1.2.8 doit déjà avoir été appliquée. Ce nouveau SQL initialise directement les moyennes et associations : **il n’est pas nécessaire de lancer l’ancien second SQL pour ces valeurs**.
2. Copier les fichiers de l’archive dans le projet, en conservant les répertoires.
3. Lancer `npm test`, puis redémarrer `npm run dev` et régénérer les courses.
4. Aller dans **Inventaire**, sélectionner le lieu contenant l’ail, compter les gousses réelles, saisir leur nombre et choisir **Gousse**, puis enregistrer. Répéter dans chaque lieu concerné.

Le SQL ne réécrit pas les recettes Cookiwiki ni les stocks Frosti/Cellio. Il prépare le référentiel Mealio et la fonction d’enregistrement des associations utilisée par le nouvel écran. Il est réexécutable : les moyennes et synonymes existants sont conservés. La référence Gousse et les 5 g pour l’ail sont fixés lors de la première exécution, puis les ajustements ultérieurs de masse restent conservés. Une ancienne densité Ail/Pièce est supprimée à chaque exécution car cette unité est interdite.

Les unités de référence choisies sont installées une seule fois. Les historiques d’achats et les articles déjà achetés ne sont pas convertis rétroactivement. Régénérer les articles automatiques non achetés permet d’utiliser les nouvelles unités. Les anciennes règles/seuils/favoris sont convertis au moment de leur ajout aux Courses lorsqu’une équivalence est disponible ; sinon ils demandent une correction explicite.

## Données initialisées

- **119 équivalences proposées**, en grammes pour 1 unité, avec un commentaire indiquant leur caractère approximatif. Les valeurs déjà présentes sont conservées, sauf la première initialisation explicite Ail/Gousse = 5 g.
- **104 synonymes ou choix par défaut proposés**, sans remplacement silencieux des associations existantes vers une autre cible.
- **39 ingrédients créés seulement s’ils sont absents**, pour distinguer notamment frais/sec, cru/cuit et fumé/non fumé. Les bouillons liquides de bœuf et de volaille restent distincts.
- La file `reference_enrichment_review` est actualisée pour les associations et masses désormais couvertes par le référentiel actif. Les autres demandes restent à examiner.

Les moyennes, choix génériques et unités sont listés dans **`test-reports/reference-defaults-v1210.md`**. Ils sont des paramètres de départ autorisés pour faciliter les courses, pas des mesures du lot ni des valeurs nutritionnelles certifiées.

Exemples : ail 5 g/gousse, oignon 150 g/pièce, carotte 80 g/pièce, courgette 250 g/pièce, aubergine 300 g/pièce, saucisse fraîche 100 g/pièce, saucisse de Toulouse 125 g/pièce, rouleau de pâte 230 g, tranche de pain de mie 30 g.

Pour les ajuster : **Admin → Ingrédients → fiche de l’ingrédient → Densités culinaires**. Saisir la même unité canonique et la nouvelle masse, puis « Ajouter » : cette opération remplace la valeur pour le couple ingrédient/unité. Pour un produit géré en présence par ton foyer, les densités sont ignorées ; revenir à la gestion quantitative dans Admin → Épicerie avant d’en éditer les masses.

## Unités à retenir

| Produit / famille | Unité de référence pour les courses | Saisies de recettes acceptées |
| --- | --- | --- |
| Ail frais | **Gousse** | Gousse, g/kg ; une tête explicitement nommée est estimée à 50 g, donc 10 gousses avec les valeurs initiales. |
| Oignons, échalotes, carottes, courgettes, aubergines, navets, poivrons, tomates, principaux fruits entiers, poireaux | **Pièce** | Pièce ou poids, convertis par les moyennes de chaque ingrédient. |
| Œufs, jaunes et blancs d’œufs | Pièce | Nombre ou poids avec une masse propre à chaque produit. |
| Saucisse fraîche / Toulouse | Pièce | Nombre ou poids avec leurs masses distinctes. |
| Pain de mie | Tranche | Tranche ou poids. |
| Thym et romarin frais | Brin | Brin, branche ou poids. |
| Laurier frais | Feuille | Feuille, branche ou poids avec les masses renseignées. |
| Basilic et coriandre fraîche | Bouquet | Bouquet, botte ou poids avec les masses renseignées. |
| Autres viandes, poissons, céréales, fromages, ingrédients découpés | Référence existante, généralement Gramme | Poids ; pièce/tranche/rouleau seulement avec une équivalence propre au produit. |
| Huiles, lait, bouillons liquides, boissons | Référence existante, généralement Millilitre | Volume et cuillères ; poids lorsque la densité existe. |
| Épiceries gérées en présence | Format d’achat du foyer | La quantité consommée n’est pas calculée ; la présence en stock et le format habituel suffisent. |

**Ail/Pièce est interdit** dans le calcul, les nouveaux achats et l’inventaire enregistré. Une ancienne ligne en Pièce reste visible pour correction, mais ne couvre pas automatiquement des gousses. L’interdiction est propre à l’ail, pas globale.

Les « pièces » attachées à un nom explicite tel que « Gousses d’ail » sont correctement relues comme des gousses. Les branches, feuilles et tranches explicites dans le nom sont également reconnues. Un libellé tel que « cuisson », « pour parsemer » ou « selon le goût » n’est pas une unité mesurable : il faut une quantité explicite ou une gestion en présence.

Les pièces/gousses/tranches/bouquets et autres unités d’achat entières sont arrondies au supérieur après déduction du stock. Exemple : besoin 2 oignons, stock 100 g, moyenne 150 g/pièce → stock estimé 0,67 pièce, besoin restant 1,33 pièce → achat proposé **2 pièces**. Le calcul du besoin reste disponible avec ses fractions.

## Associations par défaut et validation depuis Courses

Le SQL retient des choix simples pour les formulations génériques : farine → farine de blé ; lait → demi-écrémé ; huile neutre → tournesol ; sucre → sucre en poudre. Pour les alternatives identifiées, le choix retenu est détaillé dans le rapport, souvent la première option. Ces associations sont partagées entre foyers. On peut les changer dans Admin, ou préciser l’ingrédient dans Cookiwiki pour une recette particulière.

Les distinctions explicites restent conservées : farine de riz ne devient pas farine de blé, ail en poudre ne devient pas ail frais, saumon fumé ne devient pas saumon frais, cocos à écosser ne deviennent pas cocos écossés.

Dans Courses :

- Le nom d’une alerte et le badge **« À vérifier → »** ouvrent la correction.
- Pour un nom, le nouvel écran permet de sélectionner l’ingrédient officiel et **enregistrer une association durable**. Un rapprochement de stock propose bien le libellé du stock à associer.
- Pour une conversion, le lien ouvre la fiche Admin de l’ingrédient lorsque son nom est connu, avec les densités et son unité de référence.
- Retourner aux Courses et régénérer après correction.

La validation ne crée pas de masse par défaut à elle seule. Elle enregistre l’identité ; les conversions sont séparées. Une association déjà présente vers une autre cible demande une correction explicite dans Admin. L’enregistrement est sérialisé côté DB pour éviter deux associations contradictoires simultanées. Une erreur de persistance d’une validation/refus/oubli est remontée : aucun succès utilisateur n’est annoncé si l’écriture échoue. Le cache automatique conserve un comportement de secours lorsqu’une écriture de cache échoue.

## Inventaire par lieu

« Point Frigo » devient **Inventaire** dans les menus. Le lien historique `/point-frigo` reste fonctionnel.

1. Choisir **un lieu précis** : frigo, congélateur, placard, cave, etc., provenant de Frosti ou Cellio.
2. Vérifier uniquement les produits de ce lieu ; corriger leurs quantités et, si nécessaire, leurs unités.
3. Valider ce lieu, puis passer au suivant.

Changer de lieu annule les modifications non enregistrées : l’aide à l’écran le précise. Sans lieu choisi, aucun inventaire global n’est proposé. Les lieux vides et les stocks sans lieu renseigné sont consultables séparément. Changer une unité exige de saisir aussi la quantité réelle correspondante : le changement de libellé n’est pas une pesée automatique.

Le serveur vérifie tous les articles du lot avant la première écriture : foyer signé, application, lieu, quantité, unité et valeurs affichées initialement. Un lot contenant un article d’un autre lieu est refusé. Les UUID Frosti/Cellio restent distincts et reliés par le nom du foyer.

Les écritures de plusieurs lignes ne forment pas une transaction unique dans les applications externes. Si une écriture ultérieure échoue, les corrections déjà réussies sont signalées et l’interface recharge le stock. Le contrôle des valeurs initiales détecte une modification antérieure à l’enregistrement ; il ne constitue pas un verrou distribué contre une modification intervenant pendant les écritures.

## Ce qui reste au matcher après ce correctif

La simulation sur le référentiel fourni, enrichi avec ces valeurs et les politiques de présence fournies, traite les **56 recettes** et obtient **448 besoins résolus sur 464 besoins agrégés**. Les 16 autres concernent des compositions/quantités ambiguës. Ces chiffres concernent cet instantané ; ils ne sont pas une mesure de ta DB actuelle ni une certification des masses initiales.

Il ne reste **aucune conversion manquante sur un besoin dont la quantité est connue** dans cette simulation.

Restent principalement :

- Les vrais mélanges : olives noires **et** vertes ; olives et/ou tomates séchées ; ciboulette **et** persil ; mélange de demi-prunes congelées. Il faut préciser les composants/quantités ou disposer d’un vrai produit de mélange en stock. Ils ne sont pas assimilés arbitrairement à un seul composant.
- Les quantités absentes : gruyère « pour parsemer », beurre « pour la cuisson », eau, vin, persil, confiture et garniture facultative. Pour un produit géré en présence, activer ce mode ; pour un produit quantitatif, compléter la recette.
- **Crevettes au bacon** : le secours par instructions retrouve des noms mais pas leurs quantités fiables ; il faut compléter les ingrédients structurés, notamment l’ail en Gousse.
- **Popcorn de poulet au sesame** : la recette ne fournit pas d’ingrédients exploitables ; l’alerte dédiée reste nécessaire.
- Corriger les anciens stocks Ail/Pièce et vérifier les moyennes/choix initialisés dans Admin.

Le parcours de validation depuis Courses et la remontée des erreurs de persistance sont désormais implémentés. La prochaine étape est la validation en conditions réelles : SQL sur Supabase, build Next, foyer réel, retours Claude, génération puis mise à jour, achats/rangement/consommation et usage simultané.

## Tests et limites

**440 tests automatiques + 14 scénarios historiques passent.** Les tests couvrent notamment les 56 recettes via le lecteur Cookiwiki, les moyennes réversibles, l’ail interdit en Pièce, les achats entiers, une ancienne règle quantitative convertie, les liens de correction, les erreurs de persistance, l’isolation des inventaires et les UUID propres à chaque application. La syntaxe de 122 fichiers TS/TSX est vérifiée.

Les tests de DB/HTTP utilisent des doubles locaux. Le SQL n’a pas été exécuté sur ta DB distante, le service Claude réel n’a pas été sollicité et le build complet Next n’a pas été lancé dans cet environnement. Tester `npm run build` dans ton projet après installation. Les tests ne remplacent pas la vérification des paramètres dans Admin.

Pour les repères culinaires, les tables de portions officielles FDA donnent par exemple 148 g pour un oignon moyen et 78 g pour une carotte ; les valeurs initiales choisies ici sont arrondies à 150 et 80 g. Les autres formats sont des hypothèses de départ de l’application. Les 5 g/gousse sont le choix demandé ; Santé Canada donne aussi un calibre de 3 g, ce n’est donc pas une constante universelle.

Sources : [FDA — légumes](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/nutrition-information-raw-vegetables), [Santé Canada — ail](https://aliments-nutrition.canada.ca/cnf-fce/serving-portion?id=2394&lang=eng).
