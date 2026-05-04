-- Add an index on customFieldId so cascading deletes of a WorkPackageCustomField
-- and queries that filter by customFieldId alone don't full-scan the values table.
CREATE INDEX IF NOT EXISTS "WorkPackageCustomValues_customFieldId_idx"
  ON "WorkPackageCustomValues" ("customFieldId");
