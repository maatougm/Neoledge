-- Drop wiki tables — the wiki feature was retired (UI hidden + backend module
-- + frontend view all deleted). Children first, then parent.

DROP TABLE IF EXISTS "WikiRevisions" CASCADE;
DROP TABLE IF EXISTS "WikiPages"     CASCADE;
