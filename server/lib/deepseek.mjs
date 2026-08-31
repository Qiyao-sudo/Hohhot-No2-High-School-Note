// ============================================================
// DeepSeek OpenAI 兼容接口的极薄客户端(零依赖, 使用 Node 18+ 全局 fetch)
// 文档: https://api-docs.deepseek.com
// ============================================================

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

function friendlyUpstream(status, bodyText) {
  if (status === 401) return new UpstreamError('AI 服务 API Key 无效或已失效，请维护者检查 DEEPSEEK_API_KEY 配置。', 502)
  if (status === 402) return new UpstreamError('AI 服务账户余额不足，请维护者到 DeepSeek 开放平台充值。', 502)
  if (status === 429) return new UpstreamError('AI 服务请求过于频繁，请稍后再试。', 429)
  if (status >= 500) return new UpstreamError('AI 服务暂时不可用，请稍后再试。', 502)
  return new UpstreamError(`AI 服务返回错误(${status})：${bodyText.slice(0, 200)}`, 502)
}

const DEFAULT_BASE = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-v4-flash'

export function deepseekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE ?? 0.3),
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS ?? 2000),
  }
}

async function request(payload, { apiKey, baseUrl }, signal) {
  let res
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new UpstreamError('无法连接 AI 服务，请检查网络后重试。', 504)
  }
  if (!res.ok) throw friendlyUpstream(res.status, await res.text().catch(() => ''))
  return res
}

/**
 * 流式对话补全(SSE), 逐段 yield { type:'delta', text }, 最后 yield { type:'done', usage }。
 * 需要完整文本时由调用方自行拼接 delta。
 */
export async function* streamChat({ messages, temperature, maxTokens, signal }) {
  const cfg = deepseekConfig()
  const payload = {
    model: cfg.model,
    messages,
    temperature: temperature ?? cfg.temperature,
    max_tokens: maxTokens ?? cfg.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  }
  const res = await request(payload, cfg, signal)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let usage = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        yield { type: 'done', usage }
        return
      }
      let json
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.usage) usage = json.usage
      const delta = json.choices?.[0]?.delta?.content
      if (delta) yield { type: 'delta', text: delta }
    }
  }
  yield { type: 'done', usage }
}
