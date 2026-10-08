# Mealio V1.2.2 — retour du test cassoulet

Copier les fichiers du projet en conservant votre .env.local. Redémarrer npm run dev et cliquer sur Mettre à jour mes courses : les anciennes alertes de génération sont remplacées par les nouvelles.

- Les besoins en unités différentes de la référence ne disparaissent plus de Courses. Une conversion explicite est utilisée lorsqu’elle est possible ; sinon le besoin est conservé dans l’unité de recette, avec une association officielle et un rangement automatique en attente.
- Aucun poids de saucisse ni rapport pièce/gousse n’est inventé. Ne pas modifier les unités de référence uniquement pour supprimer une erreur.
- Les explications différencient ingrédient inconnu, association proposée et unité inconnue. La consigne contradictoire « aucune action nécessaire » a été supprimée.
- 91 tests Node et 14 scénarios historiques réussis. Ces suites comportent des scénarios qui se recouvrent.
- Le build et les parcours Next/Supabase réels restent à vérifier sur votre installation. Les tests supplémentaires contrôlent la préparation des besoins et le pipeline du matcher avec des données locales ; ils ne démarrent pas le serveur Next ni les bases.

Pour farine de blé/riz : lancer npm test. Le test « farine de blé ne doit pas consommer farine de riz » utilise 500 g de besoin et uniquement 1000 g de farine de riz. Résultat attendu : stock utilisable 0 g, achat 500 g. Ce test ne modifie aucun stock réel.

Test sur le foyer réel : ouvrir Matcher, Tester un ingrédient ; saisir Farine de blé / 500 / g puis Lancer le test. Vérifier le détail du stock retenu : aucune farine de riz. Si le foyer possède aussi de la farine de blé, elle peut normalement couvrir tout ou partie des 500 g.
