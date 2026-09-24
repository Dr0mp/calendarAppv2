-- auth.db: users, sessions, passkeys and tokens, shared by both workspaces.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','moderator','admin')),
  is_root INTEGER NOT NULL DEFAULT 0 CHECK (is_root IN (0,1)),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
  initials TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  password_hash TEXT,
  webauthn_user_id TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  locale TEXT CHECK (locale IN ('ro','en')),
  theme TEXT CHECK (theme IN ('system','light','dark')),
  last_login_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE UNIQUE INDEX users_one_root ON users(is_root) WHERE is_root = 1;

CREATE TABLE sessions (
  id TEXT NOT NULL UNIQUE,              -- public id used for listing/revoking
  id_hash TEXT PRIMARY KEY,             -- SHA-256 of the cookie value
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace TEXT NOT NULL CHECK (workspace IN ('main','demo')),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  user_agent TEXT, ip TEXT
);
CREATE INDEX sessions_by_user ON sessions(user_id);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT,
  name TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE INDEX passkeys_by_user ON passkeys(user_id);

CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT
);
CREATE INDEX auth_tokens_by_user ON auth_tokens(user_id);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE webauthn_challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','register')),
  user_id TEXT,
  expires_at TEXT NOT NULL
);
