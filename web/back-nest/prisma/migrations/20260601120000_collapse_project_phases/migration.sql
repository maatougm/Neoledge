-- Collapse the project lifecycle from 9 phases to 4
-- (Brouillon/Draft → Lancement/Kickoff → Réalisation/Realisation → Clôture/Cloture, + Archived).
--
-- Remap existing Project.status rows that hold one of the 6 removed phases:
--   CadrageTechnique                                  -> Kickoff      (post-cahier scoping = Lancement)
--   Environnement, Parametrage, Integration, Recette, MEP -> Realisation (execution)
-- Draft, Kickoff, Cloture, Archived are unchanged.
--
-- Historical ProjectValidation.phase / PhaseChecklist.phase rows are intentionally
-- left as-is (audit trail; they do not drive the lifecycle stepper).

UPDATE "Projects" SET status = 'Kickoff'     WHERE status = 'CadrageTechnique';
UPDATE "Projects" SET status = 'Realisation' WHERE status IN ('Environnement', 'Parametrage', 'Integration', 'Recette', 'MEP');
