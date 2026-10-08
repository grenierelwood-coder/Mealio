# Mealio 1.2.8 — Lieux précis et enrichissement des références

## Installation

1. Après 1.2.7, exécuter **sql/mealio_v1.2.8_reference_enrichment.sql** dans Supabase Mealio.
2. Copier les fichiers de cette archive dans le projet en conservant les répertoires.
3. Lancer `npm test`, puis redémarrer `npm run dev` et régénérer les courses.

Le deuxième SQL, `mealio_v1.2.8_apply_verified_measures.sql`, est **optionnel** : ne l’exécuter qu’après avoir renseigné des mesures/associations vérifiées dans la table de travail décrite ci-dessous. Aucun accès à vos bases en ligne n’a été utilisé pour préparer ces fichiers : l’enrichissement réel se fait lorsque vous exécutez le SQL.

## Lieux des stocks

Sous chaque ligne de Stock, Mealio affiche maintenant le nom du lieu précis transmis par l’API : « Frigo · Frigo cuisine », « Congélateur · Congélateur sous-sol », « Placard du couloir », etc. Le nom du lieu vient de Frosti `freezers.name` ou Cellio `cellars.name`. Les lieux sont filtrés sur les identifiants utilisateurs propres à chaque base, obtenus à partir du nom du foyer partagé.

Si l’emplacement n’existe pas ou n’est pas renseigné, l’écran affiche « Lieu non renseigné ». Aucun emplacement arbitraire n’est attribué. Les données étaient déjà récupérées par l’API ; cette version les affiche.

## Où apparaissent les propositions d’épicerie ?

- Produit nécessaire à une recette planifiée et absent : le format par défaut du foyer apparaît directement dans la **liste active de Courses**, après génération.
- Produit signalé « presque terminé » dans Stock : proposition dans **Courses → Réapprovisionnement détecté**.
- Produit avec un historique suffisamment régulier (au moins quatre jours d’achat distincts) : proposition dans le même bloc, à l’approche de l’échéance estimée.
- Une règle de seuil ou de récurrence peut également produire une proposition.

La simple présence d’un produit ne déclenche pas un achat. Un produit absent mais non demandé par une recette, sans règle et sans historique exploitable n’est pas automatiquement proposé. Les propositions déjà représentées dans la liste active sont masquées. Les signaux et historiques restent privés au foyer.

## Enrichissement immédiat

Le premier SQL est réexécutable et conserve les données déjà présentes :

- **75 alias proposés**, notamment oeuf/œufs, jaunes d’œufs, amandes en poudre, fromages râpés identifiés, légumes au pluriel, préparations du beurre et libellés explicites.
- **Six unités de comptage** manquantes : Bouteille, Bouquet, Tête, Grain, Tour, Poignée. Elles conservent leur identité ; une bouteille n’a pas de contenance implicite et une poignée n’a pas de poids universel.
- Une équivalence poids/Millilitre est ajoutée uniquement lorsque les densités déjà présentes par cuillère à soupe et à café sont cohérentes avec les volumes configurés de 15 et 5 mL. La provenance est notée dans `ingredient_densities.source_note`. C’est une approximation dérivée, pas une nouvelle mesure physique. Les valeurs existantes sont préservées.
- **206 demandes à compléter**, issues de la campagne, sont initialisées dans `reference_enrichment_review`. Les cibles absentes ou les conflits rencontrés sur votre base peuvent ajouter d’autres lignes.

Les synonymes ne sont ajoutés que si la cible officielle existe, sans remplacer une association existante. Si une cible manque ou qu’un rapprochement est ambigu, elle reste à vérifier. Le SQL ne crée pas d’ingrédients avec une unité ou un rangement devinés et ne modifie pas les unités de référence actuelles.

Le moteur accepte également « c. à soupe », « c. à café », branche/brin et morceaux/morceau comme variantes linguistiques. Cela ne crée aucune conversion de pièce en grammes.

## Mesures et associations à compléter

Dans Supabase Mealio → `reference_enrichment_review` :

| Champ | Utilisation |
|---|---|
| kind | alias, unit_mass, unit_definition, compound ou recipe_quantity |
| source_label | Libellé à examiner |
| ingredient_name | Nom exact de l’ingrédient officiel cible |
| unite | Unité reconnue de la mesure |
| value | Pour unit_mass : grammes pour **1 unité** |
| measurement_note | Méthode/source et format du produit mesuré |
| status | pending tant que non renseigné ; verified après vérification |

Les densités de référence sont partagées entre foyers. Ne pas y encoder le format particulier d’un paquet ou d’une saucisse d’un seul foyer ; pour un produit variable, préciser le besoin en grammes dans Cookiwiki.

Pour une ligne `unit_mass`, renseigner une valeur positive, l’unité exacte, la cible officielle et une note de mesure. Puis exécuter le SQL optionnel d’activation. Par exemple, pour Oignon / Pièce, peser la partie consommable du format réellement utilisé. Si les tailles varient, il est préférable d’indiquer des grammes dans Cookiwiki plutôt que d’imposer un poids universel par oignon.

Pour une ligne `alias`, choisir explicitement la cible officielle puis passer à verified. Le SQL optionnel ajoute l’association sans écraser l’existant. Les lignes compound, recipe_quantity et unit_definition ne sont jamais activées comme des équivalences automatiques : elles demandent une correction de recette, une distinction de produit ou une définition du conditionnement.

Les recettes composées, alternatives, variétés et différences frais/sec, fumé/non fumé, cru/cuit restent à vérifier. « Farine » n’est pas forcée vers farine de blé ; « lait » n’est pas forcé vers demi-écrémé ; un mélange n’est pas réduit à un ingrédient unique. Les poids de sachets, rouleaux, morceaux et bouteilles ne sont pas inventés. Une nouvelle valeur contradictoire doit être corrigée explicitement dans Admin avant activation.

## Tes trois alertes actuelles

**Ail** : le besoin en Gousse fonctionne ; le stock est en Pièce. Si les lignes représentent réellement des gousses, corriger leur unité dans Cellio en Gousse. Si elles représentent des têtes, compter les gousses disponibles. Aucune relation universelle « une tête = X gousses » n’est introduite.

**Oignon** : le lot peut associer « Oignons frais » à la cible générique Oignon si elle existe. Un stock de 100 g ne couvrira néanmoins pas un besoin en Pièce sans une masse par pièce vérifiée. L’association et la conversion sont deux opérations distinctes.

**Saucisses** : valider l’alternative vers Saucisse fraîche dans le Matcher. Pour déduire un stock de 870 g d’un besoin en quatre pièces, il faut connaître le poids du format ou saisir le besoin de recette en grammes. Le seul poids du paquet ne révèle pas le nombre de saucisses.

## Résultats de tests

**363 tests automatiques et 14 scénarios historiques passent.** Les 56 recettes sont également rejouées avant/après enrichissement. Sur l’ancien export fourni de 344 ingrédients, 66 alias sont insérables ; 170 lignes sont résolues avant enrichissement et 232 après. Le résultat sur votre base actuelle peut différer selon les ajouts et validations déjà effectués.

Les rapports `test-reports/cookiwiki-enrichment.md` et `.json` détaillent les résultats par recette et les conversions restantes. La campagne utilise les modules de production avec des doublures Supabase et une IA en abstention ; elle ne valide pas les réponses Claude ni le stock réel. La compilation Next complète et l’exécution PostgreSQL restent à vérifier localement.
