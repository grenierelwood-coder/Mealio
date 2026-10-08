# Correctif Mealio 1.2.25

Recopier les fichiers de cette archive dans Mealio en conservant les répertoires.
Aucun SQL à exécuter. Les dépendances restent identiques.

Corrections :
- Contextes du Matcher typés avec Set<string> dans les tests.
- Arguments de tests conformes aux signatures du moteur.
- Identifiant officiel conservé dans une variable stable pendant la conversion des réapprovisionnements.
- Route d’ajout aux courses utilisant Request, adaptée aux API effectivement utilisées.
- Vérification de production exécutant le CLI npm avec Node, sans shell intermédiaire sur Windows.

Validation effectuée : 605 tests automatisés, 14 scénarios laboratoire, tests d’interface, contrôles TypeScript ciblés des écrans et étendus aux tests et à leurs dépendances. Vérification du runner en succès et en échec.
Le build Next.js complet n’a pas été exécuté ici : les dépendances du projet ne sont pas installées dans cet environnement.

Relancer sur votre installation :

    npm run verify:production

Les quatre contrôles doivent réussir avant de valider la version pour le foyer KH.
Les journaux complets sont dans test-reports/preproduction-*.txt.
