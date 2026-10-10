# Mealio V1.3.1

Projet complet de l’écosystème Frosti / Cellio / Mealio. Lire **GUIDE_ECOSYSTEME.md** avant installation : migrations selon votre version actuelle, configuration, vérifications et limites de reprise.

Depuis la version précédemment livrée : `migrations/001_mealio_v1_3_ecosystem.sql puis 002_mealio_v1_3_1.sql`. Si la première migration est déjà appliquée, ne passer que la seconde. Conserver votre configuration et ne pas rejouer les SQL historiques en bloc.

Contrôles : `npm ci`, puis `npm run verify:production`. Reconnexion nécessaire après mise à jour ; secret MEALIO_SESSION_SECRET de 32 caractères minimum.
