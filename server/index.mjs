// ============================================================
// 文档助手后端 · 独立部署入口
// 用法: npm run assistant  (自动加载仓库根目录 .env)
//   或: DEEPSEEK_API_KEY=sk-xxx PORT=8787 node server/index.mjs
// ============================================================
import http from 'node:http'
import { handle } from './lib/app.mjs'
import { deepseekConfig } from './lib/deepseek.mjs'
import { kbStats } from './lib/kb.mjs'

const port = Number(process.env.PORT || 8787)
const cfg = deepseekConfig()
const kb = kbStats()

const server = http.createServer(handle)
server.listen(port, () => {
  console.log(`[assistant] 文档助手后端已启动: http://localhost:${port}`)
  console.log(`[assistant] 模型: ${cfg.model} | API Key: ${cfg.apiKey ? '已配置' : '❌ 未配置(请在 .env 或环境变量中设置 DEEPSEEK_API_KEY)'}`)
  console.log(`[assistant] 知识库: ${kb.pages} 页 / ${kb.chunks} 块 (生成于 ${kb.generatedAt})`)
  console.log('[assistant] 接口: GET /health · POST /search · POST /ask (SSE)')
})
