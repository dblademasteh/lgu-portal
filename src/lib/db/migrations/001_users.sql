-- users table for the LGU Portal
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) UNIQUE NOT NULL,
  username VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  title VARCHAR(128),
  department VARCHAR(128) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT '{}',
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  phone_last4 VARCHAR(4) NOT NULL DEFAULT '0000',
  office TEXT,
  password_hash TEXT NOT NULL,
  time_zone VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
  avatar_hue INTEGER NOT NULL DEFAULT 0,
  last_sign_in TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  auth_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amr TEXT[] NOT NULL DEFAULT '{}',
  mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ip VARCHAR(64),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
