# Templates

Ce dossier contient les modèles de projets pour différents types de projet, avec les éléments de base (liste non exhaustive) :
- Gestion de la configuration,
- Logs, 
- Injection de dépendance, 
- Connexion au service Elise

Pour les utiliser, 
- Créer un répertoire pour le projet du client
- Y générer l'arborescence normalisée (en utilisant "\Integration\Projects\Sample project structure\Create default structure.bat").
- Copier le ou les projets utiles et le .sln, à l'emplacement du futur projet client dans \Src
- Renommer les dossiers, le .sln et les .csproj selon le projet du client.
- Ouvrir VS, ajouter une ClassLibrary au projet (le template n'en comporte pas)
- Faire la correction globale des namespaces

## Integration.Elise.ClassLibraryTemplate

Librairie de classe commune pour un projet client, partageable entre les éventuels projets Web, batch, etc

## Integration.Elise.BatchTemplate

Le projet à utiliser comme base de départ pour un nouveau batch.\
 
## Integration.Elise.WebIntegrationTemplate

Le projet à utiliser comme base de départ pour un nouveau projet nécessitant une intégration Web à Elise, sous la forme de CustomAction pour la v6.\

## Integration.Elise.TestsTemplate

Projet de tests unitaires
