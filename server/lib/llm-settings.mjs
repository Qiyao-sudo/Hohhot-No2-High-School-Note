// ============================================================
// 大模型配置：文档助手与评论审核各自可选用哪个模型。
// 模型列表与用途选择存于 comments.db 的 settings 表(API Key 只留在
// 服务器库里, 对外接口仅回显掩码)；未选择或所选模型缺凭据时回落
// 环境变量(DEEPSEEK_*), 与既有部署完全兼容。
// ============================================================
import crypto from 'node:crypto'
import { deepseekConfig } from './deepseek.mjs'
import { getAppSetting, setAppSetting } from './comments.mjs'

const MODELS_KEY = 'llm_models'        // JSON: [{id, name, baseUrl, apiKey, model}]
const SELECTION_KEY = 'llm_selection'  // JSON: { assistant: id|'', review: id|'' }

/** @typedef {{ id: string, name: string, baseUrl: string, apiKey: string, model: string }} LlmModel */

export function listLlmModels() {
  try {
    const raw = JSON.parse(getAppSetting(MODELS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (m) => m && typeof m === 'object' && typeof m.baseUrl === 'string' && typeof m.model === 'string',
    ).map((m) => ({
      id: String(m.id || ''),
      name: String(m.name || m.model).slice(0, 40),
      baseUrl: m.baseUrl.replace(/\/+$/, ''),
      apiKey: String(m.apiKey || ''),
      model: String(m.model).slice(0, 60),
    }))
  } catch {
    return []
  }
}

export function saveLlmModels(models) {
  setAppSetting(MODELS_KEY, JSON.stringify(models.slice(0, 20)))
}

export function getLlmSelection() {
  try {
    const raw = JSON.parse(getAppSetting(SELECTION_KEY) || '{}')
    return { assistant: String(raw.assistant || ''), review: String(raw.review || '') }
  } catch {
    return { assistant: '', review: '' }
  }
}

export function setLlmSelection(patch) {
  const cur = getLlmSelection()
  const next = {
    assistant: patch.assistant !== undefined ? String(patch.assistant) : cur.assistant,
    review: patch.review !== undefined ? String(patch.review) : cur.review,
  }
  setAppSetting(SELECTION_KEY, JSON.stringify(next))
  return next
}

/**
 * 解析某用途当前的生效配置：所选模型存在且凭据齐全 → 用它；
 * 否则回落环境变量。返回值可直接传给 streamChat / aiReviewComment。
 */
export function llmConfig(purpose) {
  const env = deepseekConfig()
  const sel = getLlmSelection()[purpose]
  const chosen = sel ? listLlmModels().find((m) => m.id === sel) : null
  if (chosen && chosen.apiKey && chosen.baseUrl && chosen.model) {
    return {
      apiKey: chosen.apiKey,
      baseUrl: chosen.baseUrl,
      model: chosen.model,
      temperature: env.temperature,
      maxTokens: env.maxTokens,
      source: 'custom',
      name: chosen.name,
    }
  }
  return { ...env, source: 'env', name: `环境变量默认（${env.model}）` }
}

/** 掩码显示：sk-9f…abcd（只留前缀与末 4 位） */
export function maskKey(key) {
  const s = String(key || '')
  if (!s) return ''
  if (s.length <= 8) return '••••'
  return `${s.slice(0, 5)}…${s.slice(-4)}`
}

export function newModelId() {
  return 'm' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex')
}
