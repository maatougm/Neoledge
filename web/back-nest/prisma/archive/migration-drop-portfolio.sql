-- Drop Portfolio tables (PostgreSQL — prod)
-- The @@map names: Portfolio -> Portfolios, PortfolioProject -> PortfolioProjects
-- CASCADE handles the FK from PortfolioProjects to Portfolios automatically.

DROP TABLE IF EXISTS "PortfolioProjects" CASCADE;
DROP TABLE IF EXISTS "Portfolios" CASCADE;
