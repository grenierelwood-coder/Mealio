MEALIO — LANCER LES TESTS DU MATCHER
====================================

METHODE LA PLUS SIMPLE SOUS WINDOWS
------------------------------------

1. Décompresser cette archive dans le dossier racine de Mealio.
2. Double-cliquer sur :

   scripts\run-matcher-lab.cmd

3. Attendre la fin.
4. Ouvrir le fichier TXT créé dans :

   test-reports\matcher-lab-....txt

Le fichier TXT est le document à transmettre pour analyse.

IMPORTANT
---------
Cette batterie utilise des données de test locales.
Elle ne modifie pas Supabase et ne nécessite pas les clés Claude.
Des valeurs Supabase temporaires sont injectées uniquement pour permettre
au code serveur du Matcher de se charger correctement.

RESULTAT ATTENDU
----------------
PASS : tous les tests sont verts.
ECHEC : le rapport TXT indique précisément les tests en échec.
Un échec critique bloque la validation production.

EN TERMINAL
-----------
Depuis la racine de Mealio :

npx --yes tsx scripts/run-matcher-lab.ts

Le rapport est également écrit automatiquement dans test-reports\.
