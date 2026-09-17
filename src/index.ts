import { Hono } from 'hono'
import type { AppEnv, Env } from './lib/env'
import { originCheck, errorHandler, notFoundHandler } from './middleware'
import { auth } from './routes/auth'
import { nodes } from './routes/nodes'
import { files } from './routes/files'
import { shares } from './routes/shares'
import { publicShare } from './routes/public'
import { runMaintenance } from './scheduled'

const app = new Hono<AppEnv>()

app.use('*', originCheck)
app.onError(errorHandler)
app.notFound(notFoundHandler)

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))
// 公开分享路由必须最先挂载：authed 子应用的全局 requireAuth 中间件
// 会覆盖 /api/* 全部路径，后注册的路由无法逃逸（Hono 按注册顺序组装）
app.route('/api', publicShare)
app.route('/api', auth)
app.route('/api', nodes)
app.route('/api', files)
app.route('/api', shares)

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMaintenance(env))
  },
}
