# MiniDriver

跑在 Cloudflare Workers 上的单用户个人网盘，零服务器运维，免费额度即可起步。

**亮点**

- **Passkey 登录**：指纹 / 面容一次验证直达，密码 + TOTP + 一次性恢复码兜底
- **临时分享**：限时限次限密码的链接，访客免登录在线预览（图片 / 视频 / 音频 / PDF / 文本），可吊销可删除
- **文件管理**：分块上传断点续传、Range 流式播放、目录树、搜索、星标、回收站、Markdown / TXT 在线编辑与实时预览、**图床公开直链**（`/i/<slug>`，可作外链图床）
- **中英双语 · 亮暗主题 · 桌面 / 移动自适应**

技术栈：Cloudflare Workers（Hono）+ R2 + D1 + React 19，架构细节见 [DESIGN.md](./DESIGN.md)。

---

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars        # 把 SESSION_ENC_KEY 换成真实随机值（生成命令见文件内注释）
npm run db:migrate:local
npm run dev                           # wrangler dev(8787, API) + vite dev(5173, 页面)
```

打开 http://localhost:5173 → `/setup` → 输入 `.dev.vars` 里的 `SETUP_TOKEN`（默认 `dev-setup-token`）→ 注册 Passkey → 保存恢复码。

> 无浏览器时可跑 API 冒烟测试（内置伪造认证器，69 项断言）：`npm run dev:api` + `npm run smoke`。

---

## 部署（GitHub Actions → Cloudflare）

流程：**先配 GitHub → 首次运行 Action（自动在 Cloudflare 创建 Worker）→ 回 dashboard 配置 Worker Secrets → 再次运行 Action → 初始化**。

### 值流向总表

| # | 值 | 从哪里取 | 设置到哪里 |
|---|---|---|---|
| 1 | R2 桶名 | 创建时自拟，须与 `wrangler.jsonc` 的 `bucket_name` 一致（默认 `minidriver`）；可再设 GitHub Secret `R2_BUCKET_NAME` 覆盖 | Cloudflare R2 |
| 2 | D1 Database ID | 创建数据库后的详情页（32 位 UUID） | GitHub Secret `D1_DATABASE_ID` |
| 3 | Account ID | dashboard 右侧边栏 / Workers & Pages 概览页 | GitHub Secret `CLOUDFLARE_ACCOUNT_ID` |
| 4 | API Token | My Profile → API Tokens（见第 1 步） | GitHub Secret `CLOUDFLARE_API_TOKEN` |
| 5 | SESSION_ENC_KEY | 本机生成（见第 4 步命令） | Cloudflare Worker Secret |
| 6 | SETUP_TOKEN | 自拟强随机字符串 | Cloudflare Worker Secret |
| 7 | APP_PUBLIC_URL | 你的正式域名 | Cloudflare Worker Secret |

### 第 1 步：Cloudflare 创建资源与令牌

1. **R2 桶**：dashboard → R2 Object Storage → Create bucket → 命名 `minidriver`（首次启用需绑卡，免费额度内不扣费）
2. **D1 数据库**：Storage & Databases → D1 SQL Database → Create → 命名 `minidriver` → **复制 Database ID**
3. **API Token**：右上角头像 → My Profile → API Tokens → Create Token → 模板 **Edit Cloudflare Workers** → 权限页追加 `Account · D1 · Edit` → Create → **复制 token（只显示一次）**
4. **Account ID**：dashboard 右侧边栏，复制

### 第 2 步：GitHub 配置 Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret，逐条添加（Name 一字不差）：

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第 1 步第 3 项 |
| `CLOUDFLARE_ACCOUNT_ID` | 第 1 步第 4 项 |
| `D1_DATABASE_ID` | 第 1 步第 2 项 |
| `R2_BUCKET_NAME`（可选） | 桶名覆盖；默认用 `wrangler.jsonc` 的 `minidriver`。与 Miniblog 联动时两侧配同值（见联动章节） |

### 第 3 步：首次运行 Action（自动创建 Worker）

push 到 `main`，或在仓库 **Actions → Deploy → Run workflow** 手动触发。

流水线全绿后，Workers & Pages 列表里才会出现 `minidriver` —— **Worker 到这一步才存在**，应用已上线但认证功能不可用（Secrets 还没配）。

### 第 4 步：回 Cloudflare 配置 Worker Secrets

现在可以进入 Worker → Settings → Variables and Secrets → Add（类型选 **Secret**）：

| Name | Value |
|---|---|
| `SESSION_ENC_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 的输出；设置后不要再换 |
| `SETUP_TOKEN` | 自拟，稍后初始化时输入 |
| `APP_PUBLIC_URL` | `https://yourdomain.com`（正式域名；只用 workers.dev 可不设，自动取访问域名） |

> 保存 Secret 会自动生成一次新部署；为走完整流水线，建议再手动触发一次 Action。

### 第 5 步：重新触发 Action 并初始化

Actions → Deploy → Run workflow 再跑一次，全绿后：

1. 访问 `https://yourdomain.com/setup`，输入 `SETUP_TOKEN`
2. 注册第一个 Passkey → **立即保存恢复码**（只显示一次）
3. 验证：登录一次成功 · 上传一个文件 · 创建分享链接并能打开

### 备选：dashboard 关联 Git（Workers Builds）

Workers & Pages → Create → Workers → Import an existing repository（注意是 Workers，不是 Pages）。
先在 Worker 的 Settings → **Build variables** 定义 `D1_DATABASE_ID` 与 `R2_BUCKET_NAME`（可选），然后：

| 设置项 | 值 |
|---|---|
| Build command | `node scripts/resolve-config.mjs && npm run build && npx wrangler d1 migrations apply minidriver --remote` |
| Deploy command | `npx wrangler deploy` |

### 备选：本机手动部署

```bash
npx wrangler login
D1_DATABASE_ID=<你的DatabaseID> npm run deploy
```

### 绑定自定义域名

Worker → Settings → Domains & Routes → Add → Custom domain → 填子域名 → 等 Active。
把 `APP_PUBLIC_URL` Secret 更新为该域名（保存即自动重新部署）。
**Passkey 与域名绑定**：换域名后需在新域名下用密码 / 恢复码登录一次，再重新注册 Passkey。

### 部署失败排查

| 现象 | 原因 |
|---|---|
| 迁移步骤报 `authentication error` | API Token 缺 `D1 Edit` 权限，回第 1 步补勾 |
| 部署步骤报找不到 D1 / binding 错误 | `D1_DATABASE_ID` 缺失或复制带了空格 |
| 部署步骤报 R2 权限 / 不存在 | Token 缺 R2 权限，或桶名与 `R2_BUCKET_NAME` / `wrangler.jsonc` 不一致 |
| 冒烟测试失败 | 打开该步骤日志看具体断言，多为代码回归 |
| 线上 401 / 认证异常但部署成功 | 第 4 步的三个 Cloudflare Secrets 未配置齐全 |

---

## 与 Miniblog 联动（可选）

[Miniblog](../miniblog) 是同系的单用户个人博客（SSR 公开站 + Markdown 写作后台 PWA）。无模式开关：**两个仓库的部署配置指到同一资源，联动即自然产生**；各自指向则完全独立、互不影响。

| 配置（两个仓库对称设置） | 相同时的效果 |
|---|---|
| GitHub Secret `D1_DATABASE_ID` | 共账号 / 会话 / 凭证 / 恢复码 + 素材元数据（nodes 表） |
| GitHub Secret `R2_BUCKET_NAME` | 共文件存储 |
| Worker Secret `SESSION_ENC_KEY` / `SETUP_TOKEN` | 需同值（共享 TOTP 密文与初始化语义） |
| Worker 变量 `BASE_DOMAIN_AUTH` = `true` | SSO：一处登录两站通用；Passkey 跨应用。共享域 = 部署域名去掉第一段（如 `drive.demo.qzz.io` 的共享域为 `demo.qzz.io`；`drive.example.com` → `example.com`），直接部署在根域上时取根域自身 |

**联动后的行为**：

- 任一侧登录 / 注册的账号与 Passkey 两边通用；本仓库「安全」设置页会显示「联动」标识，密码 / TOTP / 会话吊销等修改即时双向生效
- Miniblog 的图片素材存入本网盘「博客素材/年-月/」目录，「存储」设置页会显示联动说明；这些文件可直接预览 / 分享 / 管理
- 素材公开直链由 Miniblog 本域提供（`/assets/<slug>`），本仓库的图床 `/i/<slug>` 照常可用；网盘侧彻底删除文件后博客侧链接自然失效
- **顺序无关**：两侧迁移均已幂等化，谁先初始化同一 D1 都安全（后部署方的迁移对已有表自动跳过）

---

## 生产建议

| 项 | 说明 |
|---|---|
| 自定义域名 | iOS Safari 对 `*.workers.dev` 的 WebAuthn 体验欠佳，建议自有域名 |
| 备份 | R2 无原生版本化：定期 `rclone sync` 到本地 / 异地；`wrangler d1 export` 导出元数据 |
| Cron | 已配置每日清理（回收站 30 天、遗留分块上传、过期分享记录），无需操作 |
| 加固 | 可在 Cloudflare Zero Trust 给除 `/s/*` 外的路径套 Access，作为应急开关 |

## 成本参考

| 用法 | 月成本 |
|---|---|
| 轻量使用（<10GB、以 Passkey 登录为主） | $0（免费额度内） |
| 照片 / 视频仓库（100GB 级）或密码功能需稳定 | ≈ $6.5（$5 Workers Paid + $1.5 R2 存储，流量永久免费） |

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（API 8787 + 页面 5173） |
| `npm run build` | 构建前端到 `dist/client` |
| `npm run typecheck` | Worker + 前端双端类型检查 |
| `npm run db:migrate:local` / `:remote` | 应用 D1 迁移 |
| `npm run smoke` | API 全链路冒烟测试 |
| `D1_DATABASE_ID=<id> npm run deploy` | 本机手动部署（需先 wrangler login） |

## 项目结构

```
src/          Worker（Hono API：auth / nodes / files / shares / public + Cron 清理）
web/          React SPA（页面 / 组件 / i18n / 上传队列 / 主题）
migrations/   D1 SQL 迁移
scripts/      smoke.mjs（伪造 WebAuthn 认证器的冒烟测试）
              audit-d1.mjs（D1 语句执行审计，CI 防线）
              resolve-config.mjs（部署时注入 D1 database_id）
              ensure-dist.mjs（dev 前确保静态资源目录存在）
```

## 安全模型速览

- 会话：`__Host-` Cookie（HttpOnly + Secure + SameSite=Lax），库内只存 SHA-256，滑动 30 天 / 绝对 90 天
- CSRF：SameSite + Origin 校验 + 自定义头三重防线
- 登录爆破：5 次失败锁 15 分钟；分享密码同策略，失效分享统一 404 不泄露原因
- 分享 token：128-bit 随机，库内只存哈希；完整链接仅创建时显示一次
- 响应头：CSP / nosniff / noindex（分享页）等由 `_headers` 注入
