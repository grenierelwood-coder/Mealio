# Mealio 1.2.15 — menus et explications

Copier ces seuls fichiers modifiés à la racine du projet, répertoires conservés. Cette livraison complète la version 1.2.14. Redémarrer `npm run dev`, puis Ctrl+F5. En production : refaire `npm run build`. Aucun nouveau SQL.

## Menus

Bandeau principal et ordre du menu mobile : Planning → Courses → Stock → Réapprovisionnements → Anti-gaspi → Inventaire → Admin.

Achats reste accessible dans le menu Plus. Matcher est accessible dans Admin. Rangement reste uniquement dans Admin.

Cartes Administration : Articles à ranger → Réapprovisionnements → Règles de rangement → Épicerie → Tables & relations → Référentiel ingrédients → Correction des recettes → Intégration → Matcher.

## Intégration

L’écran affiche Écran 1.2.15.

**Premier bloc, analyse du Matcher** : utilise le référentiel, les recettes et le stock du foyer connecté, sans créer de planning, de liste, d’achat ni de stock. Peut écrire les propositions/mémoires du Matcher et appeler Claude. Choisir une recette puis Tester la recette sélectionnée, ou Tester toutes les recettes. KH convient à cette analyse.

**Second bloc, cycle complet** : crée un repas planifié, génère/régénère les courses, enregistre l’achat, range dans Frosti/Cellio, termine les courses et consomme le repas. Vérifie aussi l’absence de doublons en répétant certaines opérations. Les données créées restent présentes pour examen.

Ce cycle exige un foyer connecté dédié dont le username finit par -test ou _test, par exemple KH-test. Le champ de confirmation ne crée aucun compte et ne change pas de foyer. Avec KH connecté, le bouton reste désactivé ; le message l’explique maintenant explicitement.

Pour utiliser le cycle : créer un foyer de test distinct dans Frosti/Cellio avec le même username, ses lieux et règles de rangement, puis se connecter à Mealio avec ce foyer. Il doit être vide de stock, planning, liste active et historique d’achat. Choisir une recette entièrement résolue, puis confirmer le nom exact du foyer connecté. L’état vide et la recette sont contrôlés avant création des données. Une erreur en cours de cycle conserve les étapes déjà effectuées.

Il n’est pas nécessaire de préparer ce compte de test pour lancer l’analyse du premier bloc.

## Cases de recette

Une aide « Estimation, Facultatif, Hors courses : quel effet ? » est ajoutée dans Admin → Correction des recettes.

- Aucune de ces cases : ingrédient utilisé normalement pour les besoins calculés. La liste d’achats tient ensuite compte du stock disponible.
- Estimation : le chiffre saisi est utilisé normalement, mais signalé comme approximatif pour les besoins suivis en quantité. Décocher conserve le chiffre et enlève ce signal. Cocher ne remplit pas une quantité vide, ne change pas les unités et ne valide pas une association.
- Facultatif : l’ingrédient est exclu par défaut. Une case Inclure apparaît ; la cocher active cet ingrédient dans les besoins de la recette.
- Facultatif + Inclure + Estimation : actif avec la quantité estimée et son signalement.
- Hors courses : l’ingrédient est exclu des besoins calculés et de la consommation automatique, même si Inclure est coché. Exemple : eau du robinet. Estimation n’a alors pas d’effet sur les calculs.

Les exclusions portent sur la contribution de cette recette : un produit peut toujours être nécessaire pour une autre recette, ou être ajouté manuellement aux courses. Ces options ne suppriment pas un stock existant.

Quand un repas est confirmé consommé, les ingrédients actifs et correctement résolus peuvent être déduits selon leurs quantités, y compris estimées. Une association ou unité invalide reste une protection distincte. Pour un produit en mode présence dans Admin → Épicerie, aucune quantité n’est déduite automatiquement.

Les options enregistrées dans une recette Cookiwiki sont communes aux foyers ; le mode épicerie et les formats d’achat restent propres au foyer. Enregistrer puis régénérer les courses pour appliquer les changements.

## Liens Frosti/Cellio

Oui, une information reste nécessaire pour configurer les liens précis : copier l’adresse affichée par le navigateur après ouverture d’une fiche produit dans Frosti, puis dans Cellio. L’idéal est l’écran de modification de la fiche.

Mealio connaît déjà les bases Supabase pour lire/écrire les données. Leurs adresses ne donnent pas les routes de navigation des applications. Si l’édition ouvre une fenêtre sans changer d’URL, fournir l’adresse de l’application et préciser ce comportement : un lien de fiche ne sera possible qu’avec une route prise en charge par cette app.

Les quantités et unités restent corrigeables directement dans l’Inventaire Mealio. Les clés Supabase et mots de passe ne sont pas nécessaires pour configurer les liens.

## Vérification

Les tests des écrans existants passent, notamment les boutons d’analyse et le verrou du cycle sur un foyer habituel. Contrôle de typage ciblé des écrans sans erreur. Aucun changement du moteur de calcul dans cette version ; la batterie de 577 tests et 14 cas historiques a été validée lors de la version précédente. Pas de campagne sur ta DB ni de build Next complet ici.
