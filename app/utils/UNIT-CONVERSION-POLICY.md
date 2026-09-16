# Politique des conversions d'unités Mealio

- `unit_mappings` = conversions génériques d'unités.
- `ingredient_densities` = seules données métier pour les densités culinaires propres à un ingrédient.
- Une conversion entre deux unités culinaires propres à un ingrédient est dérivée à la volée uniquement si les deux unités possèdent une densité explicite.
- Exemple Miel : `cc -> g` et `cs -> g` permettent de calculer `cc <-> cs`.
- Aucune conversion transitive n'est générée.
- `ingredient_unit_conversions` et `ingredient_unit_bridges` ne doivent plus recevoir de nouvelles lignes applicatives.
