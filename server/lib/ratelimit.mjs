// ============================================================
// 进程内滑动窗口限流: 保护 DeepSeek 配额不被滥用。
// 独立部署时全局生效; Serverless(Vercel) 下按实例尽力而为。
// ============================================================
const buckets = new Map()

export function rateLimit(key, limit, windowMs) {
  const now = Date.now()
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) {
    buckets.set(key, arr)
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000)),
    }
  }
  arr.push(now)
  buckets.set(key, arr)
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k)
    }
  }
  return { ok: true }
}

// "ip:动作" 两个维度分开计数, 聊天与检索阈值不同
export function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
