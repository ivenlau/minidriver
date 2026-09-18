-- shares.node_id 外键补上 ON DELETE CASCADE：
-- 生产 D1 默认强制外键，删除带有分享记录的节点会报 FOREIGN KEY constraint failed。
-- SQLite 无法直接修改外键，标准做法是重建表。
CREATE TABLE shares_new (
  id             TEXT PRIMARY KEY,
  node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
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
INSERT INTO shares_new
  SELECT id, node_id, token_hash, password_hash, expires_at, max_downloads,
         download_count, fail_count, locked_until, revoked_at, created_at, last_access_at
  FROM shares;
DROP TABLE shares;
ALTER TABLE shares_new RENAME TO shares;
CREATE INDEX ix_shares_node ON shares(node_id);
