-- PM-set progress override (0-100). NULL = auto from closed work packages.
ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS "manualProgressPct" INTEGER;
