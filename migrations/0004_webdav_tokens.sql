-- WebDAV 挂载令牌（HTTP Basic 认证通道）
-- 客户端（Windows 资源管理器 / macOS Finder / iOS 第三方文件 App / rclone）不支持
-- Passkey 与 CSRF 头，走独立令牌：用户名任意，密码 = 令牌。
-- 安全模型与会话一致：库里只存 SHA-256，明文仅创建时返回一次；删除即吊销。
-- 令牌为 32B 随机（mdav_ 前缀 + base64url），爆破空间与分享 token 同级，无需失败锁定。

CREATE TABLE IF NOT EXISTS webdav_tokens (
  id           TEXT PRIMARY KEY,            -- ULID
  token_hash   TEXT NOT NULL UNIQUE,        -- sha256(完整令牌含前缀) hex
  name         TEXT NOT NULL DEFAULT '',    -- 用户命名，如 "iPhone 文件 App"
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
