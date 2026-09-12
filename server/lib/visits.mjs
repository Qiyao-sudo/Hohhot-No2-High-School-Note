// ============================================================
// 自建访客统计: 按 IP 去重的累计 UV + 每日 UV。
// 持久化到 server/../visits.json(即部署根目录, 与 .env 同级),
// server 目录整体更新部署时计数不会被覆盖。
// 日界按北京时间; 纯本地文件, 无第三方依赖。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE =
  process.env.VISITS_FILE ||
  path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '..', 'visits.json')

let data = { total: 0, today: '', todayCount: 0, ips: {} }
try {
  data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
} catch { /* 首次运行 */ }

function bjToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

let saveTimer = null
function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.writeFileSync(FILE, JSON.stringify(data))
    } catch { /* 写失败不影响内存计数, 下次再落盘 */ }
  }, 3000)
}
process.on('exit', () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data))
  } catch { /* 尽力而为 */ }
})

export function recordVisit(ip) {
  const d = bjToday()
  if (data.today !== d) {
    data.today = d
    data.todayCount = 0
  }
  const seen = data.ips[ip]
  if (!seen) data.total += 1
  if (seen !== d) data.todayCount += 1
  data.ips[ip] = d

  // 防膨胀: IP 记录超过 2 万条时, 清掉 180 天未活跃的
  const keys = Object.keys(data.ips)
  if (keys.length > 20000) {
    const cut = new Date(Date.now() - 180 * 86400_000 + 8 * 3600_000).toISOString().slice(0, 10)
    for (const k of keys) if (data.ips[k] < cut) delete data.ips[k]
  }

  persist()
  return { total: data.total, today: data.todayCount }
}
