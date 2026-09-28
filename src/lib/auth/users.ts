/**
 * Demo user directory.
 *
 * This is a STUB directory. In production these records come from the LGU HR
 * system or a real IdP (Keycloak / Entra ID / Google Workspace) and passwords
 * never touch the portal at all — see README "Wiring a real IdP".
 *
 * The demo password is hashed with scrypt on first import and cached in-module,
 * so no plaintext digest is committed to the repository.
 *
 * When IDP_ISSUER is set, the portal also supports authentication against an
 * external OIDC provider. IdP users are synced into the local directory so
 * the rest of the app (guards, admin, systems) continues to work unchanged.
 */

import { hashPassword, randomToken, verifyPassword } from './crypto';
import { isIdPEnabled, type IdPUser } from '../idp/client';
import {
  findUserByUsernameDb as dbFindUserByUsername,
  findUserByIdDb as dbFindUserById,
  listUsersDb as dbListUsers,
  authenticateDb as dbAuthenticate,
  updateUserRecordDb as dbUpdateUserRecord,
  lockUserRecordDb as dbLockUserRecord,
  unlockUserRecordDb as dbUnlockUserRecord,
  resetUserMfaRecordDb as dbResetUserMfaRecord,
  syncIdPUserDb as dbSyncIdPUser,
  dbIsConfigured,
} from '../db/users';

import { query } from '../db/client';

/** Coarse role used for system-level authorization. */
export const ROLES = ['employee', 'supervisor', 'admin', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export type Department =
  | 'Human Resource Management Office'
  | 'Finance & Budget Office'
  | 'Planning & Development Office'
  | 'General Services Office'
  | 'Information & Communications Technology Office'
  | 'City Health Office'
  | 'Office of the City Mayor'
  | 'City Environment Office';

export type UserRecord = {
  id: string;
  employeeId: string;
  username: string;
  email: string;
  displayName: string;
  title: string;
  department: Department;
  roles: Role[];
  /** Set only for the demo accounts that use the OTP second factor. */
  mfaEnabled: boolean;
  phoneLast4: string;
  office: string;
  passwordHash: string;
  /** Local-time zone label shown on the account page. */
  timeZone: string;
  avatarHue: number;
  lastSignIn?: number;
};

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? (() => { throw new Error('DEMO_PASSWORD environment variable must be set.'); })();

const USER_SEED: Array<
  Omit<UserRecord, 'passwordHash'> & { password: string }
> = [
  {
    id: 'usr_8f2a41c7',
    employeeId: 'LGU-2019-0417',
    username: 'admin',
    email: 'ict.helpdesk@lgu.gov.ph',
    displayName: 'Rowena M. Bautista',
    title: 'Portal Systems Administrator',
    department: 'Information & Communications Technology Office',
    roles: ['admin', 'employee'],
    mfaEnabled: false,
    phoneLast4: '4417',
    office: 'ICT Building, 3rd Floor',
    timeZone: 'Asia/Manila',
    avatarHue: 239,
    password: DEMO_PASSWORD,
  },
  {
    id: 'usr_1c9d33ae',
    employeeId: 'LGU-2016-0128',
    username: 'r.santos',
    email: 'rm.santos@lgu.gov.ph',
    displayName: 'Ricardo D. Santos',
    title: 'City Treasurer',
    department: 'Finance & Budget Office',
    roles: ['supervisor', 'employee'],
    mfaEnabled: true,
    phoneLast4: '7720',
    office: 'Main Building, Ground Floor',
    timeZone: 'Asia/Manila',
    avatarHue: 190,
    password: DEMO_PASSWORD,
  },
  {
    id: 'usr_5b73e210',
    employeeId: 'LGU-2021-0933',
    username: 'j.delacruz',
    email: 'hr.delacruz@lgu.gov.ph',
    displayName: 'Jenna P. dela Cruz',
    title: 'HRMO III',
    department: 'Human Resource Management Office',
    roles: ['employee'],
    mfaEnabled: false,
    phoneLast4: '2091',
    office: 'HR Building, 2nd Floor',
    timeZone: 'Asia/Manila',
    avatarHue: 268,
    password: DEMO_PASSWORD,
  },
  {
    id: 'usr_3e05a9b7',
    employeeId: 'LGU-2018-0755',
    username: 'audit',
    email: 'audit@lgu.gov.ph',
    displayName: 'Internal Audit Service',
    title: 'Audit & Records Officer',
    department: 'Office of the City Mayor',
    roles: ['auditor'],
    mfaEnabled: false,
    phoneLast4: '5518',
    office: 'Main Building, 2nd Floor',
    timeZone: 'Asia/Manila',
    avatarHue: 38,
    password: DEMO_PASSWORD,
  },
  {
    id: 'usr_9a4c60de',
    employeeId: 'LGU-2022-1104',
    username: 'locked',
    email: 'pending.user@lgu.gov.ph',
    displayName: 'Pending Activation Account',
    title: 'Contractual appointee',
    department: 'General Services Office',
    roles: ['employee'],
    mfaEnabled: false,
    phoneLast4: '0000',
    office: 'Awaiting HRMO clearance',
    timeZone: 'Asia/Manila',
    avatarHue: 350,
    password: DEMO_PASSWORD,
  },
];

/**
 * The `locked` account exists to demonstrate the locked-state branch of the
 * login flow. Deleting it removes the demo of that path.
 */
export const LOCKED_USER_ID = 'usr_9a4c60de';

/** Accounts that are administratively disabled and cannot sign in. */
const DISABLED_USER_IDS = new Set<string>([LOCKED_USER_ID]);

export type DirectoryUser = Omit<UserRecord, 'passwordHash'> & {
  mfaEnabled: boolean;
  /**
   * Permanent administrative disable. Backed by the `disabled` column when a
   * database is configured, and by DISABLED_USER_IDS in the in-memory stub.
   * This was previously a cast-in property read as `user.id === LOCKED_USER_ID`,
   * so the admin list showed the seeded demo id's state for every account.
   */
  locked: boolean;
};

// Password hashing is ~100ms and async, but the directory must be readable
// synchronously from route handlers. Hash once on first module load.
const usersPromise = (async (): Promise<UserRecord[]> => {
  const hashed = await Promise.all(
    USER_SEED.map(async (seed) => {
      const { password, ...rest } = seed;
      return { ...rest, passwordHash: await hashPassword(password) };
    }),
  );
  return hashed;
})();

export async function listUsers(): Promise<DirectoryUser[]> {
  const dbUsers = await dbListUsers();
  // `dbUsers.length > 0` was the wrong test: an empty but healthy database
  // reported zero rows and the request was answered from the seed. That is the
  // state a failed migration leaves behind, so the empty case is the dangerous
  // one. Decide from configuration instead -- dbListUsers throws if a
  // configured database is unusable.
  if (dbIsConfigured() || dbUsers.length > 0) return dbUsers;
  const users = await usersPromise;
  return users.map(({ passwordHash: _passwordHash, ...user }) => ({
    ...user,
    locked: DISABLED_USER_IDS.has(user.id),
  }));
}

export async function findUserByUsername(
  username: string,
): Promise<{ user: UserRecord; disabled: boolean } | null> {
  const dbResult = await dbFindUserByUsername(username);
  if (dbResult) {
    return { user: dbResult.user as UserRecord, disabled: dbResult.disabled };
  }
  // A configured database is authoritative: "not in the database" is a final
  // answer. Falling through to the seed here meant an empty or unmigrated
  // database answered every login from the hardcoded demo directory, including
  // `admin` on the shared demo password, while readiness reported the database
  // as healthy.
  if (dbIsConfigured()) return null;
  const users = await usersPromise;
  const normalized = username.trim().toLowerCase();
  const user = users.find((candidate) => candidate.username.toLowerCase() === normalized);
  if (!user) return null;
  return { user, disabled: DISABLED_USER_IDS.has(user.id) };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const dbUser = await dbFindUserById(id);
  if (dbUser) {
    return { ...dbUser, locked: dbUser.disabled } as UserRecord;
  }
  if (dbIsConfigured()) return null;
  const users = await usersPromise;
  const found = users.find((user) => user.id === id);
  if (!found) return null;
  return { ...found, locked: isDisabled(id) } as UserRecord;
}

export async function authenticate(
  username: string,
  password: string,
): Promise<{ user: UserRecord; disabled: boolean } | null> {
  const dbResult = await dbAuthenticate(username, password);
  if (dbResult) {
    return { user: dbResult.user as UserRecord, disabled: dbResult.disabled };
  }
  // See findUserByUsername: with a database configured, a miss is a miss.
  if (dbIsConfigured()) {
    await verifyPassword(password, `scrypt$${userHashParams()}$AAAA$AAAA`);
    return null;
  }
  const found = await findUserByUsername(username);
  if (!found) {
    await verifyPassword(password, `scrypt$${userHashParams()}$AAAA$AAAA`);
    return null;
  }
  const valid = await verifyPassword(password, found.user.passwordHash);
  if (!valid) return null;
  return found;
}

/** Cost parameters for the dummy hash used to equalise unknown-user timing. */
function userHashParams(): string {
  return [32_768, 8, 1].join('$');
}

export function isDisabled(userId: string): boolean {
  return DISABLED_USER_IDS.has(userId);
}

export const DEMO_CREDENTIALS = {
  username: 'admin',
  password: DEMO_PASSWORD,
  note: 'Every seeded account shares this demo password. Set DEMO_PASSWORD to override.',
} as const;

export const DEMO_ACCOUNTS = USER_SEED.map((seed) => ({
  username: seed.username,
  displayName: seed.displayName,
  title: seed.title,
  roles: seed.roles,
  mfaEnabled: seed.mfaEnabled,
  locked: seed.id === LOCKED_USER_ID,
}));

/** Return all users for admin listing. */
export async function listAllUsers(): Promise<Array<{
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: Role[];
  mfaEnabled: boolean;
  locked: boolean;
  lastSignIn?: number;
}>> {
  const dbUsers = await dbListUsers();
  if (dbIsConfigured() || dbUsers.length > 0) {
    return dbUsers.map((u: DirectoryUser) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      roles: u.roles as Role[],
      mfaEnabled: u.mfaEnabled,
      locked: u.locked,
      lastSignIn: u.lastSignIn,
    }));
  }
  const users = await usersPromise;
  return users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    roles: user.roles,
    mfaEnabled: user.mfaEnabled,
    locked: DISABLED_USER_IDS.has(user.id),
    lastSignIn: user.lastSignIn,
  }));
}

/** Update user record */
export async function updateUserRecord(
  userId: string,
  data: { displayName?: string; email?: string; roles?: Role[]; locked?: boolean; mfaEnabled?: boolean; passwordHash?: string }
): Promise<void> {
  const dbAvailable = await import('../db/client').then((m) => m.getPool()).then((p) => p !== null);
  if (dbAvailable) {
    await dbUpdateUserRecord(userId, data as any);
    return;
  }
  const users = await usersPromise;
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  const user = users[idx]!;
  if (data.displayName !== undefined) user.displayName = data.displayName;
  if (data.email !== undefined) user.email = data.email;
  if (data.roles !== undefined) user.roles = data.roles;
  if (data.locked !== undefined) {
    if (data.locked) DISABLED_USER_IDS.add(userId);
    else DISABLED_USER_IDS.delete(userId);
  }
  if (data.mfaEnabled !== undefined) user.mfaEnabled = data.mfaEnabled;
  if (data.passwordHash !== undefined) user.passwordHash = data.passwordHash;
}

/** Lock a user account */
export async function lockUserRecord(userId: string): Promise<void> {
  const dbAvailable = await import('../db/client').then((m) => m.getPool()).then((p) => p !== null);
  if (dbAvailable) {
    await dbLockUserRecord(userId);
    return;
  }
  await updateUserRecord(userId, { locked: true });
}

/** Unlock a user account */
export async function unlockUserRecord(userId: string): Promise<void> {
  const dbAvailable = await import('../db/client').then((m) => m.getPool()).then((p) => p !== null);
  if (dbAvailable) {
    await dbUnlockUserRecord(userId);
    return;
  }
  await updateUserRecord(userId, { locked: false });
}

/** Reset MFA for a user */
export async function resetUserMfaRecord(userId: string): Promise<void> {
  const dbAvailable = await import('../db/client').then((m) => m.getPool()).then((p) => p !== null);
  if (dbAvailable) {
    await dbResetUserMfaRecord(userId);
    return;
  }
  await updateUserRecord(userId, { mfaEnabled: false });
}

/* ------------------------------------------------------------------ */
/* External IdP support                                                */
/* ------------------------------------------------------------------ */

/**
 * Create or update a local user record from IdP userinfo.
 *
 * IdP users are keyed by `idp_<sub>` so they cannot collide with the seeded
 * stub accounts. Existing records are updated in place so admin-assigned roles
 * and other local metadata are preserved.
 */
export async function syncIdPUser(userinfo: IdPUser): Promise<UserRecord> {
  try {
    const dbUser = await dbSyncIdPUser(userinfo);
    const { lastSignIn: _lastSignIn, ...rest } = dbUser;
    return {
      ...rest,
      lastSignIn: dbUser.lastSignIn ?? undefined,
    } as UserRecord;
  } catch {
    // Fallback to stub sync if DB is not available
    const sub = userinfo.sub;
    const userId = `idp_${sub}`;
    const username = userinfo.preferredUsername ?? userinfo.email ?? sub;
    const email = userinfo.email ?? `${sub}@idp.local`;
    const displayName = userinfo.name ?? username;

    const users = await usersPromise;
    const existingIdx = users.findIndex((u) => u.id === userId);
    if (existingIdx >= 0) {
      const existing = users[existingIdx]!;
      if (userinfo.name && existing.displayName !== userinfo.name) {
        existing.displayName = userinfo.name;
      }
      if (userinfo.email && existing.email !== userinfo.email) {
        existing.email = userinfo.email;
      }
      if (userinfo.preferredUsername && existing.username !== userinfo.preferredUsername) {
        existing.username = userinfo.preferredUsername;
      }
      return existing;
    }

    const newUser: UserRecord = {
      id: userId,
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
      timeZone: 'Asia/Manila',
      avatarHue: Math.floor(Math.random() * 360),
      passwordHash: await hashPassword(randomToken(32)),
      lastSignIn: Date.now(),
    };

    users.push(newUser);
    return newUser;
  }
}

/**
 * Authenticate via the external IdP.
 *
 * This is the entry point for the IdP callback flow. The portal has already
 * validated the authorization code and fetched userinfo from the IdP; here we
 * sync the user into the local directory and return a { user, disabled }
 * envelope matching the shape of the local `authenticate()` return so the
 * login route can treat both paths identically.
 */
export async function authenticateWithIdP(userinfo: IdPUser): Promise<{ user: UserRecord; disabled: boolean } | null> {
  try {
    const user = await syncIdPUser(userinfo);
    return { user, disabled: false };
  } catch {
    return null;
  }
}
