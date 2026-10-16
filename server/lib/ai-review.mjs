// ============================================================
// 留言 AI 初审: 复用 DeepSeek(OpenAI 兼容)接口做一次非流式判定。
// 返回三种结局:
//   approve — 可直接公开(调用方置为 approved)
//   reject  — AI 认为不适合公开 → 回落人工待审(附原因供管理员参考)
//   error / skip — 调用失败或未配置 Key → 回落人工待审
// 任何非 approve 结局都不公开, 人工兜底, AI 只做减负不做终审。
// ============================================================
import { UpstreamError } from './deepseek.mjs'
import { llmConfig } from './llm-settings.mjs'

const SYSTEM_PROMPT = [
  '你是留言板的初审员。判断这条留言是否适合在校园文档站的留言区公开展示。',
  '通过(approve)：正常的留言、提问、建议、感谢、同学间友好讨论。',
  '拒绝(reject)：垃圾广告、刷屏、辱骂攻击、色情低俗、赌博/引流链接、恶意灌水、与站点无关的营销内容。',
  '特别注意昵称：昵称或内容中包含任何联系方式都要拒绝——微信号/QQ/手机号/邮箱/网址，包括谐音(薇/威/微❤)、符号拆写、字母缩写(vx/wx)等变体；昵称是引流昵称而内容正常的也拒绝。',
  '拿不准时选择 reject 交给人工复审。',
  '只输出一个 JSON 对象，不要输出其他任何文字：{"verdict":"approve"或"reject","reason":"10字以内的中文理由"}',
].join('\n')

export function aiReviewConfigured() {
  return Boolean(llmConfig('review').apiKey)
}

/** 从模型回复中稳健提取 JSON（容忍代码围栏与前后杂文） */
function parseVerdict(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''))
  if (!m) return null
  try {
    const data = JSON.parse(m[0])
    if (data.verdict === 'approve' || data.verdict === 'reject') {
      return { verdict: data.verdict, reason: String(data.reason || '').slice(0, 40) || (data.verdict === 'approve' ? '适合公开' : '不适合公开') }
    }
  } catch { /* 落到 error */ }
  return null
}

/**
 * 初审一条留言。永不抛异常：失败返回 { verdict:'error', reason } 由调用方回落人工。
 */
export async function aiReviewComment({ nick, content }, { timeoutMs = 12000 } = {}) {
  const cfg = llmConfig('review')
  if (!cfg.apiKey) return { verdict: 'skip', reason: '未配置 AI Key，转人工', model: cfg.model }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `昵称：${nick}\n留言内容：${content}` },
        ],
        temperature: 0.1,
        max_tokens: 1000, // 思考型模型的思考链计入 max_tokens，留足余量
        stream: false,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new UpstreamError(`AI 初审接口返回 ${res.status}`, 502)
    }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''
    const parsed = parseVerdict(text)
    if (!parsed) return { verdict: 'error', reason: 'AI 返回格式异常，转人工', model: cfg.model }
    return { ...parsed, model: cfg.model }
  } catch (e) {
    const reason = e?.name === 'AbortError' ? 'AI 初审超时，转人工' : `AI 初审失败(${e instanceof UpstreamError ? e.message : '网络异常'})，转人工`
    return { verdict: 'error', reason, model: cfg.model }
  } finally {
    clearTimeout(timer)
  }
}
