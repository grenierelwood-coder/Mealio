# Livraison complète — 10 octobre 2026

Frosti **V1.3.1**, Cellio **V1.2.1**, Mealio **V1.3.1**. Les dossiers sont des projets complets. Cette livraison conserve les fonctionnalités précédentes et complète leur intégration. Aucun suivi d'ouverture de contenant n'est ajouté.

## Fonctionnalités

| Sujet | Comportement livré |
|---|---|
| Équipements | Création, suppression protégée lorsqu'un stock ou une règle utilise le lieu ; ajout accessible en haut et en bas ; transferts internes individuels ou groupés, fusion uniquement des lots strictement identiques. |
| Notifications et dates | Paramètres Ntfy et test ; durées par catégorie ; dates estimées appliquées aussi aux ajouts serveur de Mealio ; alertes d'ancienneté sans date. Une estimation n'est pas une DLC officielle. |
| Identité et quantité | Référentiel officiel Mealio, association facultative des anciens lots, contenu par unité (4 pots × 250 mL = 1 000 mL), conversions explicites, seuils de réapprovisionnement calculés sur le contenu. Aucun rendement ou densité deviné depuis un nom. |
| Dates et priorité | Nature aliment/boisson/vin, origine acheté/fait maison, rôle DLC/DDM/indicatif/apogée/inconnu. Priorité aux dates de consommation, puis à l'entrée ; les dates anciennes non qualifiées restent visibles à vérifier. Les apogées et vins ne pilotent pas la consommation alimentaire. |
| Transferts entre apps | Mealio → Écosystème : sélection, quantités partielles, destination, récapitulatif et confirmation. Métadonnées et conditionnements conservés ; chaque base possède son reçu d'opération. |
| Préparations maison | Ingrédients réellement utilisés, lots réellement produits dans plusieurs lieux, recette facultative, date de fabrication, portions par unité et lien facultatif à un repas planifié. Le rendement est confirmé par l'utilisateur. |
| Planning et courses | Les portions déjà préparées réduisent les ingrédients à acheter. Une même portion n'est pas affectée à deux repas de la période. La confirmation du repas consomme d'abord les portions préparées ; un repas explicitement lié ne redéduit pas les ingrédients de fabrication. |
| Rangement et reprise | Une réservation d'achat conserve sa quantité, sa destination et son payload. Seules les étapes confirmées comptent comme rangées. Reprise par le même identifiant, suivi des étapes terminées et verrou temporaire contre deux reprises simultanées. |
| Réparation | Une destination encore non exécutée peut être corrigée dans la même app. Une étape déjà écrite, la quantité et le stock source ne sont pas réécrits silencieusement. |
| Sécurité | Sessions signées avec secret dédié ; contrôle du foyer et du mot de passe courant ; clés privilégiées côté serveur ; RPC atomiques, versions contre écrasement et droits serveur dans les migrations. |

## Anomalie de démarrage Mealio corrigée

Le rappel **Repas passé** est accessible au lancement et par **Repas passés** dans la navigation, y compris sur mobile. Une recette absente affiche une explication. **Non** ne dépend pas de Cookiwiki et ne modifie aucun stock. **Oui** propose les quantités avant confirmation. **Plus tard** ferme immédiatement la fenêtre même si une requête est bloquée et diffère le rappel pour la journée dans cette session ; le menu permet de le rouvrir. Délai réseau maximal de 15 secondes pour le rappel. Les statistiques des repas passés ne déduisent toujours aucun stock automatiquement.

## Installation et migrations — ordre impératif

Sauvegarder les bases et les dossiers, arrêter les serveurs. Conserver `.env.local`, `.git` et les paramètres Vercel. Copier les sources complètes sans conserver les anciens fichiers de code supprimés ; ne pas copier `node_modules` ou `.next` d'une ancienne version.

| Base / version actuelle | SQL à appliquer dans cette base, dans cet ordre |
|---|---|
| Frosti V1.2 | `migrations/006_frosti_v1_3.sql`, puis `migrations/007_frosti_v1_3_1.sql` |
| Frosti V1.3 | Seulement `migrations/007_frosti_v1_3_1.sql` |
| Cellio V1.1 | `migrations/004_cellio_v1_2.sql`, puis `migrations/005_cellio_v1_2_1.sql` |
| Cellio V1.2 | Seulement `migrations/005_cellio_v1_2_1.sql` |
| Mealio V1.2.28 | `migrations/001_mealio_v1_3_ecosystem.sql`, puis `migrations/002_mealio_v1_3_1.sql` |
| Mealio V1.3 | Seulement `migrations/002_mealio_v1_3_1.sql` |

Frosti suppose ses migrations 001, 004 et 005 déjà appliquées ; Cellio sa migration 001 de V1.1. Pour une version plus ancienne, lire `INSTALLATION_HISTORIQUE.md` dans l'app correspondante avant cette table. Mealio suppose le schéma existant de V1.2.28. **Ne pas rejouer en bloc les anciens scripts `sql/`, ni une ancienne migration de fonctions après la nouvelle. Ne pas importer les fixtures de tests.**

La migration Mealio crée des index uniques : si elle échoue sur des doublons historiques, sa transaction est annulée. Examiner les lignes concernées avant de la relancer ; ne pas supprimer des historiques au hasard. Aucun script ne purge les stocks.

Migrer et vérifier **Frosti et Cellio en premier**, puis déployer ces sources ; migrer et vérifier Mealio ensuite, puis le déployer. Les SQL ne sont pas exécutés automatiquement par le `.bat`.

## Configuration

Conserver toutes les variables existantes des exemples `.env.example` (Supabase, session, cron, notifications et éventuelles fonctions Claude). Les clés serveur ne doivent jamais avoir le préfixe `NEXT_PUBLIC_`.

Mealio exige désormais **MEALIO_SESSION_SECRET d'au moins 32 caractères**, distinct des clés Supabase. Ajouter le même secret dans `.env.local` et dans Vercel pour les environnements utilisés, puis redéployer. Les anciens cookies ne sont plus valides : **se reconnecter après la mise à jour**. Un changement du mot de passe du foyer invalide également les sessions.

Pour importer les ingrédients dans Frosti et Cellio, ajouter côté serveur à chacune :

```dotenv
MEALIO_SUPABASE_URL=https://votre-projet-mealio.supabase.co
MEALIO_SUPABASE_SERVICE_ROLE_KEY=cle_serveur_du_projet_mealio
```

Ces variables sont facultatives pour les stocks libres. Dans Réglages → Référentiel des ingrédients → Importer / actualiser, charger le miroir. Aucun ancien lot n'est associé automatiquement. Les UUID restent propres à chaque base pour les foyers ; le même username permet leur résolution. L'UUID de l'ingrédient est celui de Mealio. Les mots de passe existants ne sont pas migrés vers un nouveau système d'authentification dans cette livraison.

## Vérification locale

Dans chaque projet : `npm ci`, puis `npm run verify` pour Frosti/Cellio ou `npm run verify:production` pour Mealio. Le build Mealio exige ses variables serveur. Le fichier racine `INSTALLER_ET_VERIFIER.bat` installe et vérifie les trois projets ; il s'arrête à la première erreur et ne déploie rien. Après les contrôles, lancer `npm run dev` dans l'app souhaitée. Pour ouvrir plusieurs apps en parallèle, attribuer des ports distincts, par exemple `npm run dev -- --port 3001`.

Recette navigateur : `npx playwright install chromium --only-shell`, puis `node scripts/check-ui.mjs` dans les apps source ; dans Mealio `npm run test:ecosystem:ui` et `npm run test:meal-prompt:ui`. Ces scénarios utilisent des données simulées et ne touchent pas vos stocks.

## Reprise : limites exactes

Il n'existe **aucune transaction ni annulation globale entre les bases**. Un journal Mealio fige les actions et chaque base écrit atomiquement ses propres étapes. Après une interruption utiliser **Reprendre l'opération**, sans en créer une seconde identique. Une réponse perdue est reconnue par son reçu. Le verrou de reprise expire après deux minutes si le processus disparaît.

Un changement concurrent du stock peut bloquer une étape. Vérifier l'inventaire et l'historique avant une correction ; aucune compensation multi-base automatique n'est effectuée. Les opérations coordonnées ne sont pas annulables isolément dans une app source. Une correction d'inventaire reste possible. Les anciennes consommations `processing` sans journal et anciens rangements interrompus reposant seulement sur les notes doivent être rapprochés manuellement de l'inventaire si leur résultat est incertain. Les garanties de reprise de nouveaux reçus ne reconstituent pas un historique absent.

RLS et droits SQL protègent l'accès public ; une clé service contourne RLS. Les vérifications de foyer et contraintes SQL restent donc nécessaires et font partie du contrat. Les migrations doivent être réellement appliquées dans chaque base pour activer ces droits.

## Validation effectuée

- Frosti : **7 tests**, typage, lint, build.
- Cellio : **9 tests**, typage, lint, build.
- Mealio : **638 tests**, Matcher **14 cas**, rendu, typage et build.
- PostgreSQL embarqué : migrations, transferts/fusion, métadonnées de préparation, versions, reçus, réservation d'achat et verrous de reprise. Deux bases distinctes et une réponse perdue sont simulées sans double écriture.
- Chromium : parcours Écosystème à 320/375/390/1024 px ; rappel repas sur mobile, recette absente, Non, fermeture pendant requête bloquée et report après navigation.

Aucune migration distante ni aucun déploiement Vercel effectué. La validation locale ne remplace pas la recette de vos données réelles.

## Recette sur votre installation

1. Vérifier la connexion et la version de chaque app, les équipements et le test Ntfy.
2. Déclarer 4 pots de 250 mL et vérifier 1 000 mL dans Mealio, les courses et le réapprovisionnement.
3. Transférer une partie vers un lot identique : addition ; avec une date ou un conditionnement différent : lot distinct.
4. Modifier un même lot dans deux sessions : la version obsolète doit être refusée.
5. Fabriquer plusieurs portions liées à un repas, vérifier que les courses et la consommation ne redéduisent pas les ingrédients.
6. Vérifier une interruption puis reprendre la même opération ; consulter les étapes réellement terminées.
7. Vérifier Repas passés avec une recette absente, Non et Plus tard. Confirmer deux fois un repas doit produire un seul mouvement.
