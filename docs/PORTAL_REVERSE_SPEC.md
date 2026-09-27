# Reverse Specification — LGU Portal (OIDC SSO Gateway)

**Artifact type:** reverse spec (code archaeology from `frontend/src` → `src/...`).
**Scope analyzed:** `src/lib/oidc.ts`, `src/lib/oidc-flow.ts`, `src/lib/handoff.ts`, `src/lib/systems.ts`, `src/lib/auth/{crypto,sessions,session-store,store-memory,store-redis,session-cookie,rate-limit,guards,users,audit}.ts`, `src/lib/admin/{clients,keys,systems,users,guards,settings-actions,keys-actions}.ts`, `src/lib/redirect.ts`, `src/lib/jwt-view.ts`, `src/lib/logging.ts`, `src/lib/metrics.ts`, `src/middleware.ts`, and the App Router surfaces `app/api/oidc/{authorize,token,callback,discovery,jwks,userinfo,logout}/route.ts`, `app/api/auth/login|logout|session/route.ts`, `app/api/auth/logout/route.ts`, `app/api/systems/route.ts`, `app/launch/[slug]/route.ts`, `app/launch/[slug]/app/page.tsx`, `app/portal/page.tsx`, `app/login/page.tsx`, `app/account/page.tsx`, `app/admin/*`, `components/{SystemDirectory,SystemTile,LoginForm,PortalNav,SignOutButton,SessionTimer,AuroraBackdrop}`.
**Status:** verified against running instance on `:3000` (HTTP 200), `npm run typecheck` clean, no `hrms` references present (SSO wiring previously added for HRMS has been reverted).

---

## 1. System overview

`lgu-portal` is a **self-contained OpenID Connect provider** (the authorisation-server half of an SSO gateway) built on Next.js 15 (App Router) + TypeScript. It owns authentication for a fixed catalogue of "connected systems" and mints tokens that downstream apps consume. It is NOT a service-delegation layer — it authenticates, authorises, and issues; the downstream systems are simulated (a `/launch/[slug]/app` page renders the issued claims).

```
        ┌────────────────────────────────────── lgu-portal (:3000) ───────────────────────────────────────────┐
        │  Next.js 15 App Router · TS  │  OIDC Issuer (HS256 today)  │  pluggable session store  │  admin area  │
        │                                                                                                         │
        │  /api/oidc/authorize  ──302(code+iss)──►  /api/oidc/callback  ──302(ticket cookie)──► /launch/{slug}/app│
        │        ▲                                ▲                                  │                              │
        │        │   /launch/{slug}               │  PKCE+single-use code            ▼                              │
        │        │   (PKCE+state)                 │  exchange+issue tokens         /api/oidc/token                 │
        │        │                                │  (code_verifier)              (code|refresh_token)             │
        │        │                                │                                  │                              │
        │   /login  ◄── no session ── /api/oidc/authorize                 /api/oidc/jwks, /userinfo            │
        │        │                                                                       │                      │
        │   /api/auth/login  ── scrypt/verify ──► createSession ──► lgu_sso_session cookie (HMAC)              │
        │                                                                                   ▲              │
        │         memory store (default) │ Redis (REDIS_URL)                                 │              │
        │         ABSOLUTE 8h + IDLE 30m + SLIDE 1m                                      sign-in              │
        └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │  downstream RP (e.g. HRMS) would call: GET /.well-known/openid-configuration  │  /api/oidc/* are PUBLIC (spec-required) │
        └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

> **Relationship model in scope:** the portal is the **IdP**. An external app (HRMS, "your portal") is an **OIDC RP** that redirects to `/api/oidc/authorize` with `client_id=lgu-<slug>`, a `redirect_uri` registered for that client, and PKCE. The demo tiles (`SystemTile` → `/launch/[slug]`) exercise the **same** authorize path but redirect back *into the portal itself* (`/api/oidc/callback`), because the demo downstream is the `/launch/[slug]/app` shell. A real external RP needs its own callback URL registered per-client.

---

## 2. OIDC provider surface (`lib/oidc.ts`)

| Constant / helper | Value |
|---|---|
| `OIDC_ISSUER` | `process.env.OIDC_ISSUER ?? 'http://localhost:3000'` |
| Client id prefix | `lgu-` — `clientIdFor(system) = lgu-<slug>` |
| Auth-code TTL | 60 s (one-time, replay ⇒ `invalidateCodesForUser`) |
| Access token TTL | 900 s; ID token 900 s; refresh token 8 h |
| Base scopes | `openid profile email roles` + per-system `scopes` |
| Code storage | in-memory `Map`; `sweepCodes()` purges expired |
| Signing | **HS256** against one shared secret (`OIDC_SIGNING_SECRET` ≥ 32, else `SESSION_SECRET`, else dev fallback). *Documented limitation.* |
| Refresh | rotating (presented token deleted, new issued) |
| Claims minted | `iss, sub(=userId), aud=clientId, exp, iat, jti, sid, email, name, roles, department, employee_id, scope` (+ `nonce`, `auth_time`, `amr` on ID token) |

**Discovery** (`discoveryDocument()`) is served from **two** paths (same bytes):
- `GET /.well-known/openid-configuration`  (`app/.well-known/openid-configuration/route.ts`)
- `GET /api/oidc/discovery`  (`app/api/oidc/discovery/route.ts`)

**Endpoints**
- `GET /api/oidc/authorize` — validate client/redirect_uri/response_type/PKCE/scope; require session (else `302 /login?next=/api/oidc/authorize?...&client=...`); `canAccess` role gate (else `access_denied` → redirect to client); rate-limit `mfa`/`authorize:sessionId`; issue code `302` to `redirect_uri` with `code`+`state`+`iss`.
- `POST /api/oidc/token` — `authorization_code` (PKCE, single-use, client+redirect bound) and `refresh_token` (rotating). 8 KB body cap.
- `GET /api/oidc/callback` — CSRF: `flow.state === flowCookie`; `consumeAuthorizationCode`; re-checks `canAccess` at redemption; `issueTokens`; `issueHandoff` (opaque ticket); `302 /launch/<slug>/app`; sets `lgu_oidc_handoff` cookie (httpOnly, 120s), deletes `lgu_oidc_flow`.
- `GET /api/oidc/userinfo` — verify access token (issuer + **audience** check); returns `sub,name,email,roles,department,employee_id,email_verified,updated_at`.
- `GET /api/oidc/jwks` — HS256 `oct` key = the shared secret (security liability, see §7).
- `GET|POST /api/oidc/logout` — RP-initiated; `post_logout_redirect_uri` allow-listed to `/login|/,|/portal` (no open redirect); invalidates codes for the user.

### Client model — the central gap for external RPs

```
clientId = "lgu-" + slug        findClient(clientId):
                                          │
                    ┌─────────────────────┴──────────────────────────┐
                    ▼                                                   ▼
   system exists in SYSTEMS (getSystem)                    system NOT in catalogue
   → redirectUris = [${ISS}/api/oidc/callback,               → returns null  →  authorize:
     ${ISS}/api/oidc/callback/loopback]                          "unauthorized_client"
   clientSecret = randomUUID()  (placeholder)
   grantTypes = [code, refresh], responseTypes=[code],
   tokenEndpointAuthMethod = "none" (public), allowedScopes = system.scopes
```

- **`listClients()`** hard-codes `['hris','treasury','gis','dms','helpdesk','analytics','iam']` — it does **not** equal `SYSTEMS` (misses `ebudget,library,health,procurement,permits`).
- **`findClient`** only resolves `lgu-<slug>` from `SYSTEMS`; it does **not** consult any persisted client registry. So `/admin/clients` registration (see §6) is wired to `registerClient`, which is a **stub** that returns an in-memory object and never stores it — those clients can never be found by `findClient` → a real external RP calling `/api/oidc/authorize` with its `client_id` gets `unauthorized_client`.
- **Redirect URIs are hard-coded** to the portal's own callback. `registerClient` accepts `redirectUris` but (a) it is a no-op persistence-wise, and (b) the live `findClient(validateAuthorizeRequest)` ignores `System.redirectUris` entirely.

> **Implication for "connect a portal with SSO":** to let HRMS (an external RP) consume this portal's tokens, two things must exist that do not: (1) a **client registry** that `findClient` consults for non-system clients, keyed by `client_id`, with **per-client `redirect_uris`**; (2) the HRMS callback URL must be the allowed redirect target. The current code only supports the portal calling *itself*.

---

## 3. Authentication & sessions (`lib/auth/*`)

**Password store** (`lib/auth/users.ts`): a **demo stub** directory of 5 users (`usr_*` ids, `employeeId` like `LGU-2019-0417`, roles from `employee|supervisor|admin|auditor`, demo password `Lgu@Portal2026` hashed with scrypt N=2^15, 64-byte key). README notes production users come from the HR system / a real IdP ("Wiring a real IdP"). One account (`usr_9a4c60de`, "locked") demonstrates the disabled path; `DISABLED_USER_IDS` is the only revocation.

**Login** (`app/api/auth/login`): scrypt verify + timing-safe; uniform failure responses (same status/body for unknown-user vs wrong-password vs disabled, specific reason only to audit log); MFA challenge (in-memory map, 6-digit, 5 min) for `mfaEnabled` users; rate limits **identity** (8/15m) + **client** (30/15m) + **mfa** (6/15m); `auth.login.{success,failure,locked}`, `auth.mfa.*`, `rate_limit.blocked`. Success → `createSession` + `setSessionCookie` → redirect to validated `next` (or `/portal`).

**Session store** (`lib/auth/sessions.ts` → `store-redis` | `store-memory`):
- Backend chosen by `SESSION_STORE` / `REDIS_URL` (`redis` if set & not pinned to `memory`). **Degrades gracefully to in-memory** on Redis failure (fail-closed: an unverifiable session is treated as signed-out, never trusted). Bounded exponential backoff (2 s→30 s) recovers to Redis automatically; in-memory sessions from an outage are **not** migrated.
- Cookie: `lgu_sso_session`, HMAC-signed (`value.hmac`), httpOnly + SameSite=Lax + Secure(Prod), opaque 256-bit id (no identity in the cookie). `openSessionCookie` verifies HMAC **before** any store lookup.
- Policy: `ABSOLUTE_TTL = 8 h`, `IDLE_TTL = 30 min`, `RENEW_AFTER = 1 min`; `isSessionLive` (the single source of truth) checks both `expiresAt` and idle; `renewSession` clamps to `createdAt + 8h` ceiling. Redis `touch` is an atomic Lua script enforcing both rules (fixes the prior drift where Redis ignored idle TTL and could extend the absolute cap).
- Per-user index `sess:user:<id>` for efficient `destroyUserSessions`/`listUserSessions`; `scan` sweep in `purgeExpired`/`stats`.
- `storeProbe()` feeds the **readiness** endpoint; `liveness` does not probe the store.

**Middleware** (`middleware.ts`): Edge-only, **cookie-presence** redirect for `/portal /account /launch` (`/api/oidc /api/auth /_next /login` public). Explicitly *not* authoritative — guards.ts is, because the store is Node-only and middleware is Edge.

---

## 4. SSO / OIDC launch flow

```
Browser                         Portal server                          "Downstream"
  │
  │ GET /launch/hris                 │
  │   (viewer w/ role)              │  requireSystemAccess → canAccess
  │                                 │  PKCE verifier + state = registerFlow(state → in-mem Map, 10 min)
  │ ←── 302 /api/oidc/authorize?client_id=lgu-hris                              (FLOW_COOKIE=lgu_oidc_flow, httpOnly)
  │   ...client_id, redirect_uri, response_type=code, scope, state, nonce,
  │   code_challenge, code_challenge_method=S256
  │
  │ GET /api/oidc/authorize  ── if no session ──► 302 /login?next=/api/oidc/authorize...&client=lgu-hris
  │   (signed-in SSO)        ── session ok ──► validateAuthorizeRequest (PKCE, redirect_uri exact-match,
  │                                    scope ⊆ client.scopes, access_denied if !canAccess)
  │                                    ── issueAuthorizationCode ──► 302 redirect_uri?code=…&state=…&iss=
  │                                      (audit: app.launch success; rate-limit: authorize:sessionId)
  │
  │ GET /api/oidc/callback?code=…&state=…   ── peekFlow, state must equal FLOW_COOKIE
  │   ── consumeAuthorizationCode (PKCE verify, single-use, client+redirect bound)
  │   ── re-check canAccess (role can change mid-flow)
  │   ── issueTokens (access+id+refresh)
  │   ── issueHandoff({slug, tokens, mfaVerified}) → ticket (in-mem Map, 120 s, single-use)
  │   ── 302 /launch/<slug>/app   (set lgu_oidc_handoff=<ticket>.<hmac>, delete lgu_oidc_flow)
  │
  │ GET /launch/<slug>/app        ── requireViewer ── consumeHandoff(ticket) [single use]
  │   ── verifyAccessToken(at, clientId=lgu-<slug>) [issuer+audience]
  │   ── render /launch/[slug]/app (claims: subject, employee_id, name, email, roles, scopes, token lifetime)
  │
  │ GET /launch/<slug>/app (reload) ── ticket already consumed ──► 302 /portal?relaunch=<slug>
```

The SSO property: a viewer already holding a valid `lgu_sso_session` cookie is **not** sent to `/login` on step 2 — `getSession` resolves them and a fresh code is issued immediately.

---

## 5. Catalogue & RBAC (`lib/systems.ts`)

`SYSTEMS` = 12 entries: `hris, treasury, ebudget, gis, dms, library, health, procurement, helpdesk, analytics, iam, permits`. Each carries `slug, name, shortName, description, category, icon(key), accent(hue°), status, url, owner, scopes[], allowedRoles[], accepts[]` (auth methods: `pwd|otp|hwk`), `version`, `usagePercent`, optional `maintenanceWindow|ticketQueue`.

- `canAccess(system, roles)`: `system.allowedRoles.some(r => roles.includes(r))` — **authoritative** server-side (the UI only uses it to render). Empty `allowedRoles` ⇒ everyone.
- `isLaunchable(system)`: `status !== 'maintenance'` — advisory only (shapes tile, does not gate).
- Role lattice: `employee, supervisor, admin, auditor`; `admin` is the only role gated to `/admin/*` (`lib/admin/guards.ts`).
- `accent` is a hue applied via a component-scoped custom property (kept out of the brand token layer).

`CATEGORIES` enumerates the 7 category labels.

---

## 6. Admin surface (gated `requireAdmin`)

| Area | Lib (server actions) | File | Notes |
|---|---|---|---|
| Clients | `lib/admin/clients.ts` | — | `registerClient`/`rotateClientSecret`/`deleteClient` — **stub**: returns in-memory client, never persisted; deletes of `lgu-*` system clients blocked. |
| Keys / JWKS | `lib/admin/keys.ts` | — | Real RSA-2048 key pairs, `n`/`e` extracted from DER, rotation + revocation, 30-day retirement grace, MAX_KEYS=5. **Not wired as the live signer** (tokens still HS256 — see §7). |
| Systems | `lib/admin/systems.ts` | — | CRUD on the catalogue. `createSystem` **collects `redirectUris` from the form and validates them but discards them** — `System` has no `redirectUris` field. `hris`/`iam` locked from deletion. |
| Users | `lib/admin/users.ts` | — | `updateUser`/`lockUser`/`unlockUser`/`resetUserMfa`. **Note (bug):** `updateUser` body is commented out — "In production, call the actual update function" — so edits are **not persisted**. |
| Settings | `lib/admin/settings-actions.ts` | — | TOTP issuer, site title, default role, theme. |
| Audit | (read-only view) | `app/admin/audit/page.tsx` | Lists `record(...)` events. |
| Metrics | `lib/metrics.ts` | `app/api/metrics/route.ts` | prom-client, basic auth via `METRICS_PASSWORD`. |
| Health | — | `app/api/health/liveness|readiness` | liveness = always 200; readiness = `storeProbe()` + JWKS reachable. |

---

## 7. Risks / gaps (material to "connect a portal with SSO")

| # | Finding | Impact |
|---|---|---|
| 1 | `findClient` only resolves `lgu-<slug>` from `SYSTEMS`; `registerClient` is a non-persisted stub. | An external RP (HRMS) cannot be recognised at `/api/oidc/authorize` unless HRMS's slug is added to `SYSTEMS` **and** `listClients`. Admin-created clients are dead code. |
| 2 | Redirect URIs are hard-coded to `${ISS}/api/oidc/callback` and `(/loopback)`. `System` has no `redirectUris`; `createSystem` discards the form's URIs. | HRMS cannot register its **own** callback — the core requirement for an external RP. |
| 3 | Tokens signed HS256; JWKS publishes the shared secret. RS256 keyring exists but is **not** the live signer. | Production RPs cannot safely verify (they'd hold the signing key). Must flip `lib/oidc.ts` to `signWithActiveKey` + RS256 in discovery/JWKS. |
| 4 | `/portal/page.tsx` has `SystemDirectory` **commented out** (import + JSX both disabled). | No launch tiles render — the SSO entry point exists (`/launch/[slug]`) but is unreachable from the UI. |
| 5 | `/admin/users` `updateUser` does not persist edits (commented call). | Admin user edits are silently lost. |
| 6 | Demo user directory; `employeeId` = `LGU-<year>-<n>` (e.g. `LGU-2019-0417`). | For HRMS ESS linkage, `employee_id` claim must map to `Employee.employeeNumber` on the HRMS side — formats differ (HRMS uses numeric `0004...` etc.) and must be reconciled. |
| 7 | `listClients()` ≠ `SYSTEMS` (missing 5 systems). | Cosmetic for discovery; functional for `findClient`-by-slug. Worth aligning. |
| 8 | HS256 `k` in JWKS is the raw signing secret. | Info-leak: anyone who can read `/api/oidc/jwks` can forge tokens. |

---

## 8. EARS (selected)

- **REQ-01:** As an unauthenticated client, when I GET `/api/oidc/authorize` with an unknown `client_id`, then the server returns an error page and does **not** redirect to my `redirect_uri` (no open redirect).
- **REQ-02:** As an OIDC client, when I present a `redirect_uri` that is not registered, then the authorize endpoint rejects `invalid_request` without redirecting.
- **REQ-03:** As a signed-in viewer, when I GET `/launch/<slug>` for a system whose `allowedRoles` I don't hold, then I am redirected to `/unauthorized?system=<slug>` (not to `/login`).
- **REQ-04:** As the token endpoint, when a `code` is replayed, then it fails `invalid_grant` and all codes issued to that `userId` are invalidated (`invalidateCodesForUser`).
- **REQ-05:** As a relying party, when I redeem a code, then the `code_verifier` must satisfy the stored S256 challenge.
- **REQ-06:** As the session layer, when Redis is unavailable, then sign-in degrades to the in-memory store and never admits a session that cannot be verified (fail-closed).
- **REQ-07:** As an operator, when I GET `/.well-known/openid-configuration`, then I receive the issuer, all six OIDC endpoints, supported `response_types`/`grant_types`/`alg`/`scopes`/`code_challenge_methods`.
- **REQ-08:** As a signed-in user, when I reload `/launch/<slug>/app` after the handoff ticket was consumed, then I am returned to `/portal?relaunch=<slug>` (single-use handoff).

---

## 9. Environment / run

- `npm run dev` → `:3000`; `npm run build` / `npm start`; `npm run typecheck`; `npm run verify` (= typecheck + `tokens:validate` + `smoke`).
- Env (from `.env.example`, present): `OIDC_ISSUER`, `OIDC_SIGNING_SECRET`, `SESSION_SECRET`, `REDIS_URL`, `SESSION_STORE`, `METRICS_PASSWORD`, `NEXT_PUBLIC_*`.
- `next.config.mjs` rewrites `/.well-known/openid-configuration` and `/.well-known/jwks.json` to the API routes (the discovery route is also reachable at `/api/oidc/discovery`).
