// ============================================================
// 文档助手 HTTP 服务(零依赖, Node 18+)
// 同一段代码三种宿主:
//   - 云服务器同源部署: node server/index.mjs (PORT=80, 默认托管 ../dist 静态站)
//   - 独立部署后端: node server/index.mjs (PORT 环境变量, 默认 8787)
//   - Vercel Serverless: api/assistant/[...route].js → /api/assistant/*
//
// 路由:
//   GET  /health   健康检查与配置状态(前端据此显示降级提示)
//   POST /search   纯检索(不调模型): { query } → 结果卡片
//   POST /ask      RAG 问答: { messages, stream? } → SSE 流式回答
//   GET  /*        静态文件(设 STATIC_ROOT 时启用, 见 lib/static.mjs)
// ============================================================
import { deepseekConfig, streamChat, UpstreamError } from './deepseek.mjs'
import { search, snippetFor, kbStats } from './kb.mjs'
import { rateLimit, clientIp } from './ratelimit.mjs'
import { buildSystemPrompt } from './prompt.mjs'
import { serveStatic, staticRoot } from './static.mjs'

const VERSION = '1.0.0'
const HOUR = 3600_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new UpstreamError('请求体过大。', 413)
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new UpstreamError('请求体不是合法 JSON。', 400)
  }
}

// 只保留最近几轮 user/assistant 消息送入模型, 控制上下文长度
function sanitizeMessages(input) {
  if (!Array.isArray(input)) return null
  const msgs = []
  for (const m of input.slice(-12)) {
    if (!m || typeof m !== 'object') return null
    const role = m.role === 'user' || m.role === 'assistant' ? m.role : null
    const content = typeof m.content === 'string' ? m.content.trim().slice(0, 4000) : ''
    if (!role || !content) return null
    msgs.push({ role, content })
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null
  return msgs
}

// 检索词 = 最近两条用户消息拼接(便于"那金川呢"这类追问)
function retrievalQuery(messages) {
  return messages
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content)
    .join(' ')
    .slice(0, 240)
}

function toPublicSource(s, i) {
  return {
    n: i + 1,
    page: s.chunk.page,
    path: s.chunk.path,
    heading: s.chunk.heading,
    anchor: s.chunk.anchor,
  }
}

export async function handle(req, res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // 兼容独立部署(/ask)与 Vercel(/api/assistant/ask)两种挂载路径
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    pathname = req.url.split('?')[0]
  }
  pathname = pathname.replace(/^\/api\/assistant(?=\/|$)/, '').replace(/\/+$/, '') || '/'

  const ip = clientIp(req)
  const { apiKey, model } = deepseekConfig()

  try {
    // ---------------------------------------------------------- health
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        configured: Boolean(apiKey),
        model: apiKey ? model : null,
        kb: kbStats(),
      })
      return
    }

    // ---------------------------------------------------------- search
    if (req.method === 'POST' && pathname === '/search') {
      const rl = rateLimit(`s:${ip}`, Number(process.env.ASSISTANT_RATE_SEARCH ?? 120), HOUR)
      if (!rl.ok) {
        sendJson(res, 429, { error: `检索太频繁了, 请 ${Math.ceil(rl.retryAfterSec / 60)} 分钟后再试。` })
        return
      }
      const { query } = await readJsonBody(req)
      const q = String(query ?? '').trim().slice(0, 200)
      if (!q) {
        sendJson(res, 400, { error: '请输入要检索的内容。' })
        return
      }
      const results = search(q, 8).map((s) => ({
        page: s.chunk.page,
        path: s.chunk.path,
        heading: s.chunk.heading,
        anchor: s.chunk.anchor,
        snippet: snippetFor(s.chunk.text, q),
      }))
      sendJson(res, 200, { query: q, results })
      return
    }

    // ---------------------------------------------------------- ask (RAG + SSE)
    if (req.method === 'POST' && pathname === '/ask') {
      if (!apiKey) {
        sendJson(res, 503, { error: '文档助手后端尚未配置 DEEPSEEK_API_KEY, 无法回答。' })
        return
      }
      const rl = rateLimit(`a:${ip}`, Number(process.env.ASSISTANT_RATE_ASK ?? 30), HOUR)
      if (!rl.ok) {
        sendJson(res, 429, { error: `提问次数有点多, 请 ${Math.ceil(rl.retryAfterSec / 60)} 分钟后再试。` })
        return
      }
      const body = await readJsonBody(req)
      const messages = sanitizeMessages(body.messages)
      if (!messages) {
        sendJson(res, 400, { error: '消息格式不正确。' })
        return
      }

      const sources = search(retrievalQuery(messages), 6)
      const sysPrompt = buildSystemPrompt(sources)
      const modelMessages = [
        { role: 'system', content: sysPrompt },
        ...messages.slice(-7),
      ]

      const wantStream = body.stream !== false
      if (!wantStream) {
        let answer = ''
        let usage = null
        for await (const p of streamChat({ messages: modelMessages })) {
          if (p.type === 'delta') answer += p.text
          else usage = p.usage
        }
        sendJson(res, 200, { answer, sources: sources.map(toPublicSource), usage })
        return
      }

      res.writeHead(200, {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      res.flushHeaders?.()
      send('meta', { sources: sources.map(toPublicSource), model })

      // 心跳保活: 模型思考/生成间歇期发注释行, 防止网关(腾讯云托管等)
      // 因连接空闲超时掐断 SSE; 客户端已断开时停止写入
      let clientGone = false
      const heartbeat = setInterval(() => {
        try {
          if (!clientGone && !res.writableEnded) res.write(': ping\n\n')
        } catch {
          /* 连接已断, 等 req close 清理 */
        }
      }, 15000)
      req.on('close', () => {
        clientGone = true
        clearInterval(heartbeat)
      })

      let usage = null
      try {
        for await (const p of streamChat({ messages: modelMessages })) {
          if (clientGone) break
          if (p.type === 'delta') send('delta', { t: p.text })
          else usage = p.usage
        }
        if (!clientGone) send('done', { usage })
      } catch (e) {
        if (!clientGone) {
          if (e?.name === 'AbortError') send('done', { aborted: true })
          else send('error', { message: e instanceof UpstreamError ? e.message : '生成回答时出错, 请稍后重试。' })
        }
      } finally {
        clearInterval(heartbeat)
        req.removeAllListeners('close')
      }
      res.end()
      return
    }

    // ---------------------------------------------------------- 静态文件
    if (serveStatic(req, res, pathname)) return

    sendJson(res, 404, { error: `未知接口: ${req.method} ${pathname}` })
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 500
    if (!res.headersSent) sendJson(res, status, { error: e.message || '服务器内部错误。' })
    else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`)
      res.end()
    }
  }
}
