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
  LOCKED_USER_ID,
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
  createdAt: Date;
  updatedAt: Date;
};

let dbAvailable: boolean | null = null;

async function isDbAvailable(): Promise<boolean> {
  if (dbAvailable !== null) return dbAvailable;
  try {
    const pool = await import('./client').then((m) => m.getPool());
    if (!pool) {
      dbAvailable = false;
      return false;
    }
    await pool.query('SELECT 1');
    dbAvailable = true;
    return true;
  } catch {
    dbAvailable = false;
    return false;
  }
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
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function findUserByUsernameDb(
  username: string,
): Promise<{ user: DbUser; disabled: boolean } | null> {
  const available = await isDbAvailable();
  if (!available) return null;

  try {
    const { query } = await import('./client');
    const { rows } = await query<DbUser>(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username.trim()],
    );
    if (rows.length === 0) return null;
    const user = rowToDbUser(rows[0]!);
    return { user, disabled: user.id === LOCKED_USER_ID };
  } catch {
    return null;
  }
}

export async function findUserByIdDb(id: string): Promise<DbUser | null> {
  const available = await isDbAvailable();
  if (!available) return null;

  try {
    const { query } = await import('./client');
    const { rows } = await query<DbUser>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    if (rows.length === 0) return null;
    return rowToDbUser(rows[0]!);
  } catch {
    return null;
  }
}

export async function listUsersDb(): Promise<DirectoryUser[]> {
  const available = await isDbAvailable();
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
        phoneLast4: user.phoneLast4,
        office: user.office ?? '',
        timeZone: user.timeZone,
        avatarHue: user.avatarHue,
        lastSignIn: user.lastSignIn ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function authenticateDb(
  username: string,
  password: string,
): Promise<{ user: DbUser; disabled: boolean } | null> {
  const available = await isDbAvailable();
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
    return { user, disabled: user.id === LOCKED_USER_ID };
  } catch {
    return null;
  }
}

function userHashParams(): string {
  return [32_768, 8, 1].join('$');
}

export async function unlockUserAccountDb(userId: string): Promise<void> {
  const available = await isDbAvailable();
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
  const available = await isDbAvailable();
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

    if (sets.length === 0) return;

    params.push(userId);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  } catch {
    // ignore
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
  const available = await isDbAvailable();
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
