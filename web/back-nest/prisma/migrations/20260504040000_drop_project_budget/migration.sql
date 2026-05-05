-- Drop the lingering Project.budget Decimal column. The budgeting module
-- itself was retired earlier; this column was only fed into the cahier prompt
-- and a few seed questionnaire fields. All references in service / type / seed
-- code have been removed in the same commit.

ALTER TABLE "Projects" DROP COLUMN IF EXISTS "budget";
