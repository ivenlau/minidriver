import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 前端单独构建；Worker 由 wrangler 在 deploy 时构建。
// 开发时：wrangler dev(8787, API) + vite dev(5173, 页面，/api 代理到 8787)。
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
})
