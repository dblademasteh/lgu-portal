# LGU Portal – Reverse-Engineered Specification

## 1. Overview
LGU SSO Portal is a Next.js 15 single sign-on gateway for LGU systems. Dark glassmorphism UI driven by a three-layer design token system (primitive → semantic → component). Tokens are built from `tokens/tokens.json` via scripts.

**Stack**
- Next.js 15.1.6, React 19, TypeScript 5.7
- Node >=20.11
- `output: 'standalone'` – deployable via Docker, Dockerfile copies `.next/standalone`
- Session store: in-memory default, Redis optional via `REDIS_URL`; graceful degrade to memory
- OIDC provider stub: RS256 signing, PKCE required, in-process authorization codes + refresh tokens
- Logging: pino, metrics: prom-client
- No external DB; user directory, client registry, audit log are in-process stubs

## 2. Architecture
```
src/
  app/            # Next.js App Router
    (public) login/, page.tsx, portal/, account/, launch/[slug]/
    admin/        # admin UI – users, clients, systems, audit, settings, keys
    api/          # Auth, OIDC, health, metrics, session, systems
  components/     # UI primitives, AdminNav, PortalNav, ConfirmSubmit, SessionTimer…
  lib/
    auth/         # users, sessions, guards, rate-limit, crypto, store-memory/redis
    admin/        # keys, clients actions, audit, settings actions
    oidc.ts       # Minimal OpenID Connect provider
    systems.ts    # System catalogue
    oidc-flow.ts, jwt-view.ts, handoff.ts…
```

### Request flow
Middleware (`src/middleware.ts`) fast cookie-presence check for `/portal`, `/account`, `/launch`. Authorisation is performed server-side in `lib/auth/guards.ts` via `readSession()` → store → user lookup.

## 3. Routes – Observed

### Public
- `GET /` – Landing page with brand, trust signals.
- `GET /login?next=` – Login form (`LoginForm.tsx`). POST → `POST /api/auth/login`.
- `GET /unauthorized` – Denial page.

### Protected
- `GET /portal` – Dashboard with system directory, filtered by `canAccess`.
- `GET /account` – Profile, session timer, sign-out.
- `GET /launch/[slug]/app` – Launch handoff page for a system.
- `GET /admin` – Admin dashboard, requires admin role.
- `GET /admin/users` – User list, update roles/lock/mfa.
- `GET /admin/clients` – Client registry CRUD.
- `GET /admin/systems/[slug]` – System edit view.
- `GET /admin/settings` – Maintenance: clear rate limits / purge expired sessions.
- `GET /admin/keys` – Key ring view.
- `GET /admin/audit` – Audit log view.

### API
Auth
- `POST /api/auth/login` – username/password, creates session, sets `lgu_sso_session` cookie.
- `POST /api/auth/logout` – destroys session, clears cookie.

Session
- `GET /api/session` – Returns current session metadata.

OIDC
- `GET /api/oidc/discovery` – OpenID Configuration.
- `GET /api/oidc/authorize` – Authorization code flow, PKCE enforced.
- `POST /api/oidc/token` – Code exchange / refresh token.
- `GET /api/oidc/userinfo` – Claims for access token.
- `GET /api/oidc/jwks` – Public keys.
- `POST /api/oidc/logout` – End session.
- `GET /api/oidc/callback` – Demo callback.

Health / Observability
- `GET /api/health/liveness` – Always 200.
- `GET /api/health/readiness` – 200 if Node up; 503 if Redis configured but degraded; returns store probe.
- `GET /api/metrics` – Prometheus exposition, unauthenticated.

Systems
- `GET /api/systems` – Returns `SYSTEMS` catalogue.

## 4. Data Models – Observed

### User
`lib/auth/users.ts`
```
id, employeeId, username, email, displayName, title, department, roles[], mfaEnabled, phoneLast4, office, timeZone, avatarHue, lastSignIn
```
Roles: `employee | supervisor | admin | auditor`
Demo accounts: admin, r.santos, j.delacruz, audit, locked
Password: scrypt hashed, shared DEMO_PASSWORD env var.

### Session
`lib/auth/session-store.ts`
```
id, userId, createdAt, lastSeenAt, expiresAt, authTime, amr[], mfaVerified, ip?, userAgent?
```
Policy:
- Absolute TTL 8h
- Idle TTL 30m
- Renew every 1m, clamped to absolute ceiling
- Cookie: `lgu_sso_session = <id>.<hmac>`, httpOnly, SameSite=Lax, Secure in prod, maxAge 8h

Store contract:
`create, get, touch, destroy, destroyUserSessions, purgeExpired, listUserSessions, stats, probe, close`

### System
`lib/systems.ts`
```
slug, name, shortName, description, category, icon, accent (hue), status, url, owner, scopes[], allowedRoles[], accepts[], version, usagePercent, maintenanceWindow?
```
Categories: People, Finance, Planning, Operations, Public Service, Technology, Security
Status: operational|degraded|maintenance – advisory, does not gate launch.

### Client / OIDC
`lib/oidc.ts`, `lib/clients-store.ts`
ClientId prefix `lgu-`. Public clients, PKCE S256 mandatory.
Auth code TTL 60s, access/id token TTL 900s, refresh token TTL 8h.
Tokens signed RS256 with key ring `lib/admin/keys.ts`.
In-process maps for codes and refresh tokens.

## 5. Auth & Session Behaviour – EARS

**Session creation**
- WHEN a user successfully authenticates
  - GIVEN valid credentials and account not disabled
  - THEN the system SHALL create a session with absolute TTL 8h and idle TTL 30m
  - AND SHALL set `lgu_sso_session` cookie httpOnly, SameSite=Lax, Secure in prod

**Session lifetime**
- WHEN a session is accessed
  - THEN the system SHALL update `lastSeenAt` if ≥1 min elapsed
  - AND SHALL enforce both absolute and idle expiry independently

**Session degradation**
- WHEN Redis store is unavailable
  - THEN the system SHALL degrade to in-memory store
  - AND SHALL log degradation and report `degraded` in readiness
  - AND SHALL retry Redis on exponential backoff 2s → 30s

**OIDC authorize**
- WHEN `/api/oidc/authorize` is called with `response_type=code` and PKCE `code_challenge_method=S256`
  - THEN the system SHALL issue a one-time authorization code valid 60s
  - AND SHALL bind code to clientId, redirectUri, codeChallenge

**OIDC token**
- WHEN `/api/oidc/token` exchanges a code
  - THEN the system SHALL verify PKCE, single-use, expiry, client binding
  - AND SHALL issue RS256 access_token, id_token, refresh_token

**Role access**
- WHEN a user attempts to launch a system
  - THEN the system SHALL allow access IF user roles intersect `system.allowedRoles` or `allowedRoles` empty
  - AND SHALL redirect to `/unauthorized` otherwise

**Admin guard**
- WHEN a request accesses `/admin/*`
  - THEN the system SHALL require role `admin`
  - AND SHALL redirect to `/login` if unauthenticated

## 6. Admin Features – Observed
- User management: list, update displayName/email/roles/locked/mfaEnabled, lock/unlock, reset MFA
- Client management: register, rotate secret, delete
- System catalogue: read-only listing, per-system detail
- Audit: read audit log entries
- Settings: clear rate limits, purge expired sessions
- Keys: view active key ring for RS256

## 7. Design Tokens
`tokens/tokens.json`
Layers:
- primitive – raw values, colors, spacing, typography
- semantic – purpose aliases, dark glass theme is default
- component – per-component overrides

Generated CSS custom properties via `scripts/generate-tokens.mjs`; validated by `scripts/validate-tokens.mjs`.

## 8. Non-Functional
- Security headers in `next.config.mjs`: HSTS, CSP strict, X-Frame-Options DENY, Permissions-Policy
- Middleware matcher excludes static assets
- Rate limiting in `lib/auth/rate-limit.ts`
- Audit events in `lib/auth/audit.ts`
- Logging via pino
- Prometheus metrics exposed at `/api/metrics`
- Health probes for K8s

## 9. Uncertainties / In-Process Stubs
- User directory, client registry, audit log are in-memory; no persistence beyond Redis sessions
- OIDC refresh token rotation and key rotation not implemented
- System URLs point to `lgu.example.gov.ph` – no real integration
- Admin settings forms for policy/OIDC/config are placeholder redirects
- No database migrations; production would need real IdP integration

## 10. Key Files
- `next.config.mjs` – standalone output, security headers
- `src/middleware.ts` – edge cookie-presence guard
- `src/lib/auth/session-store.ts` – session contract & lifetime rules
- `src/lib/auth/sessions.ts` – store selection, degrade/recover
- `src/lib/oidc.ts` – OIDC provider
- `src/lib/systems.ts` – system catalogue
- `src/lib/auth/users.ts` – demo user directory
- `tokens/tokens.json` – design token source
