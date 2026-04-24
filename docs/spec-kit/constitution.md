# Constitution — NeoLeadge Transformation

## Principes non-négociables

1. **Zero-downtime migrations** — toute migration DB se fait en 2 étapes : backfill → ALTER. Jamais de DROP COLUMN sans backfill préalable.
2. **RBAC strict** — chaque endpoint `/admin/*`, `/pm/*`, `/team/*` doit porter `@UseGuards(JwtAuthGuard, RolesGuard) + @Roles(...)`. Pas d'exception.
3. **Result pattern** — tous les services renvoient `Result.ok()` / `Result.fail()`. Jamais `throw` métier.
4. **DTO = class + class-validator** — jamais `interface`, jamais `import type` pour les DTO.
5. **Pas de `prisma db push`** sur DB existante — SQL brut via `mysql.exe`.
6. **Pas de commit sans** : `code-reviewer` + `qa` OK.
7. **Feature flag ou rollback SQL** documenté pour tout changement destructif.

## Définition de "Ready to Deploy"

- [ ] Build backend OK (`npm run build`)
- [ ] Build frontend OK (`npm run build`)
- [ ] Prisma generate OK
- [ ] Pas d'erreur TypeScript
- [ ] qa agent validé
- [ ] Migration SQL dry-run OK sur DB de dev
- [ ] Rollback SQL écrit

## Cibles de la transformation

4 acteurs métier : **Admin / Chef de Projet / Équipe Spéc / Membre**
Rôle technique conservé : `DeploymentTeam` (phase-gate livraison)
