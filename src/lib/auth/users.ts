/**
 * Demo user directory.
 *
 * This is a STUB directory. In production these records come from the LGU HR
 * system or a real IdP (Keycloak / Entra ID / Google Workspace) and passwords
 * never touch the portal at all — see README "Wiring a real IdP".
 *
 * The demo password is hashed with scrypt on first import and cached in-module,
 * so no plaintext digest is committed to the repository.
 */

import { hashPassword, verifyPassword } from './crypto';

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

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Lgu@Portal2026';

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

export type DirectoryUser = Omit<UserRecord, 'passwordHash'> & { mfaEnabled: boolean };

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
  const users = await usersPromise;
  return users.map(({ passwordHash: _passwordHash, ...user }) => user);
}

export async function findUserByUsername(
  username: string,
): Promise<{ user: UserRecord; disabled: boolean } | null> {
  const users = await usersPromise;
  const normalized = username.trim().toLowerCase();
  const user = users.find((candidate) => candidate.username.toLowerCase() === normalized);
  if (!user) return null;
  return { user, disabled: DISABLED_USER_IDS.has(user.id) };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const users = await usersPromise;
  return users.find((user) => user.id === id) ?? null;
}

export async function authenticate(
  username: string,
  password: string,
): Promise<{ user: UserRecord; disabled: boolean } | null> {
  const found = await findUserByUsername(username);
  if (!found) {
    // Hash anyway on the unknown-user path so response time does not reveal
    // whether the username exists. Cost matches a real verification.
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
  data: { displayName?: string; email?: string; roles?: Role[]; locked?: boolean; mfaEnabled?: boolean }
): Promise<void> {
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
}

/** Lock a user account */
export async function lockUserRecord(userId: string): Promise<void> {
  await updateUserRecord(userId, { locked: true });
}

/** Unlock a user account */
export async function unlockUserRecord(userId: string): Promise<void> {
  await updateUserRecord(userId, { locked: false });
}

/** Reset MFA for a user */
export async function resetUserMfaRecord(userId: string): Promise<void> {
  await updateUserRecord(userId, { mfaEnabled: false });
}
