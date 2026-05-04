# Infra & Common Layer — Line-by-line QA

Files opened (verbatim Read calls):

- `web/back-nest/src/main.ts` (1–42)
- `web/back-nest/src/app.module.ts` (1–126)
- `web/back-nest/src/common/result.ts` (1–20)
- `web/back-nest/src/common/enums/statuses.ts` (1–72)
- `web/back-nest/src/common/decorators/current-user.decorator.ts` (1–9)
- `web/back-nest/src/common/decorators/require-permission.decorator.ts` (1–28)
- `web/back-nest/src/common/decorators/roles.decorator.ts` (1–5)
- `web/back-nest/src/common/guards/jwt-auth.guard.ts` (1–6) — read for completeness; same shard as auth
- `web/back-nest/src/common/guards/permissions.guard.ts` (1–59) — read for completeness
- `web/back-nest/src/common/guards/roles.guard.ts` (1–78) — read for completeness
- `web/back-nest/src/prisma/prisma.module.ts` (1–51)
- `web/back-nest/src/prisma/prisma.service.ts` (1–8)
- `web/back-nest/src/permissions/permissions.module.ts` (1–10) — cross-referenced for `@Global()` check
- `web/back-nest/src/users/users.controller.ts` — cross-referenced for Result→HTTP mapping
- `web/back-nest/src/projects/pm.controller.ts` — cross-referenced for Result→HTTP mapping
- `web/back-nest/package.json` — cross-referenced for helmet/compression presence
- `web/back-nest/src/filters/` (directory listing) — confirms no Nest exception filters (only saved-search "filters")

---

## Findings

### [CRITICAL] CORS is a full wildcard — cookies / credentialed sessions impossible, and any origin can call the API from a browser
- File: `web/back-nest/src/main.ts:24`
- Category: cors
- Evidence:
```ts
  app.enableCors({ origin: '*' });
```
- Impact:
  - `origin: '*'` is echoed back as `Access-Control-Allow-Origin: *`, and the browser forbids credentialed requests (`withCredentials: true` / cookies / `Authorization` in some stacks) when the wildcard is used together with `credentials: true`. The code does not set `credentials: true` at all, so there is also an implicit **mismatch with the frontend Socket.IO flow** which reads `client.handshake.auth.token` — works today only because the token is passed in handshake `auth`, not cookies. The wider problem is the wildcard itself: **any origin (including malicious pages)** can send unauthenticated `OPTIONS`/GET against `/health`, trigger rate-costly endpoints, or issue `POST /auth/login` CORS preflights to probe for error oracles.
  - No `methods`, `allowedHeaders`, `exposedHeaders`, or `maxAge` configured — preflight cache defaults to minimum, increasing request load.
  - The Vite dev server runs on `http://localhost:5173` (CLAUDE.md) and portal tokens are embedded in a public URL — both legitimate origins could be allow-listed explicitly.
- Fix: build an allow-list from env (`CORS_ORIGINS=https://app.neoleadge.com,http://localhost:5173`) and pass `credentials: true` only when needed. Reject unknown origins. Example:
```ts
const allowed = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
app.enableCors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','X-Request-Id'],
  maxAge: 600,
});
```

---

### [CRITICAL] No Helmet / CSP / security headers — API ships with default Express headers only
- File: `web/back-nest/src/main.ts:1-41` (no helmet import anywhere); `web/back-nest/package.json:30-65` (helmet not in dependencies)
- Category: security
- Evidence:
```ts
// main.ts — full bootstrap, no helmet / security middleware
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
```
- Impact:
  - No `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`, or CSP headers are emitted.
  - The Swagger UI hosted at `/api` (main.ts:33) is served with zero CSP; a compromised dependency in `@nestjs/swagger` UI bundle would execute unchecked.
  - Sensitive JSON responses from `/admin/*` can be framed and clickjacked.
- Fix: install `helmet` and register before routes:
```ts
import helmet from 'helmet';
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));
```
Consider `helmet.hsts({ maxAge: 31536000, includeSubDomains: true })` once HTTPS is enabled in production.

---

### [HIGH] `ValidationPipe` missing `forbidNonWhitelisted` and `disableErrorMessages`
- File: `web/back-nest/src/main.ts:17-22`
- Category: validation
- Evidence:
```ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
```
- Impact:
  - `whitelist: true` silently strips unknown fields — clients never learn that their extra field (often a typo like `assigneeID` instead of `assigneeId`) was dropped. The correct hardening pair is `forbidNonWhitelisted: true` so the request is rejected with a 400 instead of a silent noop, which defends against **mass-assignment** (e.g., a client sending `role: "Admin"` in a user-update body).
  - No `transformOptions: { enableImplicitConversion: true }` — combined with class-validator DTOs, numeric query params (`?page=2`) may be parsed as strings unless each DTO uses `@Type(() => Number)`.
  - In production `disableErrorMessages: true` should be set; otherwise validation errors echo field paths and rule details that can aid fuzzing.
- Fix:
```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  disableErrorMessages: process.env.NODE_ENV === 'production',
});
```

---

### [HIGH] No global exception filter — unhandled errors leak stack traces / Prisma internals
- File: `web/back-nest/src/main.ts` (no `app.useGlobalFilters(...)`); `web/back-nest/src/filters/` (directory contains saved-search feature only, zero `ExceptionFilter` classes)
- Category: security
- Evidence:
  - `main.ts:17-35` registers only `ValidationPipe`, Swagger, and `IoAdapter`. No `useGlobalFilters`.
  - Grep for `ExceptionFilter` in `src/` returns no matches.
- Impact:
  - Any thrown non-HttpException (DB deadlock, JSON parse, `TypeError`, bubble-up from Prisma) returns the default Nest error body, which in development includes the full stack trace and internal error message. In production (no custom filter), Prisma error codes (`P2002`, `P2025`, `P2003`) surface along with raw table/column names — disclosing schema and sometimes the offending row id.
  - No central place to map `PrismaClientKnownRequestError.P2002` → 409 Conflict, `P2025` → 404. Today each controller re-implements it ad-hoc (see [MEDIUM] below).
  - No structured audit log of failures tied to `reqId`; `nestjs-pino` logs the HTTP line but cannot bind a full stack from a rethrown error inside a service unless a filter catches it.
- Fix: add `AllExceptionsFilter` that maps Prisma errors, redacts stack in prod, and emits `logger.error({ err, reqId }, ...)`. Register via `app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)))`.

---

### [HIGH] `Result.fail` path is manually mapped in every controller — status codes inconsistent and occasionally swallowed
- File: `web/back-nest/src/common/result.ts:1-19`; cross-referenced in controllers
- Category: validation
- Evidence (result pattern — no mapping helper):
```ts
export class Result<T = void> {
  private constructor(
    public readonly isSuccess: boolean,
    public readonly value?: T,
    public readonly error?: string,
  ) {}
  get isFailure(): boolean { return !this.isSuccess; }
  static ok<T>(value?: T): Result<T> { return new Result(true, value); }
  static fail<T>(error: string): Result<T> {
    return new Result(false, undefined as unknown as T, error);
  }
}
```
Evidence (inconsistent consumers — grep in `src/projects/pm.controller.ts`):
```ts
if (result.isFailure) throw new NotFoundException(result.error); // line 33
if (result.isFailure) throw new BadRequestException(result.error); // 40, 46, 85
if (result.isFailure) return [];  // line 66 — SWALLOWS the error silently
if (result.isFailure) return [];  // line 74 — same
```
- Impact:
  - **Silent swallow at `pm.controller.ts:66` and `:74`** — a failure (e.g., auth-scope mismatch, DB outage) is converted to an empty array `200 OK`, which the frontend renders as "no projects" and the user assumes success. Violates the global rule "Never silently swallow errors" (coding-style.md).
  - No shared `throwIfFail(result)` helper, so every controller re-decides 400/404/500. Some services return `Result.fail('not found')` and the controller throws `BadRequestException` (400) instead of 404, causing the frontend's generic 4xx toast to be wrong.
  - `Result<T>` has no discriminator on the error kind (not-found vs validation vs conflict), so the controller has to guess from the string.
- Fix: add a kind (`Result.fail('NotFound', msg)` or dedicated `Result.notFound(msg)`) and a single `resultToHttp(r)` helper; grep for `if (result.isFailure) return` to find all silent swallows.

---

### [HIGH] `Result.fail` returns `undefined as unknown as T` — type lies about value presence
- File: `web/back-nest/src/common/result.ts:16-18`
- Category: validation
- Evidence:
```ts
  static fail<T>(error: string): Result<T> {
    return new Result(false, undefined as unknown as T, error);
  }
```
- Impact: code that forgets to check `isFailure` can read `result.value` and receive `undefined` while the type system claims a `T`. A forgotten check inside a service chain creates `Cannot read properties of undefined` 500s that the missing global filter (see above) then leaks.
- Fix: make `value` truly optional on failures and prefer a discriminated union:
```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: string; kind: ErrorKind };
```
(Or at minimum, type `value?: T` and drop the cast so the compiler forces `isFailure` checks before access.)

---

### [HIGH] No `trust proxy` configured — `req.ip` will log the reverse-proxy IP, not the real client
- File: `web/back-nest/src/main.ts:10-39`
- Category: logging
- Evidence: bootstrap never calls `app.set('trust proxy', ...)` or `NestFactory.create(AppModule, { … })` with express options.
- Impact:
  - Behind Nginx / Cloudflare / Render, every request's `req.ip` becomes `127.0.0.1` or the proxy's IP. The pino HTTP logs therefore attribute every login attempt to the same IP, **breaking rate-limit / brute-force detection** and audit trails.
  - `PortalSignoff.ipAddress` (schema noted in CLAUDE.md) will record the proxy IP, invalidating the legal audit trail for client sign-off.
- Fix: for Express app, set trust proxy after `NestFactory.create`:
```ts
app.set('trust proxy', 1); // 1 = first proxy only; use a CIDR array in multi-hop env
```
Also emit the real IP in pino via `customProps` reading `req.ip`.

---

### [HIGH] 100 MB JSON body limit — trivial DoS via oversized payloads to non-upload endpoints
- File: `web/back-nest/src/main.ts:14-15`
- Category: security
- Evidence:
```ts
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ extended: true, limit: '100mb' }));
```
- Impact:
  - Every endpoint — including `/auth/login`, `/admin/*`, notification sockets — now accepts up to 100 MB of JSON. A single unauthenticated client can `POST /auth/login` with a 99 MB JSON blob and keep the Node event loop busy parsing; repeated in parallel this is a textbook slow-body DoS. class-validator then walks the deserialized object.
  - Audio uploads (multer) are handled via `multipart/form-data`, not `json`, so this limit was likely raised as a blanket "make meeting uploads work" shortcut that applies globally.
- Fix: revert JSON to a sensible default (`'1mb'`) and only widen the limit for the specific multer controllers that need it:
```ts
app.use(json({ limit: process.env.JSON_LIMIT ?? '1mb' }));
app.use(urlencoded({ extended: true, limit: '1mb' }));
```
Multer already handles file payloads separately; it does not use these middlewares.

---

### [HIGH] Swagger exposed at `/api` in every environment (no auth, no env guard)
- File: `web/back-nest/src/main.ts:26-33`
- Category: security
- Evidence:
```ts
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NeoLeadge API')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);
```
- Impact:
  - In production this publishes a full route map — including `/admin/*`, `/portal/:token`, `/pm/projects/:id/*` — unauthenticated. Combined with the wildcard CORS above, any public attacker can read the entire API surface.
  - No basic-auth / bearer-guard on the Swagger route, and no `if (process.env.NODE_ENV !== 'production')` guard.
- Fix: wrap in an env check and/or put behind an Admin JWT guard:
```ts
if (process.env.NODE_ENV !== 'production') {
  SwaggerModule.setup('api', app, document);
}
```

---

### [HIGH] `process.env.PORT || 5122` with no host binding — listens on `0.0.0.0` implicitly
- File: `web/back-nest/src/main.ts:37-38`
- Category: config
- Evidence:
```ts
  const port = process.env.PORT || 5122;
  await app.listen(port);
```
- Impact:
  - `app.listen(port)` without a host defaults to `0.0.0.0`, meaning the dev server is reachable from any network interface / LAN peer. On a dev laptop this often exposes the API to a coffee-shop Wi-Fi. In Docker it's fine; in local dev it's a surprise footgun.
  - `process.env.PORT` is coerced via `||` — an empty string would fall through to the fallback (OK here), but a numeric env var stays a **string**, and `app.listen('5122')` works only because Node's `Server.listen` coerces strings. Prefer `Number(process.env.PORT) || 5122`.
- Fix:
```ts
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
await app.listen(Number(process.env.PORT) || 5122, host);
```

---

### [HIGH] `PrismaModule.onApplicationShutdown` is a **no-op** — connections never explicitly closed
- File: `web/back-nest/src/prisma/prisma.module.ts:46-50`
- Category: config
- Evidence:
```ts
export class PrismaModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    // clients disconnect on their own via PrismaClient lifecycle
  }
}
```
- Impact:
  - The comment claims "clients disconnect on their own" but `PrismaClient` does **not** auto-close — the official guidance is to call `await prisma.$disconnect()` on SIGINT / SIGTERM to flush the adapter pool. On a rolling deploy (PM2 reload, Kubernetes pod kill), in-flight MariaDB connections are dropped without a proper FIN, which MariaDB logs as "Aborted connection"; XAMPP tightens this with `max_connect_errors` and the next deploy may be blocked.
  - Also, `NestFactory.create(AppModule, { bufferLogs: true })` is used but `app.enableShutdownHooks()` is **not called in `main.ts`** — so `OnApplicationShutdown` would not be invoked anyway. The no-op filler masks that gap.
- Fix:
  1. In `main.ts` add `app.enableShutdownHooks();` before `app.listen`.
  2. Have `PrismaService` (or the factory) keep a reference to the `PrismaClient` and call `await this.$disconnect()` on shutdown:
  ```ts
  async onApplicationShutdown() {
    await this.$disconnect();
  }
  ```

---

### [HIGH] No pool sizing on `PrismaMariaDb` / `PrismaPg` adapters — default pool may saturate MariaDB
- File: `web/back-nest/src/prisma/prisma.module.ts:19-37`
- Category: config
- Evidence:
```ts
if (url.startsWith('mysql://') || url.startsWith('mariadb://')) {
  const { PrismaMariaDb } = await import('@prisma/adapter-mariadb');
  const parsed = new URL(url);
  const adapter = new PrismaMariaDb({
    host: parsed.hostname,
    port: Number(parsed.port) || 3306,
    database: parsed.pathname.replace(/^\//, ''),
    user: parsed.username || undefined,
    password: parsed.password || undefined,
  });
  client = new PrismaClient({ adapter });
  …
} else {
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: url });
  client = new PrismaClient({ adapter });
  …
}
```
- Impact:
  - Neither adapter is given `connectionLimit`, `idleTimeout`, `acquireTimeout` (MariaDB) or `max`, `idleTimeoutMillis` (Pg). The mariadb driver default is 10 concurrent connections and the pg driver default is 10 — fine for small instances, but **unbounded for how many requests can queue waiting** for a connection, causing long response times under burst traffic with no backpressure signalling.
  - No `ssl` flag is passed, which on managed Postgres (Neon / Supabase / RDS) must be `{ ssl: { rejectUnauthorized: true } }`.
  - The query string in `DATABASE_URL` (e.g., `?connection_limit=20`) is NOT forwarded because the code parses the URL manually and only copies host/port/user/password/database.
- Fix:
```ts
const adapter = new PrismaMariaDb({
  host, port, database, user, password,
  connectionLimit: Number(process.env.DB_POOL ?? 10),
  acquireTimeout: 10_000,
  idleTimeout: 60_000,
});
```
Also document the `DATABASE_POOL_SIZE` env variable and validate at startup.

---

### [HIGH] No Prisma soft-delete middleware — every service must remember to filter `deletedAt IS NULL`
- File: `web/back-nest/src/prisma/prisma.module.ts:10-41`; `web/back-nest/src/prisma/prisma.service.ts:1-8`
- Category: security
- Evidence: `PrismaService` extends `PrismaClient` with zero overrides or `$extends`:
```ts
@Injectable()
export class PrismaService extends PrismaClient {}
```
And the factory never calls `client.$extends` or `client.$use`.
- Impact:
  - CLAUDE.md notes `Project` has `soft-delete` and the recent commit `fd31053 fix: soft-delete projects instead of hard-delete` confirms this is real. But there is **no global filter** enforcing `where: { deletedAt: null }` — every service must remember to add it on `findMany`, `findFirst`, `findUnique`, and counts. Missing it once leaks soft-deleted rows into listings or lets an `update` hit a deleted row.
  - Prisma 7 removed `$use` middleware but supports `$extends({ query: ... })`. Without that, consistency relies on reviewer vigilance.
- Fix: wrap the factory result with a model-level extension that injects `deletedAt: null` into all `find*` / `update*` / `delete*` operations for models with that column:
```ts
client = client.$extends({
  query: {
    project: {
      async findMany({ args, query }) {
        args.where = { deletedAt: null, ...args.where };
        return query(args);
      },
      // ... repeat for findFirst, findUnique, update, count
    },
  },
});
```
Or centralize via a helper `withSoftDelete(where)` and lint for direct `findMany` calls on those models.

---

### [HIGH] `PermissionsModule` is `@Global()` but imported **after** `PrismaModule` and **before** every consumer — order works, yet `app.module.ts` shows `AuthModule` importing it via `providers` that reference it before the module is registered
- File: `web/back-nest/src/app.module.ts:88-94`; `web/back-nest/src/permissions/permissions.module.ts:1-9`
- Category: config
- Evidence:
```ts
// app.module.ts imports (88-94)
PrismaModule,
PermissionsModule,
MailModule,
AuditModule,
AuthModule,
RolesModule,
UsersModule,
```
```ts
// permissions.module.ts
@Global()
@Module({
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
```
- Impact: **Actually OK today** — `@Global()` means NestJS registers `PermissionsService` regardless of import order. The request was to verify "PermissionsModule Global before consumers". It is `@Global` and does sit near the top of the imports array (position 2 after `PrismaModule`). `[UNCERTAIN]` about any side-effect ordering: `PermissionsService` constructor is not read here (only the module file), but if that service ever needs another service at construction time (e.g., PrismaService), the DI graph still resolves because Prisma is imported first. Note this is a **fragile convention**, not an enforced guarantee.
- Fix: none required; flag for documentation — add a code comment in `app.module.ts` explaining the intentional order and reference `@Global()` in the Permissions docs so future maintainers don't reorder.

---

### [MEDIUM] Pino `redact` paths are incomplete — secrets in nested bodies and headers still logged
- File: `web/back-nest/src/app.module.ts:64-73`
- Category: logging
- Evidence:
```ts
redact: {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.jwt',
    'res.headers["set-cookie"]',
  ],
  censor: '[REDACTED]',
},
```
- Impact (the following secrets are **NOT** redacted and will appear in logs if pino-http logs bodies):
  - `req.body.currentPassword` / `req.body.newPassword` (used by password-reset flows — see `POST /admin/users/:id/reset-password`).
  - `req.body.token` / `req.body.refreshToken` (auth refresh, portal signoff).
  - `req.body.clientEmail` (PII on portal signoff).
  - `req.body.apiKey` / `req.body.openaiApiKey` (AI settings updates).
  - `req.headers["x-api-key"]` and `req.headers["x-portal-token"]` — the portal route uses a public token that still belongs in redact.
  - `req.body.signature`, `req.body.otp`, `req.body.twoFactorToken` (otplib is a dependency — there is a 2FA flow).
  - `req.query.token` — portal tokens may be passed via query string.
  - Query strings are not redacted at all, so `?token=secret` ends up in the `url` field.
- Fix: widen `paths` and add a pino `serializers.req` that strips the token query param:
```ts
paths: [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-portal-token"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.passwordConfirm',
  'req.body.jwt',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.apiKey',
  'req.body.openaiApiKey',
  'req.body.geminiApiKey',
  'req.body.otp',
  'req.body.twoFactorToken',
  'req.body.signature',
  'req.body.clientEmail',
  'res.headers["set-cookie"]',
],
```

---

### [MEDIUM] pino-pretty `messageFormat` assumes pino-http fields are on the root — works for HTTP but obscures service logs
- File: `web/back-nest/src/app.module.ts:74-86`
- Category: logging
- Evidence:
```ts
transport: process.env.NODE_ENV === 'production'
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        singleLine: true,
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,req,res,responseTime',
        messageFormat: '{msg} [{reqId}] {method} {url} {statusCode} ({responseTime}ms)',
      },
    },
```
- Impact: service-level logs (those produced by `new Logger('MyService').log('x')`) don't have `method`/`url`/`statusCode`/`responseTime`, so pino-pretty prints them as literal placeholders `{method} {url} {statusCode} ({responseTime}ms)` after every message. This is cosmetic noise that reduces readability of the very logs developers need (service errors, not HTTP access).
- Fix: use `messageFormat` only for HTTP log lines, rely on pino's default for service logs. Simplest workaround — use conditionals in the format string (`{if method}{method} {url}{end}`).

---

### [MEDIUM] `autoLogging.ignore` only ignores `/health` — `/api` (Swagger), `/api-json`, and OPTIONS preflights still spam logs
- File: `web/back-nest/src/app.module.ts:63`
- Category: logging
- Evidence:
```ts
autoLogging: { ignore: (req) => req.url === '/health' },
```
- Impact: Swagger static assets (`/api/swagger-ui*.js`, `/api-json`) and CORS preflights (`OPTIONS *`) inflate production logs and cost. Exact match on `/health` also misses `/health?x=1` or `/healthz` if added.
- Fix:
```ts
autoLogging: {
  ignore: (req) => {
    const u = req.url ?? '';
    if (req.method === 'OPTIONS') return true;
    if (u.startsWith('/health')) return true;
    if (u.startsWith('/api')) return true;
    return false;
  },
},
```

---

### [MEDIUM] `bufferLogs: true` without a guard — if `PinoLogger` fails to construct, buffered logs are lost silently
- File: `web/back-nest/src/main.ts:11-12`
- Category: logging
- Evidence:
```ts
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
```
- Impact: `bufferLogs: true` holds all bootstrap logs until `useLogger` is called. If the Pino transport fails (e.g., pino-pretty binary missing in a freshly built container), the `app.get(PinoLogger)` call throws and the buffered logs never flush — the developer sees `Error: Cannot find module 'pino-pretty'` with no prior context. Minor, but a pattern to be aware of.
- Fix: wrap in try/catch and fall back to the default Nest console logger on failure.

---

### [MEDIUM] `CurrentUser` decorator returns `any` and is not typed
- File: `web/back-nest/src/common/decorators/current-user.decorator.ts:1-9`
- Category: validation
- Evidence:
```ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```
- Impact:
  - `request.user` is typed as `any` (because `getRequest()` has no generic), so every controller that writes `@CurrentUser() user: { userId: string; role: string }` re-declares the shape — and each one can drift (observed: some use `user.userId`, others `user.id`). A typo compiles fine and returns `undefined` at runtime, producing empty queries.
  - No fallback: if auth guard fails to attach `user`, the decorator returns `undefined` and downstream `user.userId` throws `TypeError`. Combined with the missing global exception filter, that TypeError leaks to the client.
- Fix: centralise a `JwtUser` type and bake it in:
```ts
export interface JwtUser { userId: string; email: string; role: string; }
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: JwtUser }>();
    if (!req.user) throw new UnauthorizedException('No user on request');
    return req.user;
  },
);
```

---

### [MEDIUM] `DEFAULT_DAILY_CAPACITY_HOURS` is evaluated at module import time — env changes require a restart
- File: `web/back-nest/src/common/enums/statuses.ts:71`
- Category: config
- Evidence:
```ts
export const DEFAULT_DAILY_CAPACITY_HOURS = Number(process.env.TEAM_DAILY_CAPACITY ?? 8);
```
- Impact:
  - `Number(undefined) === NaN`, but here the nullish-coalesce defaults to `'8'` string → 8 — OK. However `TEAM_DAILY_CAPACITY=abc` silently becomes `NaN`, and the downstream capacity math produces `NaN` hours, which Chart.js renders as empty bars. Fail-fast validation is absent.
  - Because it's a module-level constant, it's read exactly once at import. `ConfigModule.forRoot({ isGlobal: true })` exists in `app.module.ts:43` but is bypassed here.
- Fix:
```ts
const raw = Number(process.env.TEAM_DAILY_CAPACITY);
export const DEFAULT_DAILY_CAPACITY_HOURS =
  Number.isFinite(raw) && raw > 0 ? raw : 8;
```
Better: inject via `ConfigService` instead of reading `process.env` in a const file.

---

### [MEDIUM] `JwtAuthGuard` is an empty shim with no error customisation
- File: `web/back-nest/src/common/guards/jwt-auth.guard.ts:1-6`
- Category: auth
- Evidence:
```ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```
- Impact: default `AuthGuard('jwt')` throws a bare `UnauthorizedException` with no indication of why (token expired vs malformed vs missing). Frontends then cannot show a helpful "your session expired" message; every 401 looks identical. Also: no `handleRequest` override means any thrown exception bubbles with the default message `Unauthorized`.
- Fix (see also `auth` shard): override `handleRequest(err, user, info)` to distinguish `TokenExpiredError` / `JsonWebTokenError` / missing-user and return richer status for the frontend.

---

### [LOW] `json({ limit: '100mb' })` uses express import path while the rest of the app uses `@nestjs/platform-express`
- File: `web/back-nest/src/main.ts:5,14-15`
- Category: config
- Evidence:
```ts
import { json, urlencoded } from 'express';
…
app.use(json({ limit: '100mb' }));
app.use(urlencoded({ extended: true, limit: '100mb' }));
```
- Impact: minor coupling to Express types. If the app ever swaps to Fastify, these imports silently break. Prefer NestJS-agnostic approach: `app.useBodyParser('json', { limit })` on v11.
- Fix: `app.useBodyParser('json', { limit: '1mb' }); app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });`

---

### [LOW] `IoAdapter(app)` used with no CORS — Socket.IO uses its own CORS setting independent of `app.enableCors`
- File: `web/back-nest/src/main.ts:35`
- Category: cors
- Evidence:
```ts
  app.useWebSocketAdapter(new IoAdapter(app));
```
- Impact: the default `IoAdapter` inherits engine.io's CORS default (allow all). Once the HTTP CORS is locked down (see CRITICAL above), the websocket endpoint would still be wide-open. `socket.io` allows preflight from any origin, accepts any handshake, and only filters inside the gateway's own auth (JWT).
- Fix: subclass `IoAdapter` or pass `cors` to it:
```ts
class CustomIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOrigins, credentials: true },
    });
  }
}
app.useWebSocketAdapter(new CustomIoAdapter(app));
```

---

### [LOW] `bootstrap()` call is fire-and-forget — unhandled promise rejections kill the process silently
- File: `web/back-nest/src/main.ts:41`
- Category: logging
- Evidence:
```ts
bootstrap();
```
- Impact: if `await app.listen(port)` rejects (port already in use, DB not reachable on startup), the error is an unhandled promise rejection. Node now exits by default (as of v15+), but without an explicit `console.error(err)` the stack trace is lost in production where the stdout may be tailed by a process manager that only prints `exit code 1`.
- Fix:
```ts
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failed', err);
  process.exit(1);
});
```

---

### [LOW] `Roles(...roles: string[])` is stringly-typed — typos compile
- File: `web/back-nest/src/common/decorators/roles.decorator.ts:4`
- Category: auth
- Evidence:
```ts
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```
- Impact: `@Roles('admin')` vs `@Roles('Admin')` — the guard compares case-sensitively against `user.role`. Typos go unnoticed until runtime, and there is no compile-time enum for the 6 roles defined in the project. The migration note in `roles.guard.ts:12-17` says this decorator is legacy anyway.
- Fix: introduce a union type and deprecate:
```ts
export type AppRole = 'Admin'|'ProjectManager'|'SpecificationTeam'|'RealizationTeam'|'DeploymentTeam'|'Viewer';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
```

---

### [LOW] `RequirePermission` returns `ClassDecorator & MethodDecorator` — intersection is too permissive
- File: `web/back-nest/src/common/decorators/require-permission.decorator.ts:23`
- Category: auth
- Evidence:
```ts
export function RequirePermission(
  keys: string | string[],
  options: { projectParam?: string } = {},
): ClassDecorator & MethodDecorator {
```
- Impact: minor. The intersection `ClassDecorator & MethodDecorator` is what Nest's `SetMetadata` actually returns (`CustomDecorator`), so this explicit cast is redundant and could diverge if Nest changes the signature. Prefer `CustomDecorator` from `@nestjs/common`.
- Fix: `): CustomDecorator<string> { return SetMetadata(...); }`

---

### [LOW] `PrismaService extends PrismaClient` without generic param — loses model type narrowing on custom extensions
- File: `web/back-nest/src/prisma/prisma.service.ts:7`
- Category: config
- Evidence:
```ts
@Injectable()
export class PrismaService extends PrismaClient {}
```
- Impact: minor — but the factory returns `client as PrismaService`, and if we later add `$extends` (e.g., the soft-delete middleware in a separate MEDIUM finding), the extended client is a different type than `PrismaClient`, and the cast lies. Consumers injecting `PrismaService` would not see the extended types.
- Fix: if/when `$extends` is added, define `export type PrismaService = ReturnType<typeof buildPrisma>` and drop the class inheritance.

---

### [LOW] `ConfigModule.forRoot({ isGlobal: true })` defaults to reading `.env` only — no schema validation, no `ignoreEnvFile` in prod
- File: `web/back-nest/src/app.module.ts:43`
- Category: config
- Evidence:
```ts
ConfigModule.forRoot({ isGlobal: true }),
```
- Impact: no `validationSchema` (Joi / Zod) means required env vars (`DATABASE_URL`, `JWT_SECRET`, `AI_PROVIDER`, etc.) are not checked at startup. A missing `JWT_SECRET` only manifests at first login attempt. `ignoreEnvFile: true` should be set in production container deploys so `.env` files shipped by mistake don't override real env.
- Fix:
```ts
ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: process.env.NODE_ENV === 'production',
  validate: (env) => { /* zod schema */ return env; },
});
```

---

### [LOW] `PRESET_ROLE_PERMISSIONS[role]` lookup in `RolesGuard` — silently denies unknown roles
- File: `web/back-nest/src/common/guards/roles.guard.ts:54-63`
- Category: auth
- Evidence:
```ts
    const wantedKeys = new Set<string>();
    for (const role of requiredRoles) {
      const preset = PRESET_ROLE_PERMISSIONS[role];
      if (preset) {
        for (const k of preset) wantedKeys.add(k);
      }
    }

    if (wantedKeys.size === 0) {
      return false;
    }
```
- Impact: if an endpoint uses `@Roles('SuperAdmin')` but the preset map has no `'SuperAdmin'` key, `wantedKeys` is empty and the guard returns `false` silently (403). Better: log a warning so reviewers know the role name is unknown (it's likely a typo).
- Fix:
```ts
if (!preset) this.logger.warn(`Unknown role in @Roles decorator: ${role}`);
```

---

## Summary table

| Sev | Area | Count |
|-----|------|-------|
| CRITICAL | cors, security | 2 |
| HIGH | validation, security, config, logging | 10 |
| MEDIUM | logging, validation, config, auth | 6 |
| LOW | cors, config, auth, logging | 7 |

Biggest exposure surface is **main.ts**: the combination of wildcard CORS + no Helmet + no global exception filter + 100 MB JSON body limit + public Swagger + no `trust proxy` makes the bootstrap the single riskiest file in the backend. Fixing those six items collectively removes 6 of 7 HIGH/CRITICAL findings and unlocks proper rate-limiting and audit logs.

Prisma layer is functional but brittle: the shutdown hook is a no-op, there is no pool tuning, and soft-delete is not enforced globally. The Result<T> pattern is sound in theory but the controller layer swallows or misclassifies failures inconsistently; a central `resultToHttp` helper is strongly recommended.
