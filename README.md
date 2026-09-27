# LGU SSO Portal

A single sign-on gateway for connected government (LGU) systems. One credential,
twelve civic systems, and a real OpenID Connect provider so the handoff to a
downstream system is an actual authorization-code flow rather than a simulated
one.

Built on Next.js App Router with **zero third-party runtime dependencies** — the
scrypt hashing, HMAC-signed cookies, PKCE, and JWT signing are all `node:crypto`.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in SESSION_SECRET (see below)
npm run dev
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`SESSION_SECRET` must be at least 32 characters. In production the app refuses to
start without it rather than falling back to a default — a predictable signing
key would let anyone mint a session cookie.

### Demo accounts

Every seeded account shares the password **`Lgu@Portal2026`** (override with
`DEMO_PASSWORD`).

| Username     | Role       | MFA    | Use it to see                        |
| ------------ | ---------- | ------ | ------------------------------------ |
| `j.delacruz` | employee   | no     | The happy path — sign in and launch  |
| `r.santos`   | supervisor | yes    | An MFA challenge                     |
| `admin`      | admin      | yes    | Every system, including IAM          |
| `audit`      | auditor    | no     | Read-only access                     |
| `locked`     | employee   | no     | The locked-account branch            |

> **MFA accounts cannot complete sign-in.** The second factor is generated and
> held server-side, and there is no SMS or email delivery channel in this
> prototype — so `admin` and `r.santos` will reach the code entry step and stop
> there. That is deliberate: there is no safe way to surface a real OTP to a
> browser. Use `j.delacruz` to exercise the full launch flow, and read the MFA
> branch in `src/app/api/auth/login/route.ts` for the rest.

---

## The design token system

The UI is driven by a three-layer token architecture. `tokens/tokens.json` is the
single source of truth; `src/app/tokens.css` is generated from it and committed,
so the app builds with no compile step.

```
primitive  →  semantic  →  component
  136           111          174          421 custom properties total
```

- **Primitive** — raw values with no meaning: `color.cyan.400`, `space.4`,
  `radius.lg`. Rarely changes.
- **Semantic** — purpose aliases: `color.accent.default`,
  `color.text.muted`, `glass.surface`. Change these to re-theme.
- **Component** — per-component overrides: `button.primary.bg`,
  `tile.restricted.border`. Change these to restyle one part.

A component reads the semantic layer, never the primitive layer directly. That
is what makes a re-theme a semantic-layer edit.

### Why the dark theme has no toggle

The `semantic` layer **is** the dark theme, so the app renders dark with no class
toggling and no flash of the wrong theme. This portal ships one theme. A second
one would be a sibling `semantic` block overriding the same names — and because
components read the semantic layer rather than the primitive layer, none of them
would need to change.

### Regenerating and checking tokens

```bash
npm run tokens:build      # tokens.json → src/app/tokens.css
npm run tokens:watch      # rebuild on change
npm run tokens:validate   # fail on hardcoded values in src/
node scripts/validate-tokens.mjs --strict   # also flag raw px/rem
```

`validate-tokens` lints hand-written code for values that should be tokens. A
line containing `tokens-allow-raw` is skipped; that marker is used exactly once,
for the `themeColor` literal in `src/app/layout.tsx`, which the browser reads
before any stylesheet applies.

> `scripts/generate-tokens.mjs` is a project-local replacement for the
> `design-system` skill's `generate-tokens.cjs`, which cannot resolve references
> inside composite values (`linear-gradient(90deg, {a}, {b})`) and chokes on
> dotted numeric keys (`space.2.5`). Both are fixed here. The generator refuses
> to write output if any `{reference}` leaks through unresolved.

---

## How the SSO flow works

```
/login ──► /launch/[slug] ──► /api/oidc/authorize ──► /api/oidc/callback
                                     │                        │
                                     │  issues code + state   │ redeems code
                                     ▼                        ▼
                              downstream system          /launch/[slug]/app
```

1. **`/launch/[slug]`** authorizes the viewer for the system, mints a PKCE
   verifier/challenge pair and a `state`, stashes the verifier server-side, pins
   the `state` to the browser with a cookie, and redirects to the authorize
   endpoint. It is a Route Handler, not a page: it renders no UI, and Next.js
   only permits cookie writes in Route Handlers and Server Actions.
2. **`/api/oidc/authorize`** sees an existing session and issues a code without
   re-prompting — this is the step that makes it *single* sign-on.
3. **`/api/oidc/callback`** verifies the state, redeems the code with the PKCE
   verifier, and parks the tokens behind a single-use signed ticket.
4. **`/launch/[slug]/app`** redeems the ticket and renders the downstream app
   with its claims.

Tokens never appear in a URL. The handoff ticket in `src/lib/handoff.ts` is
single-use and short-lived.

### Provider endpoints

| Endpoint                                  | Purpose                          |
| ----------------------------------------- | -------------------------------- |
| `/.well-known/openid-configuration`       | Discovery (the contractual path) |
| `/api/oidc/discovery`                     | Same document, easier to read    |
| `/api/oidc/authorize`                     | Authorization endpoint           |
| `/api/oidc/token`                         | `code` and `refresh_token`       |
| `/api/oidc/userinfo`                      | Claims for an access token       |
| `/api/oidc/jwks`                          | Signing keys                     |
| `/api/oidc/logout`                        | RP-initiated logout              |

---

## Verifying it works

```bash
npm run verify     # typecheck + token lint + 62-check smoke test
```

Or individually. The smoke test walks the real HTTP path a browser takes,
because the interesting failures in an authorization-code flow — replayed codes,
PKCE mismatch, state mismatch, audience confusion — live in the wiring between
endpoints, not in any one unit.

```bash
npm run typecheck
npm run smoke     # requires a running server: npm start
```

It covers unauthenticated redirects, uniform credential rejection, MFA, session
cookie forgery, the full code + PKCE exchange, code replay, authorize-endpoint
hardening (unregistered `redirect_uri`, `plain` PKCE, missing PKCE, unregistered
scope), RBAC, discovery, sign-out, security headers, and open-redirect
protection.

---

## Limitations

These are real, and none of them are hidden in the code.

- **Sessions are durable only when `REDIS_URL` is set.** `src/lib/auth/sessions.ts`
  is a thin facade over a `SessionStore` interface with two backends:
  `store-memory.ts` (default) and `store-redis.ts` (selected when `REDIS_URL` is
  set, or pinned with `SESSION_STORE=redis`). Without `REDIS_URL`, sessions are
  **non-durable** (a restart signs everyone out) and **per-instance** (a second
  replica cannot see them, so load balancing requires sticky sessions). With it,
  both problems go away. If Redis is unreachable the app **degrades to the
  in-memory store and logs it** rather than failing requests; `/api/health/readiness`
  then reports `degraded` instead of `healthy`, so the condition is visible
  without taking the pod out of rotation. Degradation is not permanent: the store
  re-probes Redis on a bounded backoff (2s doubling to 30s), driven by incoming
  requests rather than a timer, and promotes itself back to the durable backend
  on its own. Sessions created in memory during the outage are not migrated, so
  those users sign in again. Note that `SESSION_STORE=redis` forces the backend
  but does not make the app hard-fail when Redis is down — alert on a readiness
  status of `degraded` rather than expecting a 503.
- **Authorization codes, refresh tokens, and pending flows are still in-memory.**
  These live in `Map`s in `src/lib/oidc.ts` and `src/lib/auth/oidc-flow.ts` and
  have no Redis path yet. On more than one replica, a code issued by one instance
  cannot be redeemed by another, so the portal is single-replica-correct only.
  Moving sessions to Redis does not fix this; the OIDC object stores need the
  same treatment.
- **Tokens are signed with HS256.** The JWKS endpoint therefore publishes the
  shared secret, which defeats the point of a JWKS. Production must move to
  RS256/ES256 with a private key the portal holds and a public key it publishes.
  The RS256 keyring for that migration is built and rotating at
  `/admin/keys` — real 2048-bit RSA pairs, a valid JWK Set, audited — but
  `src/lib/oidc.ts` still mints HS256 tokens, so that keyring is not yet in the
  signing path. See `src/lib/admin/keys.ts` for the scope note.
- **The user directory is a stub.** Accounts are seeded in
  `src/lib/auth/users.ts` with a demo password. There is no real identity source;
  wire this to the LGU's directory or an HR system to make it real.
- **The rate limiter is per-instance** and in-memory, so limits reset on restart
  and are not shared across replicas.
- **Signing keys do not survive a restart.** The keyring is held in-process. It
  must move to a KMS/HSM or be loaded from mounted secrets before it is used to
  sign real tokens, or every deploy invalidates every outstanding token.
- **No refresh-token rotation key ring.** `SESSION_SECRET` rotation invalidates
  every session and pending handoff at once, with no overlap window.
- **No consent screen.** Scopes are granted implicitly at launch. A real
  deployment should show the user what they are agreeing to share.
- **The downstream systems are simulated.** `/launch/[slug]/app` is a mock app
  rendering claims; there is no real system behind it.
- **MFA has no delivery channel** (see above).
- **Single origin.** `OIDC_ISSUER` must match the origin the browser actually
  uses, or `redirect_uri` validation rejects every request.

## Wiring a real IdP

`src/lib/auth/*` is the seam. Replace `authenticate()` in
`src/lib/auth/users.ts` with a call to the real directory and delete the seed
data; the session, PKCE, and OIDC layers above it do not change. Then move the
session store off the heap and the signing keys to RS256 before putting this in
front of anyone.
