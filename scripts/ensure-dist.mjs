/**
 * wrangler.jsonc 的 assets.directory 指向 dist/client，
 * 但 dist/ 被 gitignore —— 新克隆的机器上不存在，wrangler dev 会拒绝启动。
 * 开发时前端走 vite(5173)，wrangler 只需目录存在即可（跑一次 npm run build 后这里是真实产物）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('dist/client', { recursive: true })
if (!existsSync('dist/client/index.html')) {
  writeFileSync(
    'dist/client/index.html',
    '<!-- 开发占位：请访问 vite dev 端口 http://localhost:5173；npm run build 后此处为真实产物 -->',
  )
}
