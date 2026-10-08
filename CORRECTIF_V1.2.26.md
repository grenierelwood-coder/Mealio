# Mealio 1.2.26

Correctif à appliquer après la version 1.2.25. Recopier les fichiers en conservant les répertoires. Aucun SQL nécessaire.

La signature des deux gardes de densité accepte maintenant le même objet que getQuantityMode, incluant quantity_mode. Le contrôle respecte ainsi le mode explicite déjà transmis par l’API Admin, sans changer le comportement du moteur.

Vérifications : contrôle TypeScript de toutes les routes API et de leurs dépendances : zéro erreur ; contrôle étendu des tests : zéro erreur ; 605 tests automatisés et 14 scénarios laboratoire réussis ; tests d’interface réussis.

Le build Next.js complet reste à confirmer sur votre installation.

Relancer : npm run verify:production
