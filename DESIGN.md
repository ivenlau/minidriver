# MiniDriver — 个人网盘设计文档

> 部署于 Cloudflare Workers 生态的单用户个人云盘：Passkey 快速登录、文件管理、临时分享、桌面/移动自适应、中英双语、亮暗主题。

| | |
|---|---|
| 版本 | v1.0（设计定稿，待实施） |
| 日期 | 2026-09-16 |
| 状态 | Draft → Ready for Implementation |
| 产品名 | MiniDriver（"随身迷你硬盘"） |

---

## 1. 概述

### 1.1 目标

- **单用户**个人网盘（"我"是唯一管理员账号），可向他人分享文件
- 全部跑在 Cloudflare 免费维护的边缘基础设施上，**零服务器运维**
- 登录体验：桌面端 Touch ID / Windows Hello / 安全密钥一键通过；移动端 Face ID / 指纹
- 文件体量目标：**个人规模**（数万文件、单盘数百 GB 级别），不做多人协作

### 1.2 非目标（Non-goals，明确不做）

| 不做 | 原因 |
|---|---|
| 多用户 / 权限体系 / 注册邀请 | 个人产品，单账号 + Passkey 已足够 |
| 在线办公文档编辑（类 Notion/Docs） | 复杂度极高，预览即可 |
| 断点续传跨设备接力、P2P 同步客户端 | 浏览器内分块续传已满足 |
| 大规模并发写入（>10 req/s 持续） | D1 单写者模型不适合，个人场景用不到 |

### 1.3 核心用户旅程

1. 部署后首次访问 `/setup`：创建账号 → 注册第一个 Passkey → 下载恢复码
2. 日常：打开网盘 → 拖拽/拍照上传 → 整理文件夹 → 需要分享时生成限时链接发出去
3. 收到链接的人：打开 `/s/xxxx` → （可能输密码）→ 在线预览或下载 → 链接过期自动失效

---

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 计算 | **Cloudflare Workers**（单 Worker：API + 静态资源） | 边缘冷启动≈0，一次部署同时服务 API 和前端 |
| 文件存储 | **R2** | S3 兼容、**零出口流量费**、支持 Range/分块上传/生命周期规则 |
| 元数据 | **D1**（SQLite） | 关系查询（目录树递归 CTE）、事务、个人规模性能绰绰有余 |
| API 框架 | **Hono** | Workers 生态事实标准，类型安全、中间件齐全、体积小 |
| 前端 | **React 19 + Vite + TypeScript** | 生态最全；Vite 官方 `@cloudflare/vite-plugin` 可统一构建/本地开发 |
| 路由/数据 | **TanStack Router + TanStack Query** | 类型安全路由；Query 天然适配"文件夹列表"这类服务端状态（缓存、乐观更新） |
| 样式 | **Tailwind CSS v4** + CSS 变量主题 | 原子化 + `data-theme` 切换零成本 |
| 认证 | **Passkey/WebAuthn**（`@simplewebauthn/server` v10+ 兼容 Workers） | 免密码、防钓鱼、移动端生物识别，个人场景最强体验 |
| 图标/动效 | lucide-react + CSS transition（复杂动效可选 framer-motion） | — |
| 测试 | Vitest（`@cloudflare/vitest-pool-workers`）+ Playwright | 本地模拟 D1/R2，E2E 用 CDP 虚拟认证器测 Passkey |
| 部署 | `wrangler deploy` + GitHub Actions | push 即上线 |

> 备选说明：若不想引入 React，SolidJS/Svelte 体积更小，但组件生态（文件管理需要大量交互组件）React 收益更大。数据库若未来写入量大，可用 Hyperdrive 挂外部 Postgres，接口层已隔离。

---

## 3. 总体架构

**单 Worker 承载一切**：静态资源走 Workers Static Assets（不命中 `/api/*` 的路径直接由 CDN 边缘返回，不消耗 Worker 请求），API 由 Worker 处理后读写 D1 / R2。

```
                    ┌──────────────────────────────────────────┐
 浏览器(桌面/移动)   │              Cloudflare Edge             │
┌──────────────┐    │  ┌────────────┐   ┌───────────────────┐  │
│  SPA (React) │────┼─▶│ Static     │   │  Worker (Hono)    │  │
│  /files /s/* │    │  │ Assets CDN │   │  /api/*  /auth    │  │
└──────────────┘    │  └────────────┘   └────┬─────────┬────┘  │
                    │                        │         │       │
                    │              ┌─────────▼──┐   ┌──▼─────┐ │
                    │              │ D1 (SQLite)│   │   R2   │ │
                    │              │ 元数据/会话 │   │ 文件块 │ │
                    │              └────────────┘   └────────┘ │
                    │        Cron Trigger（每日清理）           │
                    └──────────────────────────────────────────┘
```

关键路由规则（`wrangler.jsonc`）：

- `assets.not_found_handling: "single-page-application"` → 前端路由全部回退到 `index.html`
- `assets.run_worker_first: ["/api/*"]` → API 强制先进 Worker

三条核心数据流：

1. **上传**：浏览器分块（8 MiB）→ Worker 流式转发到 R2 multipart → 元数据落 D1（Worker 内存占用≈0，因为 body 是 ReadableStream 直通）
2. **下载/预览**：Worker 校验会话/分享凭证 → R2 `get({ range })` 流式回传（支持断点续传、视频拖动进度条）
3. **分享访问**：访客无会话，凭分享 token（128-bit 随机）访问公开 API，密码/下载次数/过期时间在 D1 强制校验

---

## 4. 数据模型

### 4.1 D1 Schema（migration 0001_init.sql）

```sql
PRAGMA foreign_keys = ON;

-- 单用户表（保留扩展性）
CREATE TABLE users (
  id               TEXT PRIMARY KEY,        -- 32B random base64url
  email            TEXT NOT NULL,           -- 仅展示/找回提示用
  display_name     TEXT NOT NULL DEFAULT '',
  password_hash    TEXT,                    -- 'pbkdf2$600000$<salt_b64>$<hash_b64>'，可空=禁用密码登录
  totp_secret_enc  TEXT,                    -- AES-GCM 密文，密钥来自 secret SESSION_ENC_KEY
  totp_enabled     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE webauthn_credentials (
  id           TEXT PRIMARY KEY,            -- base64url(credentialID)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,               -- 用户命名，如 "MacBook 触控ID"
  public_key   BLOB NOT NULL,               -- COSE 公钥
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                        -- "internal,hybrid"
  backed_up    INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE recovery_codes (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,                  -- sha256 hex
  used_at  INTEGER
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,            -- sha256(token) hex —— 明文 token 只存于 Cookie
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT,
  ip_country   TEXT                         -- 只存国家码，不存 IP
);

-- 文件/目录统一节点表（邻接表 + 软删除）
CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,              -- ULID（可按时间排序）
  type       TEXT NOT NULL CHECK (type IN ('file','folder')),
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES nodes(id) ON DELETE CASCADE,  -- NULL = 根目录
  size       INTEGER,                       -- 仅 file
  mime       TEXT,                          -- 仅 file
  r2_key     TEXT,                          -- 'f/<id>'
  thumb_key  TEXT,                          -- 't/<id>.webp'（可选）
  sha256     TEXT,                          -- 可选，v2 去重用
  starred    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                        -- 非空 = 在回收站
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
  password_hash  TEXT,                      -- pbkdf2，可空
  expires_at     INTEGER,                   -- 可空
  max_downloads  INTEGER,                   -- 可空
  download_count INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,-- 密码爆破计数
  locked_until   INTEGER,                   -- 爆破退避截止时间
  revoked_at     INTEGER,
  created_at     INTEGER NOT NULL,
  last_access_at INTEGER
);

-- 进行中的分块上传（Cron 兜底清理 aborted 遗留）
CREATE TABLE uploads (
  id            TEXT PRIMARY KEY,           -- = file node id
  r2_upload_id  TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','completed','aborted')),
  created_at    INTEGER NOT NULL
);
```

> 注：SQLite 唯一索引中 `parent_id IS NULL` 的行互不冲突，根目录重名需在应用层校验（写一条，成本可忽略）。D1 不启用 FTS，搜索用 `LIKE`（见 6.5），如后续需要全文检索再评估 D1 FTS5 可用性。

### 4.2 R2 对象布局

```
f/<node_id>          # 文件内容（httpMetadata: contentType / contentDisposition）
t/<node_id>.webp     # 缩略图（上传时浏览器端生成，320px / webp q80）
```

R2 桶开启生命周期规则：**7 天后中止未完成的 Multipart Upload**（兜底清理垃圾块）。

### 4.3 关键 SQL

```sql
-- 面包屑（自底向上）
WITH RECURSIVE up(id, name, parent_id) AS (
  SELECT id, name, parent_id FROM nodes WHERE id = :id
  UNION ALL
  SELECT n.id, n.name, n.parent_id FROM nodes n JOIN up ON n.id = up.parent_id
) SELECT id, name FROM up;

-- 移动前防环：目标目录在待移动子树内则拒绝
WITH RECURSIVE sub(id) AS (
  SELECT id FROM nodes WHERE id = :movedId
  UNION ALL
  SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
) SELECT 1 FROM sub WHERE id = :targetParentId LIMIT 1;

-- 子树统计（目录大小/条目数）
WITH RECURSIVE sub(id) AS ( ... 同上 )
SELECT count(*), COALESCE(sum(size),0) FROM nodes WHERE id IN (SELECT id FROM sub) AND deleted_at IS NULL;
```

---

## 5. 认证与安全

### 5.1 登录方式（优先级从高到低）

| 方式 | 状态 | 说明 |
|---|---|---|
| **Passkey** | 默认启用，主通道 | 可注册多个（Mac 触控 ID、iPhone、YubiKey）；Discoverable credential → 登录页用户名输入框触发**自动填充一键登录**，移动端直接 Face ID |
| TOTP（验证器 App） | 可选，设置中开启 | 作为丢失 Passkey 时的第二通道，与密码组合使用 |
| 密码 | 可选，默认关闭 | PBKDF2-SHA256 × 600,000 迭代（Web Crypto 原生实现，OWASP 推荐）；一旦注册了 Passkey 可在设置里关闭 |
| 恢复码 | setup 时强制生成 | 10 个一次性代码，防止"所有设备丢失"死锁；使用后即作废并可重新生成 |

**Passkey 注册/登录流程**（挑战不走服务端会话，用 HMAC 签名的短期 Cookie 承载，无状态、5 分钟有效）：

```
注册:  GET  /api/auth/webauthn/options?purpose=register
       → Set-Cookie: __Host-wa=<sig({challenge,exp})>; Max-Age=300
       → 浏览器 navigator.credentials.create({publicKey})
       POST /api/auth/webauthn/register {credential}
       → 校验签名+challenge → 写入 webauthn_credentials

登录:  GET  /api/auth/webauthn/options?purpose=login   (allowCredentials 为空 → discoverable)
       → 浏览器 autofill / 系统弹窗 → navigator.credentials.get()
       POST /api/auth/webauthn/verify {credential}
       → 验签 + counter 单调递增校验（防克隆）→ 签发会话 Cookie
```

### 5.2 会话管理

- Token：`crypto.getRandomValues(32B)` → base64url 明文放 Cookie，**库里只存 SHA-256**
- Cookie：`__Host-sid`，`HttpOnly; Secure; SameSite=Lax; Path=/`（`__Host-` 前缀强制无 Domain、必须 Secure）
- 有效期：滑动 30 天 + 绝对上限 90 天；`last_seen_at` 距上次刷新 >24h 时顺延
- 设置页提供**设备列表**（UA + 国家 + 最近活跃），可单独吊销或"全部退出"

### 5.3 CSRF / 请求校验

三重防线（个人应用取其一即可，全部实现成本极低）：

1. `SameSite=Lax` Cookie（跨站 POST 不带会话）
2. 变更类请求（非 GET/HEAD）校验 `Origin` 头与 `APP_PUBLIC_URL` 一致
3. 前端所有变更请求带自定义头 `X-MiniDriver: 1`（跨站表单无法携带）

### 5.4 防爆破与限流

| 面 | 措施 |
|---|---|
| 登录接口 | D1 计失败次数：连续 5 次失败 → 锁定 15 分钟（指数退避）；配合 Cloudflare WAF 免费规则对 `/api/auth/*` 限速（如 30 req/min/IP） |
| 分享密码 | share 行内 `fail_count`/`locked_until`；5 次失败锁 15 分钟；失败 ≥3 次后要求 Turnstile 人机验证（免费） |
| 分享下载 | 按 token+IP 每分钟 30 次限速，超限 429 |
| 全局 | Worker 内简单令牌桶（D1 计数）兜底，敏感路径为主 |

### 5.5 可选加固：Cloudflare Access（Zero Trust）

在 Cloudflare 控制台对 `drive.example.com/*` 且排除 `/s/*` 与 `/api/s/*` 套一层 Access（邮箱 OTP）。效果：即使应用层认证出现漏洞，公网也进不来。**默认不开启**（会多一步邮箱验证，牺牲"快速登录"），文档中作为安全事件应急开关。

### 5.6 威胁模型小结

| 威胁 | 对策 |
|---|---|
| 会话 Cookie 被窃取 | HttpOnly（防 XSS 读取）+ Secure + 90 天绝对上限 + 设备列表可见可吊销 |
| XSS | React 转义 + 无 `dangerouslySetInnerHTML` + 严格 CSP（见 11.3） |
| 分享链接被猜测/转发 | 128-bit 随机 token（16^21 空间）+ 可选密码 + 限次 + 限时 + 可随时吊销 + `X-Robots-Tag: noindex` |
| 凭证填充 | Passkey 无可填充凭证；密码通道默认关闭 |
| 账号死锁 | 恢复码 + 多设备注册提示 + 可选 TOTP |
| 误删 | 回收站软删除 30 天 |
| D1/R2 数据丢失 | 见 11.5 备份策略（R2 无原生版本化，rclone 定期同步到异地） |

---

## 6. 文件管理设计

### 6.1 上传（分块 + R2 Multipart）

浏览器用 `File.slice()` 切 **8 MiB** 块（远低于 Workers 免费版 100 MB 请求体上限），3 块并发、单块失败独立重试 3 次（指数退避）。

```
POST /api/files/init  {name, parentId, size, mime}
  → D1 建 node(r2_key='f/<id>') + R2 createMultipartUpload → {fileId}
PUT  /api/files/:id/parts/:n          # body 为原始二进制流
  → Worker: bucket.uploadPart(...) 流式直通 → {partNumber, etag}
POST /api/files/:id/complete [{partNumber,etag}...]
  → completeMultipartUpload → 校验总大小 → D1 更新 size/mime
PUT  /api/files/:id/thumb             # 可选，浏览器生成的缩略图
POST /api/files/:id/abort             # 失败/取消时中止
```

- 小文件（≤8 MiB）走快速通道：`POST /api/files`（单请求 `bucket.put` 直传）
- 上传期间**不要**整文件读入内存：`fetch(url, { body: file.slice(a,b) })` 流式发送
- 上传管理器（前端）维护队列：文件串行、块并发 3；`beforeunload` 时若有未完成任务则提示
- 移动端 Safari 切后台导致的中断：重进后已完成块按 etag 复用，**从断点续传**

### 6.2 下载与流式预览

- `GET /api/nodes/:id/content` → R2 `get(key, { range })` 流式回传，透传 `Range`/`206`
- `Content-Disposition`：`?dl=1` 时 `attachment; filename*=UTF-8''<name>`，否则 `inline`
- 预览能力：图片（lightbox + 缩放）、视频/音频（原生 `<video>`，Range 拖动）、PDF（iframe）、文本/代码（前 1 MB 截断高亮）；其余类型仅下载
- 浏览器端整目录下载：v2 再考虑（Worker 端流式 zip 可用 zip.js，CPU 开销需评估），v1 提供"逐个下载/仅文件"

### 6.3 缩略图（零成本方案）

**上传时在浏览器生成**，不经服务端：

- 图片：`createImageBitmap` → canvas 缩放 → `canvas.convertToBlob({type:'image/webp',quality:0.8})`，最长边 320px
- 视频：`<video>` 静默加载 → seek 到 1s → 帧捕获为 webp
- PDF/文档/音频：不生成，用类型图标 + 主题色
- 无缩略图或生成失败不阻塞上传（缩略图通道单独失败可静默跳过，列表回退图标）

> 备选：Cloudflare Images 转换（需订阅）或 wasm 图像库在 Worker 端生成。个人规模下浏览器端方案免费且体验最好，选它。

### 6.4 目录与节点操作

| 操作 | 规则 |
|---|---|
| 新建文件夹 | 同级重名校验（含根目录的应用层校验） |
| 重命名 | 409 `NAME_CONFLICT` 冲突；非法字符 `/` 与保留名拒绝 |
| 移动 | 防环检查（4.3）+ 目标重名校验；D1 事务内改 `parent_id` |
| 删除 | **软删除**：子树递归打 `deleted_at`；回收站保留 30 天 |
| 恢复 | 原路径存在同名 → 恢复到"恢复的文件"根节点并提示 |
| 彻底删除 | 先删 R2 对象（`f/`、`t/`），再删行；分批（每批 ≤100）避免超时 |
| 定时清理 | Cron（每日）：回收站超 30 天 → 彻底删除；`uploads` 表超 7 天 open 状态 → R2 abort |

### 6.5 列表 / 排序 / 搜索 / 分页

- 列表：`GET /api/nodes?parent=<id>&sort=name|size|updated_at&order=asc|desc&cursor=<keyset>`，**keyset 分页**（`(updated_at, id)` 游标），每页 100
- 排序约定：文件夹恒在文件前；中文名排序用 SQLite 默认二进制序可接受（个人使用），如需完美拼音排序前端再做 localeCompare 重排
- 搜索：`GET /api/search?q=` → `name LIKE '%q%' ESCAPE '\'` + `deleted_at IS NULL` + 限 50 条；个人规模（<10 万行）毫秒级
- 最近：`ix_nodes_recent` 直接取 50 条；星标：`ix_nodes_starred`

---

## 7. 临时分享设计

### 7.1 创建分享

`POST /api/shares {nodeId, expiresIn, maxDownloads?, password?}`

- `expiresIn` 预设：1 小时 / 1 天 / 7 天 / 30 天 / 永久（默认 7 天；永久需二次确认）
- 生成 `token = base64url(32B random)`；库里只存 `sha256(token)`
- 返回完整链接 `https://<domain>/s/<token>`，前端弹窗一键复制（只显示这一次，之后列表中仅显示脱敏 `…st 4 位`）

### 7.2 访客访问流程

```
GET /s/<token>  (SPA 公开路由，无需登录)
  GET /api/s/<token>/meta
    → 校验 token/expired/revoked/次数
    → 无密码: {name, size, mime, hasThumb, expiresAt} → 直接可预览/下载
    → 有密码: {needPassword: true} → 密码输入页
        POST /api/s/<token>/unlock {password}
        → 通过后 Set-Cookie: __Host-sh_<shareId前8位>=<sig>; HttpOnly; Max-Age=3600（作用域仅此分享）
  GET /api/s/<token>/content   (Range 透传，校验 unlock Cookie)
  GET /api/s/<token>/thumb
```

分享页 UI：居中卡片 = 大图标/预览图 + 文件名 + 大小 + 过期倒计时 + 预览区（图片/视频/音频/PDF/文本）+ 「下载」主按钮。页面注入 `X-Robots-Tag: noindex`，不出现任何站内导航（访客视角只有这一个文件）。

### 7.3 下载计数与失效

- 每次成功进入 content 响应 `download_count += 1`（D1 原子 `UPDATE ... SET download_count = download_count + 1`）
- 命中 `expires_at < now` / `revoked_at` / `download_count ≥ max_downloads` → 统一返回 404（**不区分具体原因**，避免给猜测者信息）
- 分享管理页：列出活跃分享（文件名、创建时间、剩余有效期、下载次数），支持改密码/改有效期/吊销

---

## 8. API 设计

统一约定：JSON in/out；错误体 `{ "error": { "code": "NAME_CONFLICT" } }`（**API 只返回错误码，不返回文案**，由前端 i18n 映射，天然支持双语）；列表响应 `{ items, nextCursor }`。

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/setup` | 首次初始化（创建用户+Passkey+恢复码），已有用户后永久 403 |
| GET | `/api/bootstrap` | 应用状态：`{ initialized, me?, storage }`，前端据此路由 |
| GET | `/api/auth/webauthn/options?purpose=register\|login` | 生成挑战（签名 Cookie 返回） |
| POST | `/api/auth/webauthn/register` / `verify` | 注册凭证 / 验证登录 |
| POST | `/api/auth/password/login`、`/api/auth/totp/verify`、`/api/auth/recover` | 备用通道 |
| POST | `/api/auth/logout` | 注销当前会话 |
| GET/DELETE | `/api/auth/sessions` `/api/auth/sessions/:id` | 设备列表 / 吊销 |
| POST | `/api/auth/credentials` | 管理 Passkey（增删/重命名）、开关密码/TOTP、重新生成恢复码 |

### 文件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/nodes?parent&sort&order&cursor` | 列表（keyset 分页） |
| POST | `/api/folders` | 新建目录 |
| PATCH | `/api/nodes/:id` | 改名 / 移动 / 星标 |
| DELETE | `/api/nodes/:id` | 回收站；`?hard=1` 彻底删除 |
| POST | `/api/nodes/:id/restore` | 从回收站恢复 |
| GET | `/api/nodes/:id/content` `?dl=1` | 内容流（Range） |
| GET | `/api/nodes/:id/thumb` | 缩略图 |
| POST | `/api/files/init` · PUT `parts/:n` · POST `complete` / `abort` · PUT `thumb` | 分块上传族 |
| GET | `/api/search?q` · `/api/recent` · `/api/starred` · `/api/storage` | 检索与聚合 |

### 分享

| 方法 | 路径 | 鉴权 |
|---|---|---|
| GET/POST/DELETE | `/api/shares` `/api/shares/:id` | 登录 |
| GET | `/api/s/:token/meta` · POST `/unlock` · GET `/content` · GET `/thumb` | 公开（限流） |

---

## 9. 前端设计

### 9.1 路由

```
/setup                      初始化向导（仅未初始化时可见）
/login                      登录（Passkey autofill + 备用通道入口）
/files/:folderId?           文件浏览（folderId 空 = 根目录）
/starred  /recent  /trash   星标 / 最近 / 回收站
/shares                     分享管理
/settings                   设置（安全 / 外观 / 语言 / 存储）
/s/:token                   公开分享页（无框架壳，独立轻量入口）
```

### 9.2 布局与响应式

**桌面（≥1024px）**：左侧栏 + 顶栏 + 内容区 + 右侧详情抽屉

```
┌──────────────────────────────────────────────────────────────────────┐
│ ☁ MiniDriver   [ 🔍 搜索…                        ]        ⬆  🌐 ◐ ▾ │
├───────────┬──────────────────────────────────────────────────────────┤
│ ▣ 我的文件 │ 我的文件 › 旅行 › 2026北海道            [新建▾] [⬆上传] │
│ ☆ 星标    │ ┌──┬──────────────────┬────────┬──────────┬─────┐       │
│ 🕘 最近   │ │☐│ 名称              │ 大小    │ 修改时间  │  ⋯  │       │
│ 🔗 分享   │ ├──┼──────────────────┼────────┼──────────┼─────┤       │
│ 🗑 回收站  │ │☐│ 📁 2026北海道     │ 128 项  │ 3 天前    │  ⋯  │       │
│           │ │☐│ 🖼 beach.jpg      │ 2.4 MB │ 3 天前    │  ⋯  │       │
│ 存储空间   │ │☐│ 🎦 vlog.mp4       │ 412 MB │ 昨天      │  ⋯  │       │
│ ▓▓▓▓░ 68% │ └──┴──────────────────┴────────┴──────────┴─────┘       │
│ ⚙ 设置    │          （拖拽文件到此处上传 · 右侧详情抽屉）              │
└───────────┴──────────────────────────────────────────────────────────┘
```

**移动（<768px）**：单列卡片流 + 底部标签栏 + 右下角悬浮上传按钮（FAB）；多选用**长按**进入；操作用底部动作面板（bottom sheet）

```
┌──────────────────────────┐
│ MiniDriver         ◐  🌐 │
│ ┌──────────────────────┐ │
│ │ 🔍 搜索文件           │ │
│ └──────────────────────┘ │
│ 我的文件 › 旅行            │
│ ┌──────────────────────┐ │
│ │ 🖼 beach.jpg    [⋯]  │ │
│ │ 2.4 MB · 3 天前       │ │
│ ├──────────────────────┤ │
│ │ 📁 2026北海道   [⋯]  │ │
│ │ 128 项 · 3 天前       │ │
│ └──────────────────────┘ │
│                    ( ⬆ ) │
│  📂文件  ⭐星标  🗑回收  ⚙我 │
└──────────────────────────┘
```

断点：`sm 640 / md 768 / lg 1024 / xl 1280`；`<768px` 切换为移动布局（侧栏 → 底部栏，抽屉 → 全屏 sheet）。触摸目标 ≥44px，iOS 安全区 `env(safe-area-inset-*)` 适配。

### 9.3 设计系统

- **气质**：安静、内容优先的"文件柜"感 —— 大量留白、轻边框（1px）、柔和阴影、12–16px 圆角、克制的强调色
- **字体**：`-apple-system, "SF Pro Text", Inter, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`（中英混排统一走系统栈，零加载成本）
- **色彩**（CSS 变量，`data-theme` 切换）：

| 变量 | Light | Dark |
|---|---|---|
| `--bg` | `#f7f8fa` | `#0f1115` |
| `--surface` | `#ffffff` | `#171a21` |
| `--surface-2` | `#f1f3f6` | `#1f232d` |
| `--text` | `#17181c` | `#e6e8ee` |
| `--text-muted` | `#6b7280` | `#8b93a1` |
| `--border` | `#e6e8ec` | `#262b36` |
| `--accent` | `#5b5bd6`（靛蓝紫） | `#7c7cf0` |
| `--danger` | `#dc2626` | `#f87171` |

- **图标**：lucide-react，线性 1.5px；文件类型色块：图片紫 / 视频蓝红 / 音频琥珀 / 文档灰 / 压缩包橙
- **动效**：150–200ms `ease-out`；hover 轻浮起、列表项进入微淡入、sheet 从底部滑入；尊重 `prefers-reduced-motion`
- **反馈**：骨架屏（列表首屏）、上传进度条（文件级 + 总进度）、toast（复制成功/删除/错误）、空状态插画（"拖文件到这里"）

### 9.4 主题切换实现

- 三态：亮色 / 暗色 / **跟随系统**（默认），存 `localStorage('md.theme')`
- `<html data-theme="light|dark">` + Tailwind v4 的 class 暗色变体
- 防 FOUC：`index.html` 内联 3 行脚本，首帧前读取 localStorage 并设置 `data-theme`（跟随系统时监听 `matchMedia('(prefers-color-scheme: dark)')` 实时跟随）
- 所有颜色只允许引用变量（ESLint stylelint 规则约束），保证一套组件两套主题零额外代码

### 9.5 国际化实现

- `react-i18next` + `zh-CN.json` / `en.json`（命名空间：`common` / `files` / `share` / `settings` / `errors`）
- 检测顺序：用户手动选择（`localStorage` + 同步写一个 Cookie）→ `navigator.language` → 默认 `zh-CN`
- **服务端零 i18n**：API 只返回错误码（如 `NAME_CONFLICT`、`SHARE_EXPIRED`），前端查 `errors` 命名空间渲染本地文案
- 日期/大小全部走 `Intl`：`Intl.RelativeTimeFormat`（"3 天前" / "3 days ago"）、`Intl.NumberFormat` + 自定义字节格式化（1.2 MB / 1.2 MB）
- 中文 UI 文案短、英文避免生硬直译；`Pluralization` 处理英文复数（`{{count}} item(s)`）

### 9.6 关键交互

| 场景 | 桌面 | 移动 |
|---|---|---|
| 上传 | 拖拽到窗口任意处（全屏拖放遮罩）/ 顶栏按钮 / 粘贴剪贴板图片 | FAB → 系统 `input[type=file]`（支持 `capture` 直调相机） |
| 多选 | Ctrl/Shift 点击 + 表头复选框 | 长按进入选择模式，滑动多选 |
| 操作 | 行尾 `⋯` 菜单 + 右键菜单 + 快捷键（Del/Space 预览/Cmd+A） | `⋯` → bottom sheet |
| 预览 | 右侧抽屉（文件详情 + 预览）或全屏 lightbox | 全屏预览，下拉关闭 |
| 上传进度 | 右下角可折叠上传队列 | 底部弹出迷你进度条，点击展开 |
| 分享 | 右键/`⋯` → 对话框（有效期、密码、次数）→ 复制链接 | 同，对话框为全屏 sheet |

---

## 10. 项目结构

```
minidriver/
├── DESIGN.md
├── wrangler.jsonc             # Worker + 静态资源 + D1/R2 绑定 + Cron
├── vite.config.ts             # @cloudflare/vite-plugin：一次 dev/build 同时产出前后端
├── package.json
├── migrations/                # D1 SQL migrations
│   └── 0001_init.sql
├── src/                       # Worker（API）
│   ├── index.ts               # Hono app 装配 + 中间件 + ASSETS 兜底
│   ├── routes/
│   │   ├── auth.ts            # setup / webauthn / password / totp / sessions
│   │   ├── nodes.ts           # 列表/CRUD/内容流
│   │   ├── files.ts           # 分块上传族
│   │   ├── shares.ts          # 管理端
│   │   └── public.ts          # /api/s/* 访客端
│   ├── middleware/            # requireAuth / originCheck / rateLimit / errorHandler
│   └── lib/
│       ├── env.ts             # Bindings/Secrets 类型
│       ├── r2.ts              # get(range)/put/uploadPart 封装
│       ├── d1.ts              # 常用查询（面包屑/子树/keyset）
│       ├── auth.ts            # 会话签发/校验、PBKDF2、签名 Cookie、恢复码
│       ├── webauthn.ts        # @simplewebauthn/server 封装
│       └── ids.ts             # ULID / token 生成
├── web/                       # SPA
│   ├── index.html             # 含主题防 FOUC 内联脚本
│   └── src/
│       ├── main.tsx / router.tsx
│       ├── routes/            # Files / Starred / Recent / Trash / Shares / Settings / Login / Setup / ShareView
│       ├── components/        # NodeRow / NodeGrid / Breadcrumbs / UploadManager / DetailsDrawer /
│       │                      # ShareDialog / EmptyState / ThemeSwitch / LangSwitch / ...
│       ├── lib/               # api client、上传队列、格式化(Intl)、passkey client
│       ├── i18n/              # zh-CN.json / en.json / index.ts
│       └── styles/            # tailwind.css + 主题变量
└── test/                      # vitest（API 集成）+ e2e（Playwright）
```

---

## 11. 部署与运维

### 11.1 wrangler.jsonc（要点）

```jsonc
{
  "name": "minidriver",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "r2_buckets": [{ "binding": "R2", "bucket_name": "minidriver" }],
  "d1_databases": [{ "binding": "DB", "database_name": "minidriver", "database_id": "<创建后填入>" }],
  "triggers": { "crons": ["17 3 * * *"] },          // 每日清理（回收站/遗留分块/过期分享）
  "vars": { "APP_PUBLIC_URL": "https://drive.example.com" },
  "observability": { "enabled": true },
  "limits": { "cpu_ms": 30000 }
}
```

Secrets（`wrangler secret put`）：

| 名称 | 用途 |
|---|---|
| `SESSION_ENC_KEY` | 32B 随机：TOTP 密文加密、挑战 Cookie 与解锁 Cookie 的 HMAC 签名 |
| `SETUP_TOKEN` | 首次 `/setup` 时要求输入的一次性口令（防止部署窗口期被陌生人抢占初始化） |

前置资源：`wrangler r2 bucket create minidriver`、`wrangler d1 create minidriver && wrangler d1 migrations apply minidriver`。绑定自定义域（WebAuthn 与安全 Cookie 要求 HTTPS，`*.workers.dev` 可用但建议自有域）。

### 11.2 环境与发布

```bash
pnpm dev        # vite dev：本地同时起 Worker + 前端，D1/R2 走本地模拟（miniflare）
pnpm test       # vitest
pnpm build && wrangler deploy
```

GitHub Actions：push 到 `main` → `pnpm i && pnpm test && pnpm build && wrangler deploy`（`CLOUDFLARE_API_TOKEN` 存 GitHub Secrets）；migrations 在 deploy 前 `wrangler d1 migrations apply --remote`。

### 11.3 安全响应头（Worker 统一注入）

```
Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:;
  media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline';
  frame-ancestors 'none'; object-src 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
X-Robots-Tag: noindex        # /s/* 分享页
Permissions-Policy: camera=(self), publickey-credentials-get=(self)
```

### 11.4 可观测性

- Workers Logs（`observability.enabled`）+ `wrangler tail` 排障
- 错误统一进 `errorHandler`：记录 `code + path + requestId`（不打文件名等隐私），前端 toast 展示本地化文案
- 仪表盘看 D1 行读取量、R2 Class A/B 操作量（成本预警，见 12）

### 11.5 备份（R2 无原生版本化，必须自己做）

| 层 | 策略 |
|---|---|
| D1 | `wrangler d1 export`（Cron 每周触发或本机定时）导出 SQL 存入另一个 R2 桶/本地 |
| R2 文件 | rclone（R2 走 S3 兼容 API）每周 `sync` 到本地 NAS 或另一云（如 B2）；或至少对"不可再生的原始照片"保持本地一份 |
| 恢复演练 | 半年一次：空桶 + 导入 D1 → 全功能走查 |

---

## 12. 限额与成本估算（个人规模）

| 项 | 免费层 | 付费（建议） |
|---|---|---|
| Workers | 10 万请求/天，10ms CPU | **$5/月**：含 3000 万请求/月，30s CPU（PBKDF2/大文件更从容） |
| R2 存储 | 10 GB·月 | $0.015/GB·月 → **100 GB ≈ $1.5/月**；出口流量永久免费 |
| R2 操作 | A 类 100 万/月，B 类 1000 万/月 | A $4.5/百万、B $0.36/百万（个人远用不完） |
| D1 | 500 万行读/天，5 GB | 个人规模基本免费额度内 |

**典型月账单：≈ $6.5（100 GB 文件）**；轻量使用（<10 GB）可先跑免费层（上传分块设计已保证 <100MB 限制不触雷）。

---

## 13. 实施路线图

| 里程碑 | 内容 | 验收标准 | 预估 |
|---|---|---|---|
| **M0 骨架** | 仓库脚手架、Vite+Worker 一体构建、D1/R2 绑定、`/setup` + Passkey 注册/登录 + 会话 + 恢复码 | 全新环境 5 分钟完成部署并登录 | 1–2 天 |
| **M1 文件核心** | 上传（分块+缩略图）、列表/面包屑、下载/预览、新建/重命名/移动/删除/回收站、Cron 清理 | 1GB 视频可稳定上传续传；Range 拖动进度条可用 | 3–4 天 |
| **M2 分享** | 分享创建/管理、公开页、密码/次数/过期、限流与 Turnstile | 访客无痕浏览器全流程可用；爆破被锁 | 2 天 |
| **M3 体验** | i18n 全量、主题三态、移动布局/bottom sheet/长按多选、搜索/星标/最近、空状态与骨架屏 | 中英切换无硬编码文案；375px 与 1440px 走查无破版 | 2–3 天 |
| **M4 加固** | CSP、限流调优、备份脚本、E2E、成本告警 | 恢复演练通过；CI 全绿 | 1–2 天 |

依赖顺序：M0 → M1 → M2 → M3 → M4 严格串行；M3 中 i18n 建议从 M1 起就同步抽取文案（避免最后一次性返工）。

---

## 14. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| API 集成 | Vitest + `@cloudflare/vitest-pool-workers`（本地真实 D1/R2） | 认证全流程、上传族状态机（init/part/complete/abort）、分享过期/次数/密码、移动防环 |
| 前端单测 | Vitest + Testing Library | 上传队列（分块/重试/续传逻辑）、格式化、i18n 键完整性（zh/en 键集合 diff 校验） |
| E2E | Playwright（CDP 虚拟认证器模拟 Passkey；移动视口 + 桌面视口双跑） | 登录→上传→分享→访客下载主链路；主题/语言切换持久化 |
| 手工清单 | — | iOS Safari / Android Chrome / 桌面三浏览器；WebAuthn 在 iOS 需 HTTPS+自有域验证 |

---

## 15. 风险与备选方案

| 风险 | 影响 | 预案 |
|---|---|---|
| Passkey 全部丢失 | 无法登录 | 恢复码（setup 强制）+ 鼓励注册 ≥2 个 Passkey + 可选 TOTP |
| 移动端后台上传被杀 | 上传失败 | 分块 + etag 断点续传 + 失败队列持久化到 localStorage |
| D1 写入瓶颈 | 上传慢 | 个人规模不会触及；若触及，`uploads`/会话迁 KV，节点表仍留 D1 |
| Worker 请求体上限 | 大文件失败 | 8 MiB 分块已规避；未来可换 R2 预签名直传（aws4fetch）绕过 Worker |
| R2 数据误删 | 数据丢失 | 30 天回收站 + 11.5 异地备份；彻底删除前二次确认 |
| `*.workers.dev` 域名在某些网络不稳定 | 访问慢/失败 | 绑定自有域名；必要时叠加优选线路（自担风险） |
| FTS 需求升级 | 搜索不准 | 届时评估 D1 FTS5 或内容入 Vectorize 做语义搜索（v2 彩蛋） |

---

## 附：v2 候选池（按价值排序，v1 不做）

1. 文件夹流式打包下载（zip.js + Queues）
2. 内容寻址去重（`sha256` 已预留字段）
3. 相册视图（按 EXIF 时间聚合，时间从客户端解析后写入节点元数据）
4. WebDAV 只读挂载（Workers 实现 WebDAV 子集，挂到 macOS Finder / iOS 文件 App）
5. 分享页访客统计（国家/次数趋势，Workers Analytics Engine）
