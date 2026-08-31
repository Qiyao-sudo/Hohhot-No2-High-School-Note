// Vercel Serverless 适配: 与前端同一个项目即可获得文档助手后端。
// 访问路径: /api/assistant/health | /api/assistant/search | /api/assistant/ask
// 在 Vercel 项目环境变量中配置 DEEPSEEK_API_KEY 即启用(见 docs/assistant-setup.md)。
import { handle } from '../../../server/lib/app.mjs'

export default async function handler(req, res) {
  await handle(req, res)
}

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
}
