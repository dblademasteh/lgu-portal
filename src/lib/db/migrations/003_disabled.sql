-- Permanent administrative disable.
--
-- Account state previously had no column at all. `disabled` was computed as
-- `user.id === LOCKED_USER_ID` against a hardcoded seeded demo id, so locking
-- a real account was impossible by construction, and lockUserRecordDb() passed
-- `{ locked: true }` into a builder that had nowhere to put it -- the UPDATE
-- built zero SET clauses and returned early, so the admin UI reported success
-- while the user kept logging in.
--
-- This is distinct from locked_until, which is the short automatic lockout
-- after failed sign-in attempts (migration 002).
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_disabled ON users(disabled);
