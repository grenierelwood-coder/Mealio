# Mealio — Matcher Test Lab V33

## Objectif

Cette batterie vérifie le comportement métier du Matcher sans modifier sa logique par défaut.

Elle couvre :

- résolution exacte et par synonymes ;
- normalisation des lignes de recette ;
- redimensionnement par nombre de portions ;
- densités explicites du Miel ;
- interdiction des densités pour les ingrédients `presence` ;
- conversions interdites/transitives ;
- addition de plusieurs lignes Frosti/Cellio ;
- stock suffisant / insuffisant ;
- tests anti-faux-positifs ;
- présence-only ;
- agrégation de plusieurs recettes ;
- pipeline recette → besoin → stock → achat ;
- audit en lecture seule du référentiel réel.

## Pré-requis

Le projet doit disposer d'un runner TypeScript de développement, typiquement `tsx`.

Installer si nécessaire :

```bash
npm install -D tsx
```

## Tests purs

```bash
npx tsx --test scripts/matcher-contract.test.ts
```

Important : le test `pipeline complet` appelle volontairement le chemin production `analyzeRecipe()`, donc il nécessite un environnement Mealio/Supabase fonctionnel.

## Audit réel de la base

Lecture seule :

```bash
npx tsx scripts/matcher-db-audit.ts
```

Cet audit échoue notamment si :

- un ingrédient `presence` possède une densité ;
- une densité pointe vers un ingrédient inexistant ;
- une densité contient un poids nul/négatif/non numérique.

## Critère de passage avant production

1. Tous les tests automatiques passent.
2. L'audit réel de base retourne `PASS`.
3. Aucun faux positif critique du corpus n'est accepté.
4. Toute correction du Matcher doit repasser l'intégralité de la batterie.
5. Le corpus de tests doit être enrichi lorsqu'un nouveau cas réel est découvert.
