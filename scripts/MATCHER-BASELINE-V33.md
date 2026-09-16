# Baseline Matcher V33 — résultat avant correction

Exécution locale de la batterie avec un stub des dépendances Supabase/Claude, afin de tester la logique réelle de `matcher.tsx` sans modifier la base.

## Résultat

- 13 tests exécutés
- 11 PASS
- 2 FAIL

## FAIL #1 — conversion volume → volume

Cas : `2 cs de Miel` vers `cc`.

Densités explicites :
- 1 cs Miel = 21 g
- 1 cc Miel = 7 g

Résultat mathématique attendu :
- 2 cs = 42 g
- 42 g = 6 cc
- 6 cc = 30 mL

Le moteur retourne actuellement `6 mL` au lieu de `30 mL`.

**Sévérité : CRITIQUE** pour les conversions culinaires.

## FAIL #2 — faux positif stock

Besoin : `Farine de blé`.

Stock disponible uniquement : `Farine de riz`, 1000 g.

Résultat attendu : stock de farine de blé = 0, donc achat de 500 g pour un besoin de 500 g.

Le moteur considère actuellement les 1000 g de farine de riz comme stock utilisable.

**Sévérité : CRITIQUE** : cela peut produire un achat insuffisant ou nul alors que le produit demandé n'est pas disponible.

## Conclusion

La batterie de tests remplit son rôle : elle a détecté deux défauts métier réels sur le chemin critique du Matcher.

**Mealio ne doit pas être considéré comme prêt pour la production tant que ces deux tests restent rouges.**

Ne pas supprimer ces tests après correction : ils deviennent des tests de non-régression permanents.
