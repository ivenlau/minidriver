-- MiniDriver 初始 schema（对应 DESIGN.md §4.1）

PRAGMA foreign_keys = ON;

-- 单用户表（保留扩展性）
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT '',
  password_hash    TEXT,
  totp_secret_enc  TEXT,
  totp_enabled     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE webauthn_credentials (
  id           TEXT PRIMARY KEY,            -- base64url(credentialID)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  public_key   BLOB NOT NULL,               -- COSE 公钥
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  backed_up    INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX ix_webauthn_user ON webauthn_credentials(user_id);

CREATE TABLE recovery_codes (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at   INTEGER
);
CREATE INDEX ix_recovery_user ON recovery_codes(user_id);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,            -- sha256(token)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT,
  ip_country   TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

-- 通用失败锁定（key 形如 'pw:<userId>' / 'totp:<userId>' / 'recover'）
CREATE TABLE auth_locks (
  key          TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at   INTEGER NOT NULL
);

-- 文件/目录统一节点表（邻接表 + 软删除）
CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,              -- ULID
  type       TEXT NOT NULL CHECK (type IN ('file','folder')),
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES nodes(id) ON DELETE CASCADE,  -- NULL = 根目录
  size       INTEGER,                       -- 仅 file；NULL = 上传未完成（列表中隐藏）
  mime       TEXT,
  r2_key     TEXT,
  thumb_key  TEXT,
  sha256     TEXT,
  starred    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX ux_nodes_name
  ON nodes(parent_id, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_nodes_parent ON nodes(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_nodes_starred ON nodes(starred) WHERE starred = 1 AND deleted_at IS NULL;
CREATE INDEX ix_nodes_trash  ON nodes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX ix_nodes_recent ON nodes(created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE shares (
  id             TEXT PRIMARY KEY,
  node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,      -- sha256(token)；明文仅创建时返回一次
  password_hash  TEXT,
  expires_at     INTEGER,
  max_downloads  INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  locked_until   INTEGER,
  revoked_at     INTEGER,
  created_at     INTEGER NOT NULL,
  last_access_at INTEGER
);
CREATE INDEX ix_shares_node ON shares(node_id);

-- 进行中的分块上传（Cron 兜底清理）
CREATE TABLE uploads (
  id            TEXT PRIMARY KEY,           -- = file node id
  r2_upload_id  TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','completed','aborted')),
  created_at    INTEGER NOT NULL
);
