# Contributing to NeoLeadge

## Branch Naming

```
feat/short-description       ← new feature
fix/short-description        ← bug fix
refactor/short-description   ← code cleanup
docs/short-description       ← documentation only
```

Examples: `feat/dashboard-deadline-alerts`, `fix/pm-ownership-check`

## Commit Format

```
<type>: <short description>

<optional body — explain WHY, not WHAT>
```

Types: `feat` · `fix` · `refactor` · `docs` · `test` · `chore`

Examples:
```
feat: add bulk archive to project list

fix: prevent PM from editing other PMs projects

refactor: extract field validation to shared composable
```

## Pull Request Checklist

Before opening a PR:

- [ ] Branch is up to date with `master`
- [ ] Code builds without errors (`dotnet build` / `npm run build`)
- [ ] TypeScript passes (`npm run type-check`)
- [ ] No `appsettings.json` or `appsettings.Development.json` in the diff
- [ ] No hardcoded secrets in any file
- [ ] New services are registered in `ServiceModule.cs`
- [ ] New routes are added to the router in `router/index.ts`
- [ ] French error messages used in validators and service layer

## Backend Rules

- All service methods return `Result<T>` — never throw exceptions for expected failures
- Use `Result<T>.Ok(data)` and `Result<T>.Fail("message")`
- Always check ownership before mutating: `if (project.ProjectManagerId != CurrentUserId) return Forbid()`
- Soft delete only — never hard delete projects, comments, or attachments
- New entities must have `IsDeleted` + `HasQueryFilter` if they support soft delete
- Password validation: minimum 8 chars · 1 uppercase · 1 digit

## Frontend Rules

- Never use `severity="primary"` on `NeoButton` — omit the prop for default teal
- `NeoDatePicker` v-model must be `string | null`, not a `Date`
- Use `useNeoToast().add({ severity, detail, life })` — no `.success()` / `.error()` shortcuts
- Pinia store state must be updated immutably — no direct mutation
- All API calls go through Pinia stores, not directly from components

## Running Locally

See [README.md](README.md) for full setup instructions.
