# Mealio V1.1 — PACK COMPLET DE TESTS

Ce pack est construit à partir du code réellement présent dans `app_V1.1.zip`.

IMPORTANT :
- Il ne faut PAS copier les fichiers de test dans `app/`.
- Copiez le dossier `tests/mealio-v1.1/` dans la racine de votre projet Mealio.
- Les tests purs importent `app/utils/matcher.tsx`.
- Les campagnes HTTP utilisent les routes réellement présentes dans V1.1.
- Les campagnes 4 et 5 modifient les données réelles : elles sont désactivées par défaut.
- Aucun test ne demande de modifier une unité existante.

## Installation

Depuis la racine du projet :

```powershell
npm install -D vitest
```

Si npm demande :

```text
Need to install the following packages:
vitest@...
Ok to proceed? (y)
```

répondre `y`.

## Installation du pack

Dézippez puis copiez :

```text
tests/
  mealio-v1.1/
```

dans la racine du projet, à côté de `app/`.

Vous devez donc avoir :

```text
C:\Techtune\Devt\Courses\mealio\
  app\
  tests\
    mealio-v1.1\
  package.json
  ...
```

## Configuration

Le pack ne suppose pas de `vitest.config.ts` existant.

Les tests purs peuvent être lancés directement :

```powershell
npx vitest run tests/mealio-v1.1/02_aggregation_unit_safety.test.ts
npx vitest run tests/mealio-v1.1/03_stock_multiline.test.ts
```

Ou :

```powershell
.\tests\mealio-v1.1\RUN_TESTS.cmd
```

## Tests HTTP

Pour les campagnes 1, 4, 5 et 6 :

```powershell
$env:MEALIO_BASE_URL="http://localhost:3000"
$env:MEALIO_COOKIE="congelo_username=VOTRE_UTILISATEUR"
```

Si votre authentification utilise d'autres cookies, ajoutez-les dans `MEALIO_COOKIE`.

NE PARTAGEZ JAMAIS votre cookie de session.

## Ordre recommandé

### Phase 1 — zéro modification de données

```powershell
.\tests\mealio-v1.1\RUN_TESTS.cmd
```

Cela lance :
- Campagne 1 — Matcher Lab
- Campagne 2 — Agrégation / unités
- Campagne 3 — stock multi-lignes
- Campagne 6 — réapprovisionnement en lecture + contrôles d'unité

### Phase 2 — intégration Courses

Après validation de la phase 1 :

```powershell
.\tests\mealio-v1.1\RUN_TESTS.cmd -IntegrationCourses
```

### Phase 3 — consommation

Après validation de la phase 2 :

```powershell
.\tests\mealio-v1.1\RUN_TESTS.cmd -IntegrationConsumption
```

La campagne 5 demande une confirmation `OUI` avant de modifier réellement un stock.

## Lecture des résultats

- PASS = comportement conforme
- FAIL = comportement non conforme ou régression
- SKIP = précondition absente / test non applicable
- ERROR = problème technique du test ou de l'environnement

## Point critique volontairement testé

La V1.1 contient actuellement :

```text
aggregateRequirements()
clé = ingredient_id + quantity_mode
```

et non l'unité.

Le test 02 vérifie donc :

```text
500 g + 300 g = 800 g       PASS
500 g + 2 pièces            REFUS / séparation attendus
```

Le second cas est le test de régression le plus important de ce pack.

Le problème n'est PAS une modification d'unité par l'utilisateur : deux recettes peuvent fournir naturellement deux unités différentes pour le même ingrédient officiel.

## Ce que les campagnes couvrent

1. Matcher : résolution, unité de référence, refus des entrées invalides.
2. Agrégation : addition correcte et absence d'addition inter-unités.
3. Stocks : plusieurs lignes, Frosti + Cellio, conversion et incompatibilité.
4. Courses : génération, régénération, doublons.
5. Consommation : consommation, double appel/idempotence.
6. Réapprovisionnement : seuils, récurrents, verrouillage d'unité, doublons de suggestions.
