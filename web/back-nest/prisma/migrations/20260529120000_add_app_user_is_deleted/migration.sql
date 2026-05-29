-- Soft-delete support for users: admin "delete" sets isDeleted=true (+ isActive=false
-- + tokenVersion++) instead of hard-deleting, preserving FK history while hiding the
-- user from admin lists and blocking authentication.
ALTER TABLE "AppUsers" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
