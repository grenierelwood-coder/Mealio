# Mealio 1.2.17 — corriger depuis Courses

Complète la 1.2.16. Copier les fichiers fournis, répertoires conservés, redémarrer `npm run dev`, puis Ctrl+F5. En production, refaire `npm run build`. Aucun SQL supplémentaire. La version du bandeau devient automatiquement v1.2.17.

## Parcours

- Une synthèse repliée indique le nombre de produits à vérifier. Déplier pour voir une entrée par produit, sans répéter toutes les explications.
- Sur la ligne d’un produit, « À vérifier » ou « Voir le point à corriger » ouvre le même panneau dans Courses.
- Si plusieurs points concernent ce produit, choisir le point à traiter. Les problèmes de recettes distinctes restent conservés ; seuls les doublons de présentation sont masqués.
- Association : le libellé de recette ou de stock et la proposition officielle sont préremplis lorsqu’identifiables. Vérifier puis « Enregistrer et recalculer les courses ».
- Poids moyen : choisir l’ingrédient et l’unité, renseigner combien pèse 1 unité en grammes. Une valeur existante est préremplie. Exemple : 1 Pièce de Saucisse fraîche = 120 g. Les valeurs existantes sont modifiées par l’API Admin habituelle, pas par une nouvelle table.

Le recalcul conserve le choix d’inclure ou non la semaine suivante. Il ne change pas manuellement le statut d’une alerte : le moteur réévalue les données. D’autres problèmes du produit peuvent donc rester à traiter.

Si l’association est déjà liée à un autre ingrédient, le serveur refuse l’écriture et le panneau affiche l’erreur. Si l’enregistrement réussit mais le recalcul échoue, la correction est conservée ; le bouton devient « Recalculer les courses » et ne réenregistre pas la correction.

## Cas dirigés vers leur écran

- Ail en Pièce : lien vers l’Inventaire, déjà filtré sur Ail. Compter les gousses réelles ; une moyenne ne transforme pas automatiquement une tête en gousse.
- Quantité estimée, quantité absente ou choix de recette : lien vers la correction de cette recette.
- Unité inconnue ou autre réglage non traité par un poids moyen : lien vers Admin.
- Rangement : lien vers Articles à ranger.

Les associations et poids restent communs aux foyers, comme le référentiel existant. Le mode présence reste propre au foyer. Aucun besoin ni stock ambigu n’est forcé à correspondre par la présentation.

## Test conseillé sur KH

1. Régénérer les courses.
2. Ouvrir une alerte d’association et vérifier que les libellés proposés correspondent au problème.
3. Enregistrer et recalculer ; vérifier la quantité à acheter et les éventuels points restants.
4. Tester un poids moyen approprié, sans convertir les anciennes pièces d’ail.
5. Admin → Intégration → Tester toutes les recettes, puis Télécharger le rapport. Si le budget Claude arrête la campagne, le rapport précise les résultats obtenus ; ajuster le budget selon les appels acceptables.

La campagne réelle ne requiert pas KH-test. Le cycle technique complet reste séparé et facultatif. Transmettre le rapport JSON permettra de poursuivre à partir des anomalies réelles.

## Vérification

580 tests locaux et 14 cas historiques passent. Tests des écrans réels avec React/HTTP simulés : association stock préremplie, conversion 120 g, conflit refusé sans recalcul, recalcul échoué puis reprise sans double enregistrement, protection de l’ail en Pièce. Typage ciblé, incluant Courses et le nouveau panneau, sans erreur.

Pas d’accès à ton Supabase actuel, d’appel Claude réel ou de build Next complet ici. Les routes de sauvegarde existantes sont réutilisées ; aucun schéma DB modifié.
