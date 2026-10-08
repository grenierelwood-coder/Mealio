# Mealio 1.2.7 — Presque terminé, historique et campagne Cookiwiki

## Installation

1. Après le correctif 1.2.6, exécuter `sql/mealio_v1.2.7_pantry_signals.sql` dans le SQL Editor du projet Supabase **Mealio**.
2. Copier les fichiers de cette archive dans le projet en conservant leurs répertoires.
3. Lancer `npm test`, puis redémarrer `npm run dev`.

La migration ajoute une table privée `household_pantry_signals` un index de lecture de l’historique existant et une fonction SQL réservée aux routes serveur pour ajouter les alertes aux courses dans une transaction. Elle ne modifie aucun stock Frosti/Cellio, aucune recette Cookiwiki et aucun mode de suivi. Les foyers continuent à être liés par leur nom partagé, pas par les UUID des utilisateurs des autres bases.

## Bouton « presque terminé »

Dans **Stock**, les produits présents associés exactement (ou par un synonyme explicite) à un ingrédient géré en présence disposent du bouton. Le signal concerne le produit du foyer, donc toutes ses lignes de stock affichent le même état. Penser aux réserves avant de signaler un produit.

Le bouton peut être annulé dans Stock. Dans Courses, le signal produit une proposition d’achat au format du foyer. On peut ajouter cette proposition ou annuler le signal. Ajouter aux courses ne met pas le stock à zéro et n’acquitte pas le signal. Un achat de cet ingrédient enregistré dans l’historique après le signal l’acquitte automatiquement à la prochaine lecture. Les achats faits hors Mealio nécessitent une annulation manuelle du signal.

Les propositions déjà représentées dans la liste active sont masquées. Les ajouts d’alertes sont sérialisés par foyer dans la fonction SQL : deux clics simultanés sur une alerte n’ajoutent pas deux lignes ni deux formats. Une ligne déjà présente conserve sa quantité.

## Apprentissage du rythme des achats

Pour chaque produit géré en présence, le serveur lit les achats positifs enregistrés uniquement dans les listes du foyer connecté. Il regroupe les achats du même jour en Europe/Paris : acheter trois paquets le même jour constitue une observation temporelle, pas trois cycles de consommation.

Une proposition nécessite au moins quatre jours d’achat distincts, soit trois intervalles observés. Le moteur utilise jusqu’aux sept derniers jours d’achat et l’intervalle médian. Il s’abstient lorsque l’intervalle médian est inférieur à trois jours ou que les intervalles sont trop irréguliers (maximum supérieur à trois fois le minimum). Les achats invalides, annulés et futurs sont ignorés.

Une alerte arrive environ 20 % de l’intervalle avant l’échéance estimée, entre un et sept jours à l’avance. Elle affiche le nombre d’observations, l’intervalle et l’échéance. On peut la reporter de **sept jours**. Ce report ne masque pas un signal manuel « presque terminé ». Un mode quantitatif désactive ces propositions pour le produit concerné. Les propositions historiques restent toujours à valider, même si des règles systématiques existent pour d’autres produits.

Il s’agit d’une estimation de la fréquence d’achat, pas d’une consommation mesurée ni d’une quantité restante. Des achats pour constituer des réserves peuvent fausser la prévision. Aucun retrait de stock n’est effectué par ce mécanisme. Les alertes sont affichées dans l’application Courses ; aucun envoi push, email ou tâche en arrière-plan n’est ajouté.

## Campagne sur les 56 recettes fournies

Les fixtures conservent les ingrédients et instructions réels des 56 recettes. Le lecteur Cookiwiki de production est exécuté avec des réponses Supabase locales. Le référentiel de test reste le précédent export fourni : **344 ingrédients**, 41 unités, 10 synonymes et 29 densités. Il ne représente pas nécessairement les enrichissements plus récents de votre base.

Chaque recette passe huit scénarios : stock vide, stock suffisant, demi-stock, stock incompatible, portions ×2, préparation/conservation des courses, unité impossible et stock zéro. Un test du générateur vérifie également qu’une recette sans ingrédients produit une alerte visible.

Résultat : **233 tests automatiques passent**, comprenant les 56 cas de recettes et leurs **448 scénarios**, puis **14 scénarios historiques**. Les contrôles de syntaxe TS/TSX passent. Les scénarios des recettes sans ingrédients vérifient une absence de besoins ; ils ne valident pas le contenu culinaire manquant.

Rapports générés et renouvelés par `npm test` :

- `test-reports/cookiwiki-56-campaign.md` : détail lisible par recette.
- `test-reports/cookiwiki-56-campaign.json` : données structurées du diagnostic.

Sur l’ancien référentiel, le moteur résout automatiquement 167 lignes parmi 465 lignes parsées (455 lignes structurées, deux séparations sel/poivre, huit lignes récupérées depuis les instructions). Les autres nécessitent une association, une unité ou une quantité à préciser. Le rapport relève 35 lignes de quantité inconnue et 55 besoins exigeant une conversion explicite vers l’unité de référence. Ces catégories peuvent se recouper. Un test vert signifie que le moteur conserve les besoins et refuse les déductions non justifiées, pas que toutes les données sont complètes.

Deux recettes nécessitent notamment une correction dans Cookiwiki :

- **Crevettes au bacon** : liste structurée vide ; huit ingrédients récupérés dans les instructions. Leurs quantités ne sont pas inventées.
- **Popcorn de poulet au sesame** : liste structurée vide et aucun ingrédient exploitable par le secours actuel. Courses affiche maintenant un avertissement, au lieu de passer silencieusement ce repas.

Aucune requête réseau vers Claude ou vos bases n’a été faite : l’IA est simulée en abstention. La qualité des réponses Claude et la couverture sur le stock réel ne sont pas certifiées par cette campagne. Une compilation Next complète et l’exécution des migrations sur votre Supabase restent à vérifier localement.

## Vérification pratique

1. Dans Administration → Épicerie, activer le mode présence pour un produit du foyer, avec son format habituel.
2. Dans Stock, cliquer « presque terminé » ; vérifier la proposition dans Courses, puis l’annuler et vérifier sa disparition.
3. Signaler à nouveau, ajouter aux courses, acheter puis ranger : le signal doit être acquitté à la prochaine lecture.
4. Vérifier qu’un autre foyer ne voit aucun signal ou historique du premier.
5. Les produits ayant au moins quatre achats espacés peuvent afficher une proposition historique ; tester son report de sept jours.
6. Planifier Popcorn de poulet au sesame : une alerte doit demander de compléter les ingrédients dans Cookiwiki.
