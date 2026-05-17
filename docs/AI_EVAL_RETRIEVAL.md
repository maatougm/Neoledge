# AI Eval — Retrieval (pgvector)

Generated: 2026-05-17T15:54:50.330Z
Backend:   `https://neoleadge.pythagore-init.com`

## Summary

| Metric | Value |
|---|---|
| Total queries | 30 |
| Recall @5 | **100.0%** |
| Recall @10 | 100.0% |
| MRR | 0.958 |
| Latency p50 / p95 | 32ms / 47ms |
| Threshold (recall@5) | 70% |
| Verdict | ✓ PASS |

## Per-query results

| Fixture | Target | Query | Rank | Top hit similarity | Top hit snippet |
|---|---|---|---|---|---|
| 01-ged-rich | field-values | stack technique frontend retenue | 1 | 0.874 | Frontend Neoform (PrimeVue 4 + Vue 3) ; Backend Elise.Automate (.NET 8 C#) + Web API REST ; base de données PostgreSQL 16 ; moteur OCR Tesseract 5 ; module IA A |
| 01-ged-rich | field-values | calendrier de mise en production | 1 | 0.840 | Déployer Archimed Elise comme nouvelle plateforme GED unifiée, avec migration des 8 millions de documents existants, mise en service en production le 20 octobre |
| 01-ged-rich | field-values | objectif principal du projet | 1 | 0.845 | Déployer Archimed Elise comme nouvelle plateforme GED unifiée, avec migration des 8 millions de documents existants, mise en service en production le 20 octobre |
| 01-ged-rich | field-values | applications hors périmètre | 1 | 0.864 | Refonte des applications métiers consommatrices de la GED (Murex, Avaloq) ; migration des e-mails Exchange ; archivage des bandes magnétiques d'avant 2010. |
| 01-ged-rich | field-values | documentation technique attendue | 1 | 0.859 | Plateforme Elise GED en production ; scripts de migration des 8M documents SharePoint ; documentation technique (architecture, API, exploitation) ; guide utilis |
| 01-ged-rich | segments | signature électronique qualifiée | 1 | 0.861 | Animateur: Réunion de cadrage avec le DSI et le responsable conformité de la BCV. Confirmation du choix Elise/Archimed, validation du budget 4,2 MCHF, calendrie |
| 01-ged-rich | segments | classification documents par IA | 1 | 0.861 | Animateur: Atelier technique avec l'équipe data science. Validation de l'approche : Tesseract 5 pour l'OCR brut, puis classification fine par Azure OpenAI gpt-4 |
| 01-ged-rich | segments | volumétrie de la migration | 1 | 0.822 | Animateur: Réunion de cadrage avec le DSI et le responsable conformité de la BCV. Confirmation du choix Elise/Archimed, validation du budget 4,2 MCHF, calendrie |
| 01-ged-rich | segments | certification archivage légal | 1 | 0.834 | Animateur: Réunion de cadrage avec le DSI et le responsable conformité de la BCV. Confirmation du choix Elise/Archimed, validation du budget 4,2 MCHF, calendrie |
| 03-workflow-contradictory | field-values | moteur de workflow choisi | 1 | 0.883 | Moteur de workflows BPMN, formulaires dynamiques pour la collecte d'informations, connecteur HRIS Workday, génération automatique des comptes Active Directory,  |
| 03-workflow-contradictory | field-values | intégration RH | 4 | 0.852 | Application déployée, documentation, formation 12 administrateurs RH, rapport de recette. |
| 03-workflow-contradictory | field-values | exclusions fonctionnelles | 1 | 0.848 | Offboarding des collaborateurs ; mobilité interne ; sous-traitants et intérimaires. |
| 03-workflow-contradictory | field-values | objectif délai d'onboarding | 1 | 0.897 | Safran souhaite automatiser le processus d'onboarding de ses nouveaux collaborateurs. Le process actuel mobilise 6 services différents (RH, IT, sécurité, paie,  |
| 03-workflow-contradictory | segments | date de mise en production décalée | 1 | 0.895 | Animateur: Le DRH adjoint annonce que la mise en production sera décalée au 1er novembre 2026 pour aligner avec la fin de la campagne d'embauche annuelle. Le pé |
| 03-workflow-contradictory | segments | rejet intégration badges API | 1 | 0.853 | Animateur: L'équipe sécurité refuse la connexion directe à HID Origo. Compromis : générer une demande de badge dans Origo via mail signé, validation manuelle pa |
| 03-workflow-contradictory | segments | périmètre étendu sites pilotes | 1 | 0.821 | Animateur: Le DRH adjoint annonce que la mise en production sera décalée au 1er novembre 2026 pour aligner avec la fin de la campagne d'embauche annuelle. Le pé |
| 04-deployment-francophone | field-values | hébergement et souveraineté | 1 | 0.823 | Neoform front-end ; Elise.Automate backend en .NET 8 ; base PostgreSQL 16 hébergée chez OVH Strasbourg (souveraineté SecNumCloud) ; signature ANSSI RGS** via pr |
| 04-deployment-francophone | field-values | vagues de déploiement | 1 | 0.852 | Déployer Elise dans les 27 mairies en deux vagues : 12 mairies pilotes pour le 30 juin 2026, puis les 15 restantes pour le 31 décembre 2026. Tous les agents adm |
| 04-deployment-francophone | field-values | signature numérique conforme | 1 | 0.840 | Neoform front-end ; Elise.Automate backend en .NET 8 ; base PostgreSQL 16 hébergée chez OVH Strasbourg (souveraineté SecNumCloud) ; signature ANSSI RGS** via pr |
| 04-deployment-francophone | field-values | fonctionnalités hors périmètre | 1 | 0.853 | La gestion des cimetières et concessions funéraires reste sur l'outil municipal existant. Les bulletins de paie sont gérés par un prestataire externe non concer |
| 04-deployment-francophone | segments | version de l'API COMEDEC | 1 | 0.906 | Animateur: Présentation de l'API COMEDEC du Ministère de l'Intérieur par la chef de projet. Le connecteur Elise existant doit être adapté pour gérer la nouvelle |
| 04-deployment-francophone | segments | budget total du projet | 1 | 0.836 | Animateur: Réunion avec la directrice DSI de l'agglomération et trois maires représentants. Validation du choix Elise. Insistance sur l'hébergement en France (O |
| 04-deployment-francophone | segments | logistique de formation | 1 | 0.818 | Animateur: Réunion avec la directrice DSI de l'agglomération et trois maires représentants. Validation du choix Elise. Insistance sur l'hébergement en France (O |
| 05-documentation-bilingual | field-values | framework du portail développeur | 1 | 0.860 | Portail Backstage.io customisé ; auto-import OpenAPI 3.1 from Git repositories ; module Elise pour versioning des spec files ; sandbox interactive (try-it-now)  |
| 05-documentation-bilingual | field-values | APIs externes exclues | 1 | 0.887 | Refactoring des 450 endpoints existants (out-of-scope) ; documentation des APIs externes tierces (Bloomberg, Refinitiv) ; legacy SOAP services. |
| 05-documentation-bilingual | field-values | support multilingue de l'interface | 2 | 0.832 | TotalEnergies Trading exploite une plateforme interne d'API REST (~450 endpoints) consommée par les traders et les algorithmes de pricing. La documentation actu |
| 05-documentation-bilingual | field-values | authentification SSO retenue | 1 | 0.848 | Portail Backstage.io customisé ; auto-import OpenAPI 3.1 from Git repositories ; module Elise pour versioning des spec files ; sandbox interactive (try-it-now)  |
| 05-documentation-bilingual | segments | stratégie multi-région cloud | 1 | 0.846 | Animateur: Discussion bilingue entre le tech lead parisien et l'architect principal de Houston. The choice of Backstage.io is validated. Decision: use the Softw |
| 05-documentation-bilingual | segments | traduction de la documentation technique | 1 | 0.844 | Animateur: Atelier UX bilingue avec 8 développeurs (4 français, 4 américains). Feedback : la documentation auto-traduite est inacceptable, il faut une vraie i18 |
| 05-documentation-bilingual | segments | langages d'exemples de code retenus | 1 | 0.849 | Animateur: Atelier UX bilingue avec 8 développeurs (4 français, 4 américains). Feedback : la documentation auto-traduite est inacceptable, il faut une vraie i18 |
