/**
 * End-to-end check of the SSO flow against a running server.
 *
 * Not a substitute for a real test suite — it is a smoke test that walks the
 * actual HTTP path a browser takes, because the interesting failures in an
 * authorization-code flow (replayed codes, PKCE mismatch, state mismatch,
 * audience confusion) live in the wiring between endpoints, not in any one unit.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 *
 * The server must be started with a HOSTNAME that matches OIDC_ISSUER, e.g.
 *   OIDC_ISSUER=http://localhost:3000 HOSTNAME=localhost npm start
 * See the preflight below for why.
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

// The demo accounts all share DEMO_PASSWORD. Read it from the environment
// rather than hardcoding it, so the suite works against whatever value the
// server was actually started with — and so a real password never has to be
// committed to the repo to keep CI green.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Lgu@Portal2026';

// The account this suite signs in as. Its employee_id is what proves claims
// actually crossed the token boundary to the downstream app.
const SIGNIN_EMPLOYEE_ID = 'LGU-2021-0933';

// The registered redirect_uri is built server-side from OIDC_ISSUER, not from
// where this script happens to connect. Read the issuer off the discovery
// document so the hardening checks below construct requests that are valid
// against whatever the server is actually configured with — hardcoding
// `localhost:3000` silently turned every redirect_uri check into a no-op on any
// other issuer.
const discoveryDoc = await (await fetch(`${BASE}/.well-known/openid-configuration`)).json();
const ISSUER = discoveryDoc.issuer;
const CALLBACK = `${ISSUER}/api/oidc/callback`;

// If the server is configured with a non-local issuer, the authorize redirects
// below point at a host that does not resolve from here, and the failure looks
// like a DNS bug rather than a misconfiguration. Say so explicitly.
if (!ISSUER.includes('localhost') && !ISSUER.includes('127.0.0.1')) {
  console.error(
    `\n  Server advertises issuer ${ISSUER}, which is not local.\n` +
    `  OIDC_ISSUER must be a local address for this suite (it follows the\n` +
    `  authorize redirect). Set OIDC_ISSUER=http://localhost:3000 and retry.\n`,
  );
  process.exit(1);
}

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
async function hop(url, { follow = false, method = 'GET', body, form } = {}) {
  // A null URL here used to throw a bare TypeError that aborted the whole
  // suite, so one failed check hid every check after it. Fail loudly instead.
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(`hop() called with ${url === null ? 'null' : JSON.stringify(url)}: no redirect location to follow`);
  }
  const response = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: jar.header(),
      ...(body ? { 'content-type': 'application/json' } : {}),
      // Forms submit as urlencoded, not JSON. Driving the real consent form
      // means sending the same content-type a browser would.
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ?? form,
  });
  jar.absorb(response);
  if (follow && response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) return hop(location, { follow: true });
  }
  return response;
}

/** Hidden form values arrive HTML-escaped; decode before re-posting them. */
function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
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
    body: JSON.stringify({ username: 'locked', password: DEMO_PASSWORD }),
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
    body: JSON.stringify({ username: 'r.santos', password: DEMO_PASSWORD }),
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
    body: JSON.stringify({ username: 'j.delacruz', password: DEMO_PASSWORD }),
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

// The callback rebuilds its redirect_uri from `request.url`, which under
// `next start` is the host the server was told to bind to (HOSTNAME), not the
// Host header that was actually used to reach it. If that bind host differs
// from ISSUER, the code is issued against one redirect_uri and redeemed against
// another and the callback dies with `invalid_grant` — which reads like a token
// bug rather than a misconfigured test server.
//
// The authorize redirect echoes its own idea of the origin back in `iss`, so
// probe that first and explain the failure instead of letting it surface as an
// opaque grant error twenty assertions later.
{
  // Carries state/nonce so the request reaches the happy path and actually
  // emits `iss`; without them it errors out first and the probe learns nothing.
  const probe = await hop(`/api/oidc/authorize?client_id=lgu-hris&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code&scope=openid&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=S256&state=preflight&nonce=preflight&consent=approved`);
  const seen = new URL(probe.headers.get('location') ?? BASE, BASE).searchParams.get('iss');
  if (seen && seen !== ISSUER) {
    console.error(
      `\n  Server binds as ${seen} but OIDC_ISSUER is ${ISSUER}.\n` +
      `  The callback rebuilds redirect_uri from the bind host, so the flow\n` +
      `  cannot complete. Start the server with:\n` +
      `      HOSTNAME=${new URL(ISSUER).hostname} npm start\n`,
    );
    process.exit(1);
  }
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

  // Consent is a real step in this flow, not a formality: authorize redirects
  // to /consent unless the request already carries consent=approved. Assert the
  // gate holds, then actually POST the consent form the way the browser does.
  //
  // It is tempting to skip the form and re-request the original launch URL with
  // consent=approved appended. That is what this suite used to do, and it hid a
  // fatal bug: the real approve path rebuilt the authorize URL from four
  // hand-copied fields and dropped response_type and the PKCE challenge, so
  // every genuine first login failed while the suite stayed green. The form has
  // to be driven for real or this check proves nothing.
  const consentGate = await hop(launchUrl);
  const consentLocation = consentGate.headers.get('location') ?? '';
  check('authorize withholds the code until consent is granted',
    (consentGate.status === 302 || consentGate.status === 307) && consentLocation.includes('/consent'),
    consentLocation || 'no location');
  check('no authorization code leaks before consent',
    !new URL(consentLocation || BASE, BASE).searchParams.has('code'));

  // The consent screen must render and carry the authorize request forward.
  const consentPage = await hop(consentLocation);
  const consentHtml = await consentPage.text();
  check('consent screen renders', consentPage.status === 200, `got ${consentPage.status}`);
  check('consent form replays the authorize request', /name="request" value="[^"]+"/.test(consentHtml));

  const replay = consentHtml.match(/name="request" value="([^"]*)"/)?.[1];
  if (!replay) {
    check('authorization code issued', false, 'consent form carried no request field');
    check('callback redirects to the downstream app', false, 'skipped, no replay');
    check('downstream app renders', false, 'skipped, no replay');
    check('claims reached the downstream app', false, 'skipped, no replay');
    check('granted scopes are shown', false, 'skipped, no replay');
  } else {
    const approved = await hop('/api/oidc/consent', {
      method: 'POST',
      form: new URLSearchParams({ request: decodeHtmlEntities(replay) }).toString(),
    });
    check('consent approval redirects back to authorize',
      (approved.headers.get('location') ?? '').includes('/api/oidc/authorize'),
      approved.headers.get('location') ?? 'no location');

    const authorized = await hop(approved.headers.get('location') ?? BASE);
    check('authorize endpoint redirects once consent is granted', authorized.status === 302, `got ${authorized.status}`);

    const callbackLocation = authorized.headers.get('location');
    if (!callbackLocation) {
      check('authorization code issued', false, 'no redirect location');
      check('callback redirects to the downstream app', false, 'no redirect location');
      check('downstream app renders', false, 'skipped, no callback');
      check('claims reached the downstream app', false, 'skipped, no callback');
      check('granted scopes are shown', false, 'skipped, no callback');
    } else {
      const callbackUrl = new URL(callbackLocation, BASE);
      code = callbackUrl.searchParams.get('code');
      check('authorization code issued', Boolean(code));
      check('state echoed back', callbackUrl.searchParams.get('state') === params.get('state'));

      const landed = await hop(callbackUrl.toString());
      const appLocation = landed.headers.get('location');
      // An `invalid_grant` here is almost always the bind-host mismatch the
      // preflight guards against, so name the cause rather than the symptom.
      const hint = (appLocation ?? '').includes('invalid_grant')
        ? `invalid_grant — server binds as ${callbackUrl.searchParams.get('iss') ?? '?'}, ` +
          `OIDC_ISSUER is ${ISSUER}; start with HOSTNAME=${new URL(ISSUER).hostname}`
        : appLocation ?? 'none';
      check('callback redirects to the downstream app',
        (appLocation ?? '').includes('/launch/hris/app'), hint);

      if (!appLocation) {
        check('downstream app renders', false, 'skipped, no app redirect');
        check('claims reached the downstream app', false, 'skipped, no app redirect');
        check('granted scopes are shown', false, 'skipped, no app redirect');
      } else {
        const app = await hop(appLocation);
        check('downstream app renders', app.status === 200, `got ${app.status}`);
        const appHtml = await app.text();
        check('claims reached the downstream app', appHtml.includes(SIGNIN_EMPLOYEE_ID));
        check('granted scopes are shown', appHtml.includes('profile:read'));
      }
    }
  }
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

section('Consent denial');
{
  // A different client, because consent for lgu-hrms was just granted above and
  // would short-circuit the screen. `gis` is one of the systems this account
  // can actually launch. Denial used to come back as
  // error=unsupported_response_type for the same reason approval did: the
  // handler rebuilt the authorize request from a partial field set.
  //
  // Two hops: /launch redirects to /api/oidc/authorize, and only authorize
  // decides whether the consent screen is required.
  const launch = await hop('/launch/gis');
  const authorize = await hop(launch.headers.get('location') ?? BASE);
  const consentLocation = authorize.headers.get('location') ?? '';
  if (!consentLocation.includes('/consent')) {
    check('denial path is reachable', false, `expected /consent, got ${consentLocation || 'none'}`);
  } else {
    const page = await hop(consentLocation);
    const html = await page.text();
    const request = html.match(/href="\/api\/oidc\/consent\/deny\?request=([^"]+)"/)?.[1];
    check('consent screen offers a deny path', Boolean(request));

    if (request) {
      const denied = await hop(`/api/oidc/consent/deny?request=${decodeHtmlEntities(request)}`);
      const back = await hop(denied.headers.get('location') ?? BASE);
      const final = back.headers.get('location') ?? '';
      check('denial reaches the client as access_denied', final.includes('error=access_denied'), final);
      check('denial is not mistaken for a protocol error', !final.includes('unsupported_response_type'), final);
      check('no code is issued on denial', !new URL(final, BASE).searchParams.has('code'));
    }
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
    `/api/oidc/authorize?client_id=lgu-hris&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code&scope=openid&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=plain`,
  );
  const location = plainPkce.headers.get('location') ?? '';
  check('PKCE method downgrade to plain is refused', location.includes('error=invalid_request'), location);

  const noPkce = await hop(
    `/api/oidc/authorize?client_id=lgu-hris&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code&scope=openid`,
  );
  check('public client without PKCE is refused',
    (noPkce.headers.get('location') ?? '').includes('error=invalid_request'),
    noPkce.headers.get('location') ?? 'none');

  // The challenge must be a well-formed one (43-128 chars) or the PKCE length
  // check rejects the request first and this would never exercise the scope
  // check at all.
  const badScope = await hop(
    `/api/oidc/authorize?client_id=lgu-hris&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code&scope=openid%20admin:everything&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=S256`,
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
    `/api/oidc/authorize?client_id=lgu-iam&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code&scope=openid%20role:read&code_challenge=abcdefghijklmnopqrstuvwxyz1234567890abcdefgh&code_challenge_method=S256&state=s1`,
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
  // Was an assertion that RS256 was NOT offered, written while signing was still
  // HS256. The server now signs RS256 against its key ring (src/lib/oidc.ts),
  // so the old check passed only against a downgrade.
  check('advertises RS256 for id_token signing',
    disco.id_token_signing_alg_values_supported?.includes('RS256'),
    JSON.stringify(disco.id_token_signing_alg_values_supported));
  check('no longer advertises the symmetric HS256 downgrade',
    !disco.id_token_signing_alg_values_supported?.includes('HS256'),
    JSON.stringify(disco.id_token_signing_alg_values_supported));

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
      body: JSON.stringify({ username: 'j.delacruz', password: DEMO_PASSWORD }),
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
    body: JSON.stringify({ username: 'j.delacruz', password: DEMO_PASSWORD }),
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
