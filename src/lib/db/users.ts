/**
 * PostgreSQL-backed user repository.
 *
 * Implements the same interface as the stub in `src/lib/auth/users.ts` so
 * the rest of the app does not need to change. When DATABASE_URL is not set,
 * the functions fall back to the in-memory stub.
 */

import { hashPassword, randomToken, verifyPassword } from '../auth/crypto';
import {
  type UserRecord,
  type DirectoryUser,
  ROLES,
  findUserByUsername as stubFindUserByUsername,
  findUserById as stubFindUserById,
  listUsers as stubListUsers,
  authenticate as stubAuthenticate,
  updateUserRecord as stubUpdateUserRecord,
  lockUserRecord as stubLockUserRecord,
  unlockUserRecord as stubUnlockUserRecord,
  resetUserMfaRecord as stubResetUserMfaRecord,
} from '../auth/users';

export type DbUser = {
  id: string;
  employeeId: string;
  username: string;
  email: string;
  displayName: string;
  title: string | null;
  department: string;
  roles: string[];
  mfaEnabled: boolean;
  phoneLast4: string;
  office: string | null;
  passwordHash: string;
  timeZone: string;
  avatarHue: number;
  lastSignIn: number | null;
  failedAttempts: number;
  lockedUntil: number | null;
  /** Permanent administrative disable. Distinct from the `lockedUntil` lockout. */
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Cached result of the last probe.
 *
 * Re-probed on a short TTL rather than cached forever. A permanent cache would
 * mean one transient blip switched the process to the demo directory for the
 * rest of its life, which is exactly the failure mode this guards against.
 */
const DB_PROBE_TTL_MS = 5_000;
let dbAvailable: boolean | null = null;
let dbProbedAt = 0;

async function isDbAvailable(): Promise<boolean> {
  if (dbAvailable !== null && Date.now() - dbProbedAt < DB_PROBE_TTL_MS) return dbAvailable;
  const probe = await import('./client').then((m) => m.dbProbe());
  dbAvailable = probe.ok;
  dbProbedAt = Date.now();
  return dbAvailable;
}

/**
 * True when the database can be used, and throws when it is configured but
 * broken.
 *
 * Callers treat a `null` return from the `*Db` helpers as "not found" and then
 * fall back to the seeded demo directory. That is correct when no database is
 * configured — that is the local/CI mode the demo directory exists for — but
 * wrong when `DATABASE_URL` is set and the database is merely unreachable. In
 * that case every lookup would miss, every login would silently be answered from
 * the seed, and anyone who knows the shared demo password would be an admin.
 *
 * So the distinction that matters is "no database configured" versus "database
 * configured and down", and only the second one throws. `verify-deploy.mjs`
 * refuses to deploy without `DATABASE_URL`, so in the cluster this always throws
 * rather than falling back.
 */
async function requireUsableDb(): Promise<boolean> {
  if (await isDbAvailable()) return true;
  if (!process.env.DATABASE_URL) return false;
  throw new Error(
    'User directory unavailable: DATABASE_URL is configured but the database is unreachable. ' +
      'Refusing to serve the demo directory while a real database is expected.',
  );
}

/**
 * Rethrow a query failure instead of reporting "not found".
 *
 * These helpers are called after `requireUsableDb()`, so the database is known
 * to be reachable. Any error past that point is a query-level failure -- an
 * unmigrated schema, a missing table, a permissions problem, a deadlock -- and
 * swallowing it as `null`/`[]` told the caller the user did not exist, which
 * sent the request to the seeded demo directory. An empty database is the
 * normal state right after a failed migration, so this was reachable in
 * practice: readiness reported `database: pass` and `admin` still signed in on
 * the shared demo password.
 */
function rethrowQueryFailure(operation: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `User directory query failed during ${operation}: ${detail}. ` +
      'DATABASE_URL is set, so a query error is not the same as "no such user" -- ' +
      'treating it as one would fall back to the seeded demo directory.',
    { cause: error },
  );
}

/**
 * True when a database is configured and is therefore authoritative.
 *
 * Callers used to decide "is there a database?" by checking whether the query
 * returned rows, which is indistinguishable from an empty table. The demo
 * directory must only be consulted when no database is configured at all.
 */
export function dbIsConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function rowToDbUser(row: Record<string, unknown>): DbUser {
  return {
    id: String(row.id),
    employeeId: String(row.employee_id),
    username: String(row.username),
    email: String(row.email),
    displayName: String(row.display_name),
    title: row.title ? String(row.title) : null,
    department: String(row.department),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    mfaEnabled: Boolean(row.mfa_enabled),
    phoneLast4: String(row.phone_last4 ?? '0000'),
    office: row.office ? String(row.office) : null,
    passwordHash: String(row.password_hash),
    timeZone: String(row.time_zone ?? 'Asia/Manila'),
    avatarHue: Number(row.avatar_hue ?? 0),
    lastSignIn: row.last_sign_in ? new Date(String(row.last_sign_in)).getTime() : null,
    failedAttempts: Number(row.failed_attempts ?? 0),
    lockedUntil: row.locked_until ? new Date(String(row.locked_until)).getTime() : null,
    disabled: Boolean(row.disabled),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function findUserByUsernameDb(
  username: string,
): Promise<{ user: DbUser; disabled: boolean } | null> {
  const available = await requireUsableDb();
  if (!available) return null;

  try {
    const { query } = await import('./client');
    const { rows } = await query<DbUser>(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username.trim()],
    );
    if (rows.length === 0) return null;
    const user = rowToDbUser(rows[0]!);
    return { user, disabled: user.disabled };
  } catch (error) {
    rethrowQueryFailure('findUserByUsernameDb', error);
  }
}

export async function findUserByIdDb(id: string): Promise<DbUser | null> {
  const available = await requireUsableDb();
  if (!available) return null;

  try {
    const { query } = await import('./client');
    const { rows } = await query<DbUser>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    if (rows.length === 0) return null;
    return rowToDbUser(rows[0]!);
  } catch (error) {
    rethrowQueryFailure('findUserByIdDb', error);
  }
}

export async function listUsersDb(): Promise<DirectoryUser[]> {
  const available = await requireUsableDb();
  if (!available) return [];

  try {
    const { query } = await import('./client');
    const { rows } = await query<DbUser>('SELECT * FROM users ORDER BY created_at DESC');
    return rows.map((row) => {
      const user = rowToDbUser(row);
      return {
        id: user.id,
        employeeId: user.employeeId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        title: user.title ?? '',
        department: user.department as UserRecord['department'],
        roles: user.roles as UserRecord['roles'],
        mfaEnabled: user.mfaEnabled,
        locked: user.disabled,
        phoneLast4: user.phoneLast4,
        office: user.office ?? '',
        timeZone: user.timeZone,
        avatarHue: user.avatarHue,
        lastSignIn: user.lastSignIn ?? undefined,
      };
    });
  } catch (error) {
    rethrowQueryFailure('listUsersDb', error);
  }
}

export async function authenticateDb(
  username: string,
  password: string,
): Promise<{ user: DbUser; disabled: boolean } | null> {
  const available = await requireUsableDb();
  if (!available) return null;

  try {
    const { query } = await import('./client');
    const { rows } = await query<DbUser>(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username.trim()],
    );
    if (rows.length === 0) {
      await verifyPassword(password, `scrypt$${userHashParams()}$AAAA$AAAA`);
      return null;
    }
    const user = rowToDbUser(rows[0]!);

    // Check automatic lockout
    const now = Date.now();
    if (user.lockedUntil && now < user.lockedUntil) {
      return { user, disabled: true };
    }

    // Clear lockout if expired
    if (user.lockedUntil && now >= user.lockedUntil) {
      await query('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = $1', [user.id]);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      // Increment failed attempts
      const newAttempts = (user.failedAttempts || 0) + 1;
      if (newAttempts >= 5) {
        const lockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
        await query('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [newAttempts, lockedUntil, user.id]);
      } else {
        await query('UPDATE users SET failed_attempts = $1 WHERE id = $2', [newAttempts, user.id]);
      }
      return null;
    }

    // Successful login - reset counters
    await query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_sign_in = NOW() WHERE id = $1', [user.id]);
    return { user, disabled: user.disabled };
  } catch (error) {
    rethrowQueryFailure('authenticateDb', error);
  }
}

function userHashParams(): string {
  return [32_768, 8, 1].join('$');
}

export async function unlockUserAccountDb(userId: string): Promise<void> {
  const available = await requireUsableDb();
  if (!available) return;

  try {
    const { query } = await import('./client');
    await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId]);
  } catch {
    // ignore
  }
}

export async function updateUserRecordDb(
  userId: string,
  data: {
    displayName?: string;
    email?: string;
    roles?: string[];
    locked?: boolean;
    mfaEnabled?: boolean;
    passwordHash?: string;
  },
): Promise<void> {
  const available = await requireUsableDb();
  if (!available) return;

  try {
    const { query } = await import('./client');
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`);
      params.push(data.displayName);
    }
    if (data.email !== undefined) {
      sets.push(`email = $${idx++}`);
      params.push(data.email);
    }
    if (data.roles !== undefined) {
      sets.push(`roles = $${idx++}`);
      params.push(data.roles);
    }
    if (data.mfaEnabled !== undefined) {
      sets.push(`mfa_enabled = $${idx++}`);
      params.push(data.mfaEnabled);
    }
    if (data.passwordHash !== undefined) {
      sets.push(`password_hash = $${idx++}`);
      params.push(data.passwordHash);
    }
    // `locked` is the domain term used by the admin UI and the in-memory stub;
    // it maps to the `disabled` column. It was previously accepted here and
    // then silently dropped, so lockUserRecordDb() built an UPDATE with no SET
    // clauses and returned early -- a successful-looking no-op that left the
    // account able to sign in.
    if (data.locked !== undefined) {
      sets.push(`disabled = $${idx++}`);
      params.push(data.locked);
    }

    if (sets.length === 0) return;

    params.push(userId);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  } catch (error) {
    // Swallowing this made the admin console report "User updated" for writes
    // that never landed.
    rethrowQueryFailure('updateUserRecordDb', error);
  }
}

export async function lockUserRecordDb(userId: string): Promise<void> {
  await updateUserRecordDb(userId, { locked: true });
}

export async function unlockUserRecordDb(userId: string): Promise<void> {
  await updateUserRecordDb(userId, { locked: false });
}

export async function resetUserMfaRecordDb(userId: string): Promise<void> {
  await updateUserRecordDb(userId, { mfaEnabled: false });
}

export async function syncIdPUserDb(userinfo: {
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
  roles?: string[];
}): Promise<DbUser> {
  const available = await requireUsableDb();
  if (!available) {
    throw new Error('Database not available');
  }

  const { query } = await import('./client');
  const sub = userinfo.sub;
  const username = userinfo.preferredUsername ?? userinfo.email ?? sub;
  const email = userinfo.email ?? `${sub}@idp.local`;
  const displayName = userinfo.name ?? username;

  const { rows } = await query<DbUser>(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [`idp_${sub}`],
  );

  if (rows.length > 0) {
    const user = rowToDbUser(rows[0]!);
    await query(
      'UPDATE users SET display_name = $1, email = $2, username = $3, updated_at = NOW() WHERE id = $4',
      [displayName, email, username, user.id],
    );
    return { ...user, displayName, email, username };
  }

  const newUser: DbUser = {
    id: `idp_${sub}`,
    employeeId: `IDP-${sub}`,
    username,
    email,
    displayName,
    title: 'External User',
    department: 'Information & Communications Technology Office',
    roles: ['employee'],
    mfaEnabled: false,
    disabled: false,
    phoneLast4: '0000',
    office: 'Provisioned via IdP',
    passwordHash: await hashPassword(randomToken(32)),
    timeZone: 'Asia/Manila',
    avatarHue: Math.floor(Math.random() * 360),
    lastSignIn: Date.now(),
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await query(
    `INSERT INTO users (id, employee_id, username, email, display_name, title, department, roles, mfa_enabled, phone_last4, office, password_hash, time_zone, avatar_hue, last_sign_in)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      newUser.id,
      newUser.employeeId,
      newUser.username,
      newUser.email,
      newUser.displayName,
      newUser.title,
      newUser.department,
      newUser.roles,
      newUser.mfaEnabled,
      newUser.phoneLast4,
      newUser.office,
      newUser.passwordHash,
      newUser.timeZone,
      newUser.avatarHue,
      newUser.lastSignIn,
    ],
  );

  return newUser;
}
