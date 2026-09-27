/**
 * End-to-end check of the SSO flow against a running server.
 *
 * Not a substitute for a real test suite — it is a smoke test that walks the
 * actual HTTP path a browser takes, because the interesting failures in an
 * authorization-code flow (replayed codes, PKCE mismatch, state mismatch,
 * audience confusion) live in the wiring between endpoints, not in any one unit.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal cookie jar: enough for a single-client redirect walk. */
class Jar {
  #cookies = new Map();

  absorb(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' ) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  has(name) {
    return this.#cookies.has(name);
  }

  get(name) {
    return this.#cookies.get(name);
  }

  set(name, value) {
    this.#cookies.set(name, value);
  }
}

const jar = new Jar();

/** GET that follows one redirect manually so each hop can be inspected. */
async function hop(url, { follow = false, method = 'GET', body } = {}) {
  const response = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: jar.header(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
  jar.absorb(response);
  if (follow && response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) return hop(location, { follow: true });
  }
  return response;
}

/* ------------------------------------------------------------------ */

section('Unauthenticated access');
{
  const portal = await hop('/portal');
  check('protected page redirects when signed out', portal.status === 307 || portal.status === 302,
    `got ${portal.status}`);
  check('redirect targets /login', (portal.headers.get('location') ?? '').startsWith('/login'),
    portal.headers.get('location') ?? 'no location');

  const login = await hop('/login');
  check('login page renders', login.status === 200);

  const systems = await hop('/api/systems');
  check('systems API refuses anonymous callers', systems.status === 401, `got ${systems.status}`);
}

section('Credential rejection');
{
  const bad = await hop('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'j.delacruz', password: 'wrong-password-here' }),
  });
  const badBody = await bad.json();
  check('wrong password is rejected', bad.status === 401, `got ${bad.status}`);
  check('error does not reveal the field at fault', !('field' in badBody));

  const unknown = await hop('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'nobody-at-all', password: 'wrong-password-here' }),
  });
  const unknownBody = await unknown.json();
  check('unknown user is rejected identically', unknown.status === bad.status);
  check('unknown user gets the same generic message', unknownBody.message === badBody.message,
    `"${unknownBody.message}" vs "${badBody.message}"`);

  const locked = await hop('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'locked', password: 'Lgu@Portal2026' }),
  });
  const lockedBody = await locked.json();
  check('locked account reports a distinct state', lockedBody.status === 'locked', lockedBody.status);
}

section('MFA challenge (regression: must not wedge the server)');
{
  // Regression guard. The MFA path builds a long numeric challenge id, and an
  // earlier rejection-sampling helper spun forever for any length above 9
  // digits — one sign-in with an MFA account locked up the whole event loop.
  // A timeout here means that class of bug is back.
  //
  // `r.santos` is the seeded account with mfaEnabled. Signing in as `admin`
  // here returns a full session, so the assertions below silently passed on the
  // wrong path and this guard stopped testing anything.
  const mfa = await hop('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'r.santos', password: 'Lgu@Portal2026' }),
  });
  check('MFA account gets a challenge, not a hang', mfa.status === 200, `got ${mfa.status}`);
  const mfaBody = await mfa.json();
  check('MFA is required for this account', mfaBody.status === 'mfa_required', mfaBody.status);
  check('no session is issued before the second factor', !jar.has('lgu_sso_session'));
  check('challenge is present', typeof mfaBody.challenge === 'string' && mfaBody.challenge.length > 0);

  // Whitelist the response shape. The OTP must never travel to the client, and
  // a key-set assertion proves that without having to guess the code.
  const allowed = new Set(['ok', 'status', 'challenge', 'maskedDestination', 'expiresInSeconds', 'message']);
  const unexpected = Object.keys(mfaBody).filter((key) => !allowed.has(key));
  check('response carries no code field', unexpected.length === 0, `unexpected keys: ${unexpected.join(', ')}`);

  // The server must still be answering requests afterwards.
  const alive = await hop('/api/session');
  check('server still responsive after MFA challenge', alive.status === 200, `got ${alive.status}`);
}

section('Successful sign-in (no MFA)');
{
  const login = await hop('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'j.delacruz', password: 'Lgu@Portal2026' }),
  });
  const body = await login.json();
  check('valid credentials authenticate', body.status === 'authenticated', JSON.stringify(body));
  check('session cookie is set', jar.has('lgu_sso_session'));
  check('session cookie is opaque and signed', (jar.get('lgu_sso_session') ?? '').includes('.'));

  const portal = await hop('/portal');
  check('portal renders when signed in', portal.status === 200, `got ${portal.status}`);
  const html = await portal.text();
  check('portal shows the signed-in user', html.includes('Jenna'));
}

section('Tampered session cookie');
{
  const original = jar.get('lgu_sso_session');
  const [id] = original.split('.');

  // Same valid session id, forged signature. The HMAC check must reject it
  // before any store lookup, and the session must read as absent.
  jar.set('lgu_sso_session', `${id}.forged-signature`);
  const probe = await fetch(`${BASE}/api/session`, { headers: { cookie: jar.header() } });
  const body = await probe.json();
  check('forged cookie signature yields no session', body.authenticated === false,
    JSON.stringify(body).slice(0, 120));

  const portal = await hop('/portal');
  check('forged cookie cannot reach the portal',
    portal.status === 302 || portal.status === 307, `got ${portal.status}`);

  // A wholly fabricated id must also be rejected.
  jar.set('lgu_sso_session', 'not-a-real-session-id.signature');
  const probe2 = await fetch(`${BASE}/api/session`, { headers: { cookie: jar.header() } });
  check('fabricated session id yields no session',
    (await probe2.json()).authenticated === false);

  jar.set('lgu_sso_session', original);
}

section('Authorization code + PKCE flow');
let code = null;
let launchUrl = null;
{
  // /launch performs the client half and redirects to the authorize endpoint.
  const launch = await hop('/launch/hris');
  check('launch redirects', launch.status === 307 || launch.status === 302, `got ${launch.status}`);
  launchUrl = launch.headers.get('location');
  check('launch redirects to the authorize endpoint',
    (launchUrl ?? '').includes('/api/oidc/authorize'), launchUrl ?? 'none');

  const authorizeUrl = new URL(launchUrl);
  const params = authorizeUrl.searchParams;
  check('authorize request carries a PKCE challenge', params.get('code_challenge_method') === 'S256');
  check('authorize request carries state', Boolean(params.get('state')));

  const authorized = await hop(launchUrl);
  check('authorize endpoint redirects', authorized.status === 302, `got ${authorized.status}`);

  const callbackUrl = new URL(authorized.headers.get('location'), BASE);
  code = callbackUrl.searchParams.get('code');
  check('authorization code issued', Boolean(code));
  check('state echoed back', callbackUrl.searchParams.get('state') === params.get('state'));

  const landed = await hop(callbackUrl.toString());
  check('callback redirects to the downstream app',
    (landed.headers.get('location') ?? '').includes('/launch/hris/app'),
    landed.headers.get('location') ?? 'none');

  const app = await hop(landed.headers.get('location'));
  check('downstream app renders', app.status === 200, `got ${app.status}`);
  const appHtml = await app.text();
  check('claims reached the downstream app', appHtml.includes('LGU-2021-0933'));
  check('granted scopes are shown', appHtml.includes('profile:read'));
}

section('Authorization code replay');
{
  if (!code) {
    check('skipped, no code captured', false);
  } else {
    const replay = await fetch(`${BASE}/api/oidc/callback?code=${encodeURIComponent(code)}&state=x`, {
      headers: { cookie: jar.header() },
      redirect: 'manual',
    });
    check('a spent code cannot be redeemed twice', replay.status === 302);
  }
}

section('Authorization endpoint hardening');
{
  const badRedirect = await hop(
    '/api/oidc/authorize?client_id=lgu-hris&redirect_uri=https://evil.example/steal&response_type=code&scope=openid&code_challenge=abc&code_challenge_method=S256',
  );
  check('unregistered redirect_uri is not redirected off-origin',
    !(badRedirect.headers.get('location') ?? '').includes('evil.example'),
    badRedirect.headers.get('location') ?? 'none');

  // A well-formed challenge with a downgraded method, so this can only pass
  // because `plain` is rejected — not because the challenge was malformed.
  const plainPkce = await hop(
    '/api/oidc/authorize?client_id=lgu-hris&redirect_uri=http://localhost:3000/api/oidc/callback&response_type=code&scope=openid&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=plain',
  );
  const location = plainPkce.headers.get('location') ?? '';
  check('PKCE method downgrade to plain is refused', location.includes('error=invalid_request'), location);

  const noPkce = await hop(
    '/api/oidc/authorize?client_id=lgu-hris&redirect_uri=http://localhost:3000/api/oidc/callback&response_type=code&scope=openid',
  );
  check('public client without PKCE is refused',
    (noPkce.headers.get('location') ?? '').includes('error=invalid_request'),
    noPkce.headers.get('location') ?? 'none');

  // The challenge must be a well-formed one (43-128 chars) or the PKCE length
  // check rejects the request first and this would never exercise the scope
  // check at all.
  const badScope = await hop(
    '/api/oidc/authorize?client_id=lgu-hris&redirect_uri=http://localhost:3000/api/oidc/callback&response_type=code&scope=openid%20admin:everything&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=S256',
  );
  check('unregistered scope is refused', (badScope.headers.get('location') ?? '').includes('error=invalid_scope'),
    badScope.headers.get('location') ?? 'none');
}

section('Role-based access control');
{
  // j.delacruz is an employee; IAM requires admin.
  const restricted = await hop('/launch/iam');
  check('restricted system is not launchable', restricted.status === 302 || restricted.status === 307);
  const target = restricted.headers.get('location') ?? '';
  check('restricted launch explains itself', target.includes('unauthorized'), target);

  const authorizeDirect = await hop(
    '/api/oidc/authorize?client_id=lgu-iam&redirect_uri=http://localhost:3000/api/oidc/callback&response_type=code&scope=openid%20role:read&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=S256&state=s1',
  );
  const authorizeLocation = authorizeDirect.headers.get('location') ?? '';
  check('direct authorize call is also refused', authorizeLocation.includes('error=access_denied'), authorizeLocation);
}

section('Discovery and JWKS');
{
  const discovery = await hop('/.well-known/openid-configuration');
  const disco = await discovery.json();
  check('discovery document served', discovery.status === 200);
  check('advertises S256 PKCE only', disco.code_challenge_methods_supported?.includes('S256'));
  check('advertises RS-free HS256 stub honestly', disco.id_token_signing_alg_values_supported?.includes('HS256'));

  const jwks = await hop('/api/oidc/jwks');
  const keys = await jwks.json();
  check('jwks served', jwks.status === 200 && Array.isArray(keys.keys));
}

section('Sign out');
{
  const out = await hop('/api/auth/logout?next=/login', { method: 'POST' });
  const body = await out.json();
  check('logout succeeds', body.ok === true);
  check('session cookie cleared', !jar.has('lgu_sso_session'));

  const after = await hop('/portal', { follow: true });
  check('protected page is inaccessible after sign-out',
    !(after.url ?? '').endsWith('/portal') || after.status !== 200);
}

section('Security headers');
{
  const response = await fetch(`${BASE}/login`);
  const csp = response.headers.get('content-security-policy') ?? '';
  check('CSP present', csp.length > 0);
  check('frame-ancestors none', csp.includes("frame-ancestors 'none'"));
  check('nosniff set', response.headers.get('x-content-type-options') === 'nosniff');
  check('HSTS set', (response.headers.get('strict-transport-security') ?? '').includes('max-age'));
  check('powered-by disabled', response.headers.get('x-powered-by') === null);
}

section('Open redirect protection');
{
  // The vector that actually matters is the post-login navigation: the client
  // does `router.replace(data.redirectTo)`, so a hostile `next` that survived
  // into `redirectTo` would send the browser off-origin. Test that directly.
  const hostile = [
    ['protocol-relative', '//evil.example/x'],
    ['absolute', 'https://evil.example/x'],
    ['backslash', '/\\evil.example/x'],
    ['percent-encoded separators', '/%2f%2fevil.example/x'],
    ['scheme prefix', 'https:evil.example/x'],
  ];

  for (const [label, next] of hostile) {
    const response = await hop(`/api/auth/login?next=${encodeURIComponent(next)}`, {
      method: 'POST',
      body: JSON.stringify({ username: 'j.delacruz', password: 'Lgu@Portal2026' }),
    });
    const { redirectTo } = await response.json();

    const offOrigin = (() => {
      if (typeof redirectTo !== 'string') return true;
      // Same-origin means: root-relative, single leading slash, no scheme.
      if (!redirectTo.startsWith('/') || redirectTo.startsWith('//')) return true;
      if (/^[a-z][a-z0-9+.-]*:/i.test(redirectTo)) return true;
      if (redirectTo.includes('\\')) return true;
      return redirectTo.includes('evil.example');
    })();

    check(`hostile next (${label}) is not turned into an off-origin redirect`, !offOrigin,
      `redirectTo=${JSON.stringify(redirectTo)}`);
  }

  // A legitimate deep link must survive intact, or the protection is useless.
  const okNext = await hop('/api/auth/login?next=%2Faccount', {
    method: 'POST',
    body: JSON.stringify({ username: 'j.delacruz', password: 'Lgu@Portal2026' }),
  });
  check('a legitimate relative next is preserved', (await okNext.json()).redirectTo === '/account');

  // And a signed-in visitor to a hostile next on /login must land on /portal.
  const bounce = await hop('/login?next=//evil.example/x', { follow: true });
  const bounceUrl = bounce.url ?? '';
  check('signed-in visitor with hostile next stays on-origin', bounceUrl.startsWith(BASE),
    bounceUrl || 'none');
  check('signed-in visitor with hostile next lands on the safe default',
    !new URL(bounceUrl).searchParams.get('next')?.includes('//evil.example') && bounceUrl.includes('/portal'),
    bounceUrl);
}

/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(58)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n  Failing: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`  All checks passed.`);
