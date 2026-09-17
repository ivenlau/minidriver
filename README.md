# MiniDriver

部署在 Cloudflare Workers 生态上的单用户个人网盘：**Passkey 快速登录 · 文件管理 · 临时分享 · 中英双语 · 亮暗主题**，桌面与移动浏览器自适应。

> 设计细节见 [DESIGN.md](./DESIGN.md)。

## 功能

- **认证**：Passkey（触控 ID / 面容 ID / Windows Hello / 安全密钥，支持登录页 autofill 一键登录）；可选密码 + TOTP 备用通道；一次性恢复码防死锁；设备会话管理
- **文件**：分块上传（8MiB 分块、断点重试、浏览器端生成缩略图）、流式下载（Range / 断点续传）、目录树、重命名 / 移动 / 星标 / 搜索 / 回收站（30 天）
- **分享**：限时 / 限次 / 可选密码的临时链接，访客页可在线预览（图片 / 视频 / 音频 / PDF / 文本），随时吊销
- **体验**：React + Tailwind v4 语义 token 双主题（亮 / 暗 / 跟随系统）、`react-i18next` 中英双语、桌面侧栏 + 移动底部导航、拖拽上传、长按多选

## 技术栈

Cloudflare Workers（Hono）· R2（文件，零出口流量费）· D1（SQLite 元数据）· React 19 + Vite + TanStack Query + react-router · @simplewebauthn v14

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

> 本地可用 Chrome/Edge/1Password 等虚拟 Passkey。无浏览器环境时可跑 API 冒烟测试（内置伪造认证器，60 项断言）：
>
> ```bash
> npm run dev:api        # 终端 1
> npm run smoke          # 终端 2（先 db:migrate:local）
> ```

## 部署到 Cloudflare

### 一次性前置（两种方式共用，约 5 分钟）

1. dashboard → R2 → 创建桶 `minidriver`（首次启用 R2 需绑卡，免费额度内不扣费）
2. dashboard → D1 → 创建数据库 `minidriver`，把 **Database ID** 填入 `wrangler.jsonc` 后提交
   （database_id 不是机密，可以提交；机密是下面两项）
3. 设置 Secrets（dashboard → Worker → Settings → Variables and Secrets，设置一次永久生效）：
   - `SESSION_ENC_KEY`：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `SETUP_TOKEN`：自拟一次性初始化口令
4. `APP_PUBLIC_URL` **留空即可**：自动使用访问时的域名。之后若绑定自定义域名并希望分享链接/Passkey 以主域名为准，再填上它

### 方式 A：GitHub 自动部署（推荐，仓库已含工作流）

`.github/workflows/deploy.yml` 会在每次 push `main` 时自动执行：
**类型检查 → 构建 → 本地冒烟测试（60 项断言）→ 远程 D1 迁移（幂等）→ wrangler deploy**

配置（GitHub 仓库 → Settings → Secrets and variables → Actions）：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 用「Edit Cloudflare Workers」模板创建，额外勾选 Account·D1 Edit、Account·Workers R2 Storage Bucket Item Edit |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard 首页右侧可见 |

### 方式 B：dashboard 关联 Git（Workers Builds）

Workers & Pages → Create → Workers → **Import an existing repository**（注意是 Workers，不是 Pages）：

| 设置项 | 值 |
|---|---|
| Build command | `npm run build && npx wrangler d1 migrations apply minidriver --remote` |
| Deploy command | `npx wrangler deploy` |

构建环境自带授权，Build command 里的迁移即可远程执行，无需本地 wrangler 登录。

### 首次初始化

部署完成后访问 `https://<你的域名>/setup`：输入 `SETUP_TOKEN` → 注册第一个 Passkey → **保存恢复码**（此后永久关闭）。

### 生产建议

| 项 | 说明 |
|---|---|
| 自定义域名 | Workers → 设置 → 域名与路由绑定；iOS Safari 对 `*.workers.dev` 的 WebAuthn 体验欠佳 |
| 备份 | R2 无原生版本化：定期 `rclone sync`（S3 兼容）到本地/异地；`wrangler d1 export` 导出元数据 |
| Cron | 已配置每日清理（回收站 30 天、遗留分块上传、过期分享记录），无需额外操作 |
| 加固 | 可在 Cloudflare Zero Trust 给除 `/s/*` 外的路径套 Access，作为应急开关 |

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（API 8787 + 页面 5173） |
| `npm run build` | 构建前端到 `dist/client` |
| `npm run deploy` | 构建 + 部署到 Cloudflare |
| `npm run typecheck` | Worker + 前端双端类型检查 |
| `npm run db:migrate:local` / `:remote` | 应用 D1 迁移 |
| `npm run smoke` | API 全链路冒烟测试（需本地 API 已启动、已迁移） |

## 项目结构

```
src/          Worker（Hono API：auth / nodes / files / shares / public + Cron 清理）
web/          React SPA（页面 / 组件 / i18n / 上传队列 / 主题）
migrations/   D1 SQL 迁移
scripts/      smoke.mjs —— 伪造 WebAuthn 认证器的 API 冒烟测试
```

## 安全模型速览

- 会话：`__Host-` Cookie（HttpOnly + Secure + SameSite=Lax），库内只存 SHA-256，滑动 30 天 / 绝对 90 天
- CSRF：SameSite + Origin 校验 + 自定义头三重防线
- 登录爆破：5 次失败锁 15 分钟（指数累计）；分享密码同策略，失效分享统一 404 不泄露原因
- 分享 token：128-bit 随机，库内只存哈希；完整链接仅创建时显示一次
- 响应头：CSP / nosniff / noindex（分享页）等由 `_headers` 注入
