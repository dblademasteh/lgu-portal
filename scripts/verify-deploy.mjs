/**
 * Pre-deployment verification.
 *
 * Checks that all required environment variables are set and that the
 * configuration is consistent before the container is built or deployed.
 *
 * Usage:
 *   node scripts/verify-deploy.mjs
 *   node scripts/verify-deploy.mjs --env-file .env.production
 */

import { readFileSync, existsSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';

const args = process.argv.slice(2);
const envFile = args.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length) ?? '.env.production';

if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Copy .env.production.example and fill in real values.`);
  process.exit(1);
}

const content = readFileSync(envFile, 'utf-8');
const parsed = {};
for (const line of content.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  parsed[key] = value;
}

const required = [
  'SESSION_SECRET',
  'OIDC_SIGNING_SECRET',
  'OIDC_ISSUER',
  'DATABASE_URL',
  'REDIS_URL',
  'DEMO_PASSWORD',
  'OIDC_SIGNING_PRIVATE_KEY',
];

const optional = [
  'IDP_ISSUER',
  'IDP_CLIENT_ID',
  'IDP_CLIENT_SECRET',
  'IDP_SCOPES',
  'LOCAL_LOGIN_ENABLED',
];

let failed = false;

console.log(`\nVerifying ${envFile}...\n`);

// DEMO_PASSWORD and OIDC_SIGNING_PRIVATE_KEY are checked separately below,
// with rules the generic loop cannot express.
for (const key of required.filter((k) => k !== 'DEMO_PASSWORD' && k !== 'OIDC_SIGNING_PRIVATE_KEY')) {
  const value = parsed[key]?.trim();
  if (!value) {
    console.error(`  MISSING  ${key} is required but not set.`);
    failed = true;
  } else if (key === 'SESSION_SECRET' || key === 'OIDC_SIGNING_SECRET') {
    if (value.length < 32) {
      console.error(`  INVALID  ${key} must be at least 32 characters (got ${value.length}).`);
      failed = true;
    } else {
      console.log(`  OK       ${key} (${value.length} chars)`);
    }
  } else {
    console.log(`  OK       ${key}`);
  }
}

for (const key of optional) {
  if (parsed[key]) {
    console.log(`  SET      ${key}`);
  }
}

if (parsed.IDP_ISSUER && !parsed.IDP_CLIENT_ID) {
  console.error('  MISSING  IDP_ISSUER is set but IDP_CLIENT_ID is not.');
  failed = true;
}

if (parsed.LOCAL_LOGIN_ENABLED === 'false' && !parsed.IDP_ISSUER) {
  console.error('  INVALID  LOCAL_LOGIN_ENABLED=false requires IDP_ISSUER to be set.');
  failed = true;
}

// The demo user directory is seeded with this shared password. A known value
// means the seeded admin/auditor accounts are reachable by anyone who has read
// the repo, so refuse to deploy one.
if (!parsed.DEMO_PASSWORD?.trim()) {
  console.error('  MISSING  DEMO_PASSWORD is required but not set (the user directory throws without it).');
  failed = true;
} else if (['Lgu@Portal2026', 'changeme', 'password', 'demo', 'admin'].includes(parsed.DEMO_PASSWORD)) {
  console.error('  INVALID  DEMO_PASSWORD is a well-known value; the seeded demo accounts would be reachable.');
  failed = true;
} else if (['changeme', 'password', 'demo', 'admin'].includes(parsed.DEMO_PASSWORD.toLowerCase())) {
  console.error('  INVALID  DEMO_PASSWORD is a well-known value; the seeded demo accounts would be reachable.');
  failed = true;
} else if (parsed.DEMO_PASSWORD.length < 16) {
  console.error(`  INVALID  DEMO_PASSWORD must be at least 16 characters (got ${parsed.DEMO_PASSWORD.length}).`);
  failed = true;
} else {
  console.log(`  OK       DEMO_PASSWORD (${parsed.DEMO_PASSWORD.length} chars)`);
}

// The RS256 signing key must be the same on every replica. If it is missing,
// each pod generates its own at boot and `GET /api/oidc/jwks` publishes
// whichever one answers, so a client that cached the set rejects valid tokens.
if (!parsed.OIDC_SIGNING_PRIVATE_KEY?.trim()) {
  console.error('  MISSING  OIDC_SIGNING_PRIVATE_KEY is required but not set (each replica would sign with its own key).');
  failed = true;
} else {
  const pem = parsed.OIDC_SIGNING_PRIVATE_KEY.replace(/\\n/g, '\n');
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    console.error('  INVALID  OIDC_SIGNING_PRIVATE_KEY is not a PEM private key block.');
    failed = true;
  } else {
    try {
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType !== 'rsa') {
        console.error(`  INVALID  OIDC_SIGNING_PRIVATE_KEY must be RSA (got ${key.asymmetricKeyType}).`);
        failed = true;
      } else {
        console.log('  OK       OIDC_SIGNING_PRIVATE_KEY (RSA)');
      }
    } catch (err) {
      console.error(`  INVALID  OIDC_SIGNING_PRIVATE_KEY could not be parsed: ${err.message}`);
      failed = true;
    }
  }
}

console.log('');
if (failed) {
  console.error('Deployment verification failed. Fix the errors above before deploying.');
  process.exit(1);
}

console.log('All checks passed. Configuration is ready for deployment.');
