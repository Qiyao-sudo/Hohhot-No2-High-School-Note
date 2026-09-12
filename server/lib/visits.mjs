// ============================================================
// 自建访问统计: PV 口径——每次页面访问 +1, 同 IP 也累计;
// 同 IP 60 秒内的重复访问(刷新/切页)只计一次, 防刷新灌水。
// 持久化到 server/../visits.json(即部署根目录, 与 .env 同级),
// server 目录整体更新部署时计数不会被覆盖。日界按北京时间。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE =
  process.env.VISITS_FILE ||
  path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '..', 'visits.json')

// 同 IP 两次计数的最小间隔(毫秒), 可用 VISIT_INTERVAL_MS 覆盖
const INTERVAL = Number(process.env.VISIT_INTERVAL_MS ?? 60_000)

let data = { pv: 0, pvToday: '', pvTodayCount: 0, ips: {} }
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (loaded.ips) {
    // 归一化旧值(日期字符串 → 0), 保证与时间戳比较安全
    for (const k of Object.keys(loaded.ips)) {
      loaded.ips[k] = Number(loaded.ips[k]) || 0
    }
  }
  // 兼容旧字段名
  data = { ...data, ...loaded, pv: loaded.pv ?? loaded.total ?? 0 }
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
  const now = Date.now()
  const d = bjToday()
  if (data.pvToday !== d) {
    data.pvToday = d
    data.pvTodayCount = 0
  }
  const last = Number(data.ips[ip]) || 0
  if (now - last >= INTERVAL) {
    data.pv += 1
    data.pvTodayCount += 1
    data.ips[ip] = now
    // 防膨胀: IP 记录超过 2 万条时, 清掉 180 天未活跃的
    const keys = Object.keys(data.ips)
    if (keys.length > 20000) {
      const cut = now - 180 * 86400_000
      for (const k of keys) if (data.ips[k] < cut) delete data.ips[k]
    }
    persist()
  }
  return { pv: data.pv, today: data.pvTodayCount }
}
