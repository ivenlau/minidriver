# MiniDriver

部署在 Cloudflare Workers 生态上的单用户个人网盘：**Passkey 快速登录 · 文件管理 · 临时分享 · 中英双语 · 亮暗主题**，桌面与移动浏览器自适应。

> 设计细节见 [DESIGN.md](./DESIGN.md)。

## 功能

- **认证**：Passkey（触控 ID / 面容 ID / Windows Hello / 安全密钥，支持登录页 autofill 一键登录）；可选密码 + TOTP 备用通道；一次性恢复码防死锁；设备会话管理
- **文件**：分块上传（8MiB 分块、断点重试、浏览器端生成缩略图）、流式下载（Range / 断点续传）、目录树、重命名 / 移动 / 星标 / 搜索 / 回收站（30 天）
- **分享**：限时 / 限次 / 可选密码的临时链接，访客页可在线预览（图片 / 视频 / 音频 / PDF / 文本），随时吊销或删除记录
- **体验**：React + Tailwind v4 语义 token 双主题（亮 / 暗 / 跟随系统）、`react-i18next` 中英双语、桌面侧栏 + 移动底部导航、拖拽上传、长按多选

## 技术栈

Cloudflare Workers（Hono）· R2（文件，零出口流量费）· D1（SQLite 元数据）· React 19 + Vite + TanStack Query + react-router · @simplewebauthn v14

---

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars        # 并把 SESSION_ENC_KEY 换成真实随机值（生成命令见该文件注释）
npm run db:migrate:local              # 初始化本地 D1
npm run dev                           # 同时启动 wrangler dev(8787, API) + vite dev(5173, 页面)
```

打开 http://localhost:5173 → 自动进入 `/setup`：

1. 输入 `.dev.vars` 中的 `SETUP_TOKEN`（默认 `dev-setup-token`）
2. 注册第一个 Passkey（本机生物识别 / 安全密钥）
3. **保存恢复码**（只显示一次）

> 无浏览器环境时可跑 API 冒烟测试（内置伪造认证器，66 项断言）：
>
> ```bash
> npm run dev:api        # 终端 1
> npm run smoke          # 终端 2（先 db:migrate:local）
> ```

---

## 部署到 Cloudflare（GitHub Actions 全自动）

推送 `main` 即自动：**类型检查 → D1 审计 → 构建 → 冒烟测试 → 注入配置 → 远程迁移 → 上线**。
只需按下面 5 步配置一次。

### 值流向总表（先看这张）

| # | 值 | 从哪里取 | 设置到哪里 | 用途 |
|---|---|---|---|---|
| 1 | R2 桶 | 创建时自拟，**须与 `wrangler.jsonc` 的 `bucket_name` 一致**（默认 `minidriver`） | Cloudflare R2 | 文件存储 |
| 2 | D1 Database ID | 创建数据库后的详情页（32 位 UUID） | **GitHub Secret** → `D1_DATABASE_ID` | 部署时注入 `wrangler.jsonc`，绑定元数据库 |
| 3 | Account ID | dashboard 右侧边栏 / Workers & Pages 概览页 | **GitHub Secret** → `CLOUDFLARE_ACCOUNT_ID` | 让 CI 知道操作哪个账号 |
| 4 | API Token | My Profile → API Tokens（见第 2 步） | **GitHub Secret** → `CLOUDFLARE_API_TOKEN` | CI 执行迁移与部署的授权 |
| 5 | SESSION_ENC_KEY | 本机生成（见第 3 步命令） | **Cloudflare Worker Secret** | 会话 Cookie 签名、TOTP 加密 |
| 6 | SETUP_TOKEN | 自拟强随机字符串 | **Cloudflare Worker Secret** | `/setup` 一次性初始化口令 |
| 7 | APP_PUBLIC_URL | 你的正式域名 | **Cloudflare Worker Secret** | 分享链接域名 + Passkey RP ID |

> **铁律**：上表 2~7 没有一个会出现在代码里。`wrangler.jsonc` 保持仓库原样（占位符 + 空值），
> 仓库可以安全开源。

### 第 1 步：Cloudflare 创建资源

1. **R2 桶**：dashboard → **R2 Object Storage** → **Create bucket** → 名字填 `minidriver`
   （首次启用 R2 要求绑定付款方式，免费额度 10GB 内不扣费）
2. **D1 数据库**：dashboard → **Storage & Databases** → **D1 SQL Database** → **Create** → 名字填 `minidriver`
   创建后进入详情页，**复制 Database ID**（第 4 步要用）

### 第 2 步：创建 Cloudflare API Token

1. dashboard → 右上角头像 → **My Profile** → **API Tokens** → **Create Token**
2. 模板选 **Edit Cloudflare Workers** → Use template
3. 权限页**追加一行**：Account · **D1** · **Edit**（模板已自带 Workers Scripts / Workers R2 Storage / Workers Routes 等所需权限）
4. Account Resources 选你的账号 → **Continue to summary** → **Create Token**
5. **立即复制 token**（只显示这一次）—— 这是第 4 步的 `CLOUDFLARE_API_TOKEN`

### 第 3 步：设置 Cloudflare Worker Secrets（3 个）

先在本机生成两个值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # → SESSION_ENC_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"  # → SETUP_TOKEN（也可自拟）
```

然后 dashboard → **Workers & Pages** → **minidriver** → **Settings** → **Variables and Secrets** → **Add**，逐条添加（类型一律选 **Secret**）：

| Name | Value | 说明 |
|---|---|---|
| `SESSION_ENC_KEY` | 第 1 个生成值 | 设置后不要再换（换了全部登录失效） |
| `SETUP_TOKEN` | 第 2 个生成值 | 初始化时输入，之后妥善保存 |
| `APP_PUBLIC_URL` | `https://你的域名`（如 `https://yourdomain.com`） | 绑定自定义域名后必设；只用 workers.dev 可不设（自动取访问域名） |

> Secrets 设一次永久生效，之后的每次自动部署都不会覆盖它们。

### 第 4 步：设置 GitHub Secrets（3 个）

GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，逐条添加（Name 必须一字不差）：

| Name | Value（从哪来） |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第 2 步的 token |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard 首页 / Workers & Pages 概览右侧的 Account ID |
| `D1_DATABASE_ID` | 第 1 步复制的 Database ID |

### 第 5 步：推送并观察流水线

```bash
git push origin main
```

到仓库 **Actions** 标签页看 **Deploy** 工作流，依次经过：

```
类型检查 + D1 审计 + 构建
→ 冒烟测试（本地 workerd，66 项断言）
→ resolve-config（把 D1_DATABASE_ID 注入构建环境的 wrangler.jsonc，用完即弃）
→ wrangler d1 migrations apply --remote（幂等）
→ wrangler deploy（上线；dashboard 里的 Secrets 自动保留）
```

全绿即部署完成。此后每次 push `main` 都自动重复这一流程。

### 第 6 步：初始化与验证

1. 访问 `https://你的域名/setup`，输入第 3 步的 `SETUP_TOKEN`
2. 注册第一个 Passkey → **立即保存恢复码**（只显示一次）
3. 验证清单：登录一次成功 · 上传一个文件 · 创建一个分享链接并能打开

### 备选：dashboard 关联 Git（不用 GitHub Actions）

Workers & Pages → Create → Workers → **Import an existing repository**（注意是 Workers，不是 Pages）。
先在 Worker 的 **Settings → Build variables** 定义 `D1_DATABASE_ID`（同第 4 步的值），然后：

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

Worker → **Settings** → **Domains & Routes** → **Add → Custom domain** → 填子域名（如 `drive.example.com`）→ 等 Active。
然后把 `APP_PUBLIC_URL` Secret 的值更新为该域名并重新部署（Secret 改值会自动触发一次部署）。
**Passkey 与域名绑定**：换域名后需在新域名下用密码/恢复码登录一次，再重新注册 Passkey。

### 部署失败排查

| 现象 | 原因 |
|---|---|
| 迁移步骤报 `authentication error` | API Token 缺 `D1 Edit` 权限，回第 2 步补勾 |
| 部署步骤报找不到 D1 / binding 错误 | `D1_DATABASE_ID` Secret 缺失或复制带了空格 |
| 部署步骤报 R2 权限/不存在 | Token 缺 R2 权限，或桶名与 `wrangler.jsonc` 的 `bucket_name` 不一致 |
| 冒烟测试失败 | 打开该步骤日志看具体断言，多为代码回归 |
| 线上 401 / 功能异常但部署成功 | 回第 3 步检查三个 Cloudflare Secrets 是否都存在 |

---

## 生产建议

| 项 | 说明 |
|---|---|
| 自定义域名 | iOS Safari 对 `*.workers.dev` 的 WebAuthn 体验欠佳，强烈建议自有域名 |
| 备份 | R2 无原生版本化：定期 `rclone sync`（S3 兼容）到本地/异地；`wrangler d1 export` 导出元数据 |
| Cron | 已配置每日清理（回收站 30 天、遗留分块上传、过期分享记录），无需额外操作 |
| 加固 | 可在 Cloudflare Zero Trust 给除 `/s/*` 外的路径套 Access，作为应急开关 |

## 成本参考

| 用法 | 月成本 |
|---|---|
| 轻量使用（<10GB、以 Passkey 登录为主） | $0（免费额度内） |
| 照片/视频仓库（100GB 级）或需要密码功能稳定 | ≈ $6.5（$5 Workers Paid + $1.5 R2 存储，流量永久免费） |

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（API 8787 + 页面 5173） |
| `npm run build` | 构建前端到 `dist/client` |
| `npm run typecheck` | Worker + 前端双端类型检查 |
| `npm run db:migrate:local` / `:remote` | 应用 D1 迁移 |
| `npm run smoke` | API 全链路冒烟测试（需本地 API 已启动、已迁移） |
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
- 登录爆破：5 次失败锁 15 分钟（指数累计）；分享密码同策略，失效分享统一 404 不泄露原因
- 分享 token：128-bit 随机，库内只存哈希；完整链接仅创建时显示一次
- 响应头：CSP / nosniff / noindex（分享页）等由 `_headers` 注入
- 机密管理：代码与 git 历史不含任何密钥、ID 与域名（见部署章节的值流向总表）
