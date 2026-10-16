// 评论区通用小工具：确定性头像配色 / 时间格式化 / 已赞集合本地存储
// 本文件所有 localStorage 访问都只在客户端生命周期（onMounted / 事件处理）中被调用

// ---------------------------------------------------------------- 头像
// 昵称哈希 → 确定性渐变 + 首字。同一昵称永远同色同字，无需存储。
// 渐变两端的明度都压在中深色区，保证白字在明暗主题下都有足够对比度。
const GRADIENTS: [string, string][] = [
  ['#0f766e', '#0e7490'], // 青 → 深青蓝
  ['#b45309', '#c2410c'], // 琥珀 → 橙
  ['#be185d', '#9f1239'], // 品红 → 玫红
  ['#4d7c0f', '#3f6212'], // 草绿 → 橄榄
  ['#1d4e89', '#1e40af'], // 藏蓝 → 宝蓝
  ['#5b21b6', '#6d28d9'], // 深紫 → 紫罗兰
  ['#7c2d12', '#9a3412'], // 赭石 → 砖橙
  ['#155e75', '#164e63'], // 湖蓝 → 深湖蓝
  ['#9f1239', '#881337'], // 玫红 → 酒红
  ['#475569', '#334155'], // 石板灰（中性兜底）
]

export function avatarFor(name: string) {
  const s = (name || '').trim() || '访'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const [from, to] = GRADIENTS[h % GRADIENTS.length]
  const initial = [...s][0]?.toUpperCase() || '?'
  return { bg: `linear-gradient(135deg, ${from}, ${to})`, initial }
}

// ---------------------------------------------------------------- 时间
export function relTime(t: number) {
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  const d = new Date(t)
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`
}

export function absTime(t: number) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

// ---------------------------------------------------------------- 已赞集合
const LIKED_KEY = 'hs2-comment-likes'

export function loadLiked(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(LIKED_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistLiked(set: Set<string>) {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify([...set].slice(-500)))
  } catch {
    /* 静默失败 */
  }
}

export function rememberLiked(set: Set<string>, id: string) {
  set.add(id)
  persistLiked(set)
}

export function forgetLiked(set: Set<string>, id: string) {
  set.delete(id)
  persistLiked(set)
}
