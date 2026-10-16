// 评论区 API 层：类型定义、请求封装、能力探测
// ============================================================================
// 【评论区接口契约（预留）—— 后端重构时请对齐此契约，前端将自动点亮新功能】
//
// GET /comments 响应扩展（均为可选字段，缺省即视为不支持）：
//   capabilities?: { likes?: boolean, replies?: boolean }      显式能力声明（优先于字段嗅探）
//   comments[i].likes?: number                                 点赞数
//   comments[i].replyTo?: { id: string, nick: string } | null  被回复的评论
//
// POST /comment/like   请求体 { id } → 200 { ok: true, likes: number }
//   幂等/防刷由后端按 IP 控制；前端用 localStorage 记住已赞，
//   接口返回 404「未知接口」时本次会话内自动隐藏点赞 UI（优雅降级）。
//
// POST /comment   请求体 { nick, content, page, replyTo?: string }
//   replyTo 可选，为被回复评论的 id；回复与普通留言一样进入 pending 审核流。
// ============================================================================

declare const __ASSISTANT_API__: string | undefined

// 后端地址：构建时由 config.ts 的 vite.define 注入（同源部署为空串 → /api/assistant）
const apiBase =
  (typeof __ASSISTANT_API__ !== 'undefined' && __ASSISTANT_API__) || '/api/assistant'

export interface OwnerReply {
  content: string
  time: number
}

export interface CommentItem {
  id: string
  nick: string
  content: string
  time: number
  reply: OwnerReply | null
  likes?: number
  replyTo?: { id: string; nick: string } | null
}

export interface CommentsPage {
  comments: CommentItem[]
  nextCursor: string | null
  total: number
  capabilities?: { likes?: boolean; replies?: boolean }
}

export interface FeatureFlags {
  likes: boolean
  replies: boolean
}

// 本地联调开关：临时改为 { likes: true, replies: true } 可强制点亮对应 UI
// （绕过能力探测，便于在后端上线前联调样式；提交前必须改回 null）
export const FORCE_FEATURES: FeatureFlags | null = null

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, init)
  const data = await res.json().catch(() => ({}) as any)
  if (!res.ok) throw new ApiError(data.error || `请求失败 (${res.status})`, res.status)
  return data as T
}

export function fetchComments(page: string, cursor: string | null) {
  const q = `?page=${encodeURIComponent(page)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  return request<CommentsPage>(`/comments${q}`)
}

export function postComment(body: { nick: string; content: string; page: string; replyTo?: string }) {
  return request<{ ok: boolean; message?: string; status?: 'approved' | 'pending' | 'rejected' }>('/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function postLike(id: string) {
  return request<{ ok: boolean; likes?: number }>('/comment/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

// 能力探测：显式 capabilities 声明优先，否则嗅探首屏条目是否携带对应字段。
// 当前后端两项都探测不到 → 点赞/回复 UI 完全不渲染（无死按钮）；
// 后端按契约上线后，前端无需改动即自动激活。
export function detectFeatures(page: CommentsPage): FeatureFlags {
  if (FORCE_FEATURES) return { ...FORCE_FEATURES }
  const sniff = {
    likes: page.comments.some((c) => typeof c.likes === 'number'),
    replies: page.comments.some((c) => 'replyTo' in c),
  }
  return {
    likes: page.capabilities?.likes ?? sniff.likes,
    replies: page.capabilities?.replies ?? sniff.replies,
  }
}
