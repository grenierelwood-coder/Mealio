# Mealio 1.2.13

Ce ZIP complète la version 1.2.12 et ne contient que les fichiers nouveaux ou modifiés, avec leurs répertoires. Copier à la racine de Mealio puis redémarrer `npm run dev`. En production, refaire `npm run build` avant `npm start`. Aucun nouveau SQL à exécuter pour cette version ; les migrations précédentes restent nécessaires.

## Association Saucisse / Saucisses

Un synonyme enregistré était utilisé pour filtrer les candidats compatibles, mais le rapprochement pouvait ensuite passer par le score lexical ou une ancienne proposition IA. Une identité officielle ou un synonyme enregistré est désormais retenu avant cette ancienne mémoire, sans nouvel appel Claude. Le singulier/pluriel Saucisse/Saucisses est déjà normalisé.

Régénérer les courses après installation. Ne pas réenregistrer une association déjà présente dans Admin → Ingrédients → Saucisse fraîche → Synonymes / correspondances. Les exclusions explicites et les identités officielles contradictoires restent respectées. Une unité incompatible peut toujours déclencher une alerte distincte : une association ne définit pas un poids.

Le test ajouté reproduit 4 saucisses fraîches, un stock « Saucisses » de 870 g, le synonyme validé et une ancienne mémoire IA en attente. Avec 120 g/Pièce, le stock couvre le besoin sans validation IA. Le test vérifie aussi qu’une exclusion reste respectée.

## Inventaire : chercher dans tous les lieux

« Tous les lieux · Frosti et Cellio » est sélectionné au départ. Rechercher le nom du produit ; chaque ligne affiche sa source et son lieu précis. Corriger quantité et unité puis valider. Un lieu particulier peut toujours être sélectionné pour faire son inventaire.

La validation enregistre toutes les corrections du périmètre sélectionné, y compris celles masquées ensuite par la recherche ; le compteur le précise. Changer le périmètre ou actualiser abandonne les corrections non enregistrées. Les écritures sont séparées par source et lieu, avec vérification des anciennes quantité/unité. Si un lieu échoue après un autre déjà enregistré, le message indique les corrections déjà réalisées et recharge le stock. Les corrections restantes sont alors à ressaisir.

Quantités et unités sont écrites directement dans la DB Frosti ou Cellio du foyer connecté. Il ne s’agit pas d’une copie locale Mealio. Pour l’ail, une tête ne vaut pas une gousse ; compter les gousses avant de corriger les anciennes pièces.

## Ouvrir Frosti ou Cellio

Les liens de l’Inventaire ouvrent un nouvel onglet et conservent Mealio ouvert. Ils apparaissent seulement si l’adresse de l’application a été configurée. Aucun chemin de fiche n’est supposé : les routes réelles des deux apps ne sont pas disponibles dans ce projet.

Variables facultatives à ajouter dans `.env.local` :

- `NEXT_PUBLIC_FROSTI_APP_URL` : adresse de l’application Frosti.
- `NEXT_PUBLIC_CELLIO_APP_URL` : adresse de l’application Cellio.
- `NEXT_PUBLIC_FROSTI_STOCK_PATH` : chemin réel de fiche, contenant `{id}` et éventuellement `{location_id}`.
- `NEXT_PUBLIC_CELLIO_STOCK_PATH` : même principe pour Cellio.

Sans chemin de fiche, le bouton ouvre simplement l’application. Les identifiants sont encodés et le lien doit rester sur l’origine configurée. Ne pas réutiliser `NEXT_PUBLIC_FROSTI_URL` / `NEXT_PUBLIC_CELLIO_URL` : ces variables existantes désignent Supabase. Redémarrer/recompiler après une modification des variables publiques. Après une correction dans l’autre app, revenir à Mealio et cliquer « Actualiser après une correction dans Frosti ou Cellio ».

Pour configurer les fiches exactes, relever dans chaque app l’URL affichée lorsque la fiche d’un produit est ouverte. Si l’app ne possède aucune route de fiche, il faudra en ajouter une dans cette app ; Mealio ne peut pas inventer cette navigation.

## Correction des recettes

Admin → Correction des recettes : choisir une recette. Un panneau « Comment corriger une recette ? » décrit les opérations.

- Quantités : elles concernent les portions de base de la recette. Le planning ajuste ensuite le besoin aux portions prévues.
- Estimation : vérifier le chiffre proposé, le modifier si nécessaire, puis décocher « Estimation » une fois vérifié. Décocher ne vérifie pas automatiquement la valeur.
- Alternatives : choisir une seule branche, par exemple l’un des deux ingrédients d’un libellé « X ou Y ». Seule la branche sélectionnée entre dans les courses.
- Mélanges : renseigner chaque composant avec sa propre quantité, par exemple 125 g d’olives noires et 125 g d’olives vertes. Le parent n’ajoute pas de quantité.
- Facultatif : cocher « Inclure » pour le prendre en compte ; « Hors courses » l’exclut.
- Enregistrer puis régénérer les courses. Ces corrections Cookiwiki sont communes aux foyers ; les règles épicerie restent propres à chacun.

« Quantité absente » signifie qu’un ingrédient est cité sans quantité exploitable, comme beurre pour cuire ou gruyère pour parsemer. Mealio propose une estimation identifiée, à vérifier ; ce n’est pas une quantité retrouvée dans la recette originale.

« Recette incomplète » signifie que les données structurées d’ingrédients sont vides/inexploitables alors que le texte de préparation cite des ingrédients. Les propositions pour Crevettes au bacon et Popcorn de poulet au sesame reconstituent ces listes, avec des estimations à vérifier. Si le SQL 1.2.12 a conservé une recette modifiée depuis l’export (SKIPPED), charger la proposition dans cet écran, vérifier puis enregistrer. Charger seul n’écrit pas en DB.

## Lancer les tests d’intégration

Admin → Campagne d’intégration, premier bloc :

1. Choisir une recette dans « Recette à analyser » puis cliquer « Tester la recette sélectionnée ».
2. Ou cliquer « Tester toutes les recettes » pour la campagne complète.
3. « Rejouer chaque recette » compare deux passages. Consulter les résultats, les liens vers les recettes et télécharger le rapport.

L’analyse utilise recettes, référentiel et stocks réels du foyer connecté. Elle ne modifie pas les courses ni les stocks ; elle peut appeler Claude et écrire ses propositions/mémoires. Le budget Claude est indicatif et peut arrêter la campagne avant la dernière recette ; il est vérifié entre les requêtes, pas pendant un appel.

Le second bloc est différent : le cycle complet crée planning, achats et stocks, puis consomme un repas. Il exige un foyer vide dont le username termine par `-test` ou `_test`, avec lieux et rangement configurés. Son bouton reste désactivé sur le foyer habituel. Ce n’est pas nécessaire pour analyser une recette ou toutes les recettes.

## Vérification effectuée

512 tests locaux et les 14 cas historiques du laboratoire passent. Les écrans réels ont aussi été exercés avec des données/HTTP simulés : recherche dans deux sources et lieux, sauvegardes séparées, analyse de la recette sélectionnée, analyse globale et verrou du cycle sur un foyer normal. Les liens sources sont testés sur l’encodage, l’origine et l’absence de configuration. Contrôles de typage ciblés sans erreur.

Ces vérifications ne remplacent pas une campagne sur ta DB : pas d’accès à ton Supabase ou à Claude réel ici, ni de build Next complet. Pour rejouer localement : `npm test` et `npm run test:ui` après installation des dépendances.
