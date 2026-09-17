/**
 * 部署前把真实的 D1 database_id 注入 wrangler.jsonc（仅存在于构建环境，不落 git）。
 *
 * 用法：D1_DATABASE_ID=<uuid> node scripts/resolve-config.mjs
 *   - GitHub Actions：Secret D1_DATABASE_ID 已在 workflow env 中声明
 *   - dashboard Workers Builds：在 Build variables 里定义 D1_DATABASE_ID
 *   - 本地开发：无需设置 —— 占位符 ID 即可，本地不校验真实数据库
 */
import { readFileSync, writeFileSync } from 'node:fs'

const CONFIG = 'wrangler.jsonc'
const id = process.env.D1_DATABASE_ID?.trim()

if (!id) {
  console.log('[resolve-config] D1_DATABASE_ID 未设置，保持 wrangler.jsonc 原样（本地开发无需真实 ID）')
  process.exit(0)
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error('[resolve-config] D1_DATABASE_ID 不是合法的 UUID，请检查 GitHub Secret / 构建变量')
  process.exit(1)
}

const src = readFileSync(CONFIG, 'utf8')
if (!/"database_id"\s*:\s*"/.test(src)) {
  console.error('[resolve-config] wrangler.jsonc 中找不到 database_id 字段')
  process.exit(1)
}

writeFileSync(CONFIG, src.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${id}$2`))
console.log('[resolve-config] 已将真实 D1 database_id 注入构建环境的 wrangler.jsonc')
