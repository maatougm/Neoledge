-- Passwordless "magic link" sign-in support. Mirrors the password-reset token
-- columns: stores SHA256(rawToken) + a short (15-min) expiry, cleared on use.
ALTER TABLE "AppUsers" ADD COLUMN "magicLinkToken" VARCHAR(255);
ALTER TABLE "AppUsers" ADD COLUMN "magicLinkTokenExpiry" TIMESTAMP(3);
