# Sprint 4 — Phase 8 Fix Pass

Scope: harden `web/back-nest/src/main.ts` bootstrap only. No other files touched.

## Changes

1. **Helmet** — added `helmet@latest` dependency via `npm install helmet` and applied `app.use(helmet())` immediately after `NestFactory.create`.
2. **CORS allow-list** — replaced `app.enableCors({ origin: '*' })` with an env-driven allow-list. Reads `CORS_ORIGINS` (comma-separated) via `ConfigService`, defaults to `http://localhost:5173`, enables credentials.
3. **ValidationPipe tightened** — added `forbidNonWhitelisted: true` and `forbidUnknownValues: true` to the existing `{ whitelist: true, transform: true }` config.
4. **Global exception filter** — inline `AllExceptionsFilter` class in `main.ts`. Always logs server-side via NestJS `Logger` (pino-backed). In production, returns `{ statusCode, message }` only (strips `stack`, `name`, Prisma codes, nested error metadata). In dev, returns verbose payload (`message`, `name`, `stack`, `path`). Applied via `app.useGlobalFilters(new AllExceptionsFilter(isProduction))`.
5. **Body limits** — reduced JSON/urlencoded limits from `100mb` to `1mb`. Multer (file uploads) is untouched, so the 100MB cap on meetings audio upload via `FileInterceptor` is preserved.
6. **Swagger env-guard** — wrapped `SwaggerModule.createDocument` + `SwaggerModule.setup('api', ...)` in `if (!isProduction)`.
7. **trust proxy** — `(app.getHttpAdapter().getInstance() as ...).set('trust proxy', 1)` applied after bootstrap.
8. **Shutdown hooks** — `app.enableShutdownHooks()` called before `app.listen()`.

## Dependencies

- Added `helmet` to `web/back-nest/package.json` (`npm install helmet`).
- No other packages changed.

## Untouched (per constraints)

- `TEST_USERS` in `auth.service.ts` — kept.
- `quickAccounts` in `LoginView` — kept.
- Dev auto-login in router — kept.
- Existing pino (`nestjs-pino`) wiring — preserved.
- Existing Swagger bearer-auth builder — preserved (just gated).
- Socket.IO adapter — preserved.

## Build status

Command: `npm run build` in `web/back-nest` (runs `nest build`).
Result: GREEN. No TypeScript errors. `dist/src/main.js` + `main.d.ts` + `main.js.map` emitted successfully. `nest build` produces no stdout on success, which was the case here.

## Notes / follow-ups

- `CORS_ORIGINS` should be set in prod `.env` to the public frontend origin(s), e.g. `CORS_ORIGINS=https://app.neoleadge.example,https://admin.neoleadge.example`.
- With `forbidNonWhitelisted: true`, any request body field not decorated on the DTO will now yield `400`. Existing class-validator DTOs should cover all current routes, but this is worth smoke-testing on PM/Admin flows.
- The inline filter lives in `main.ts` for minimal-diff; if future work needs to share it with tests, promote it to `src/common/filters/all-exceptions.filter.ts`.
