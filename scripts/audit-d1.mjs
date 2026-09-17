/**
 * D1 语句执行审计：找出构建了 prepared statement 但从未执行（.run/.all/.first/.batch）的语句。
 * 这类 bug 会静默失败——端点照常返回成功，但数据没写库。
 *
 * 实现：对源码里每个 .prepare( 出现的位置，向后截取到语句结束（分号），
 * 检查窗口内是否出现执行器调用。放入 CI（deploy workflow 的类型检查步）作为回归防线。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    const s = statSync(p)
    return s.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

const EXECUTORS = new RegExp('\\.\\s*(run\\(\\s*\\)|all(\\s*<|\\s*\\()|first(\\s*<|\\s*\\()|batch\\()')
let bad = 0

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8')
  let idx = src.indexOf('.prepare(')
  while (idx !== -1) {
    const lineStart = src.lastIndexOf('\n', idx) + 1
    const lineText = src.slice(lineStart, src.indexOf('\n', lineStart))
    // 行内标注 audit-ok 表示该语句经 batch 等方式在别处执行（如 stmts 数组）
    if (!lineText.includes('audit-ok')) {
      const end = src.indexOf(';', idx)
      const window = end === -1 ? src.slice(idx) : src.slice(idx, end)
      if (!EXECUTORS.test(window)) {
        bad++
        const line = src.slice(0, idx).split('\n').length
        console.log(`${file}:${line}  statement built but never executed`)
      }
    }
    idx = src.indexOf('.prepare(', idx + 1)
  }
}

if (bad > 0) {
  console.error(`\n${bad} 个 D1 语句缺少执行器（.run()/.all()/.first()/.batch()）`)
  process.exit(1)
}
console.log('D1 语句审计通过：所有 prepare 都有执行器')
