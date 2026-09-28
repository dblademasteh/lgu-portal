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

for (const key of required) {
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

console.log('');
if (failed) {
  console.error('Deployment verification failed. Fix the errors above before deploying.');
  process.exit(1);
}

console.log('All checks passed. Configuration is ready for deployment.');
