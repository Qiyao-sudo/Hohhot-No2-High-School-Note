// ============================================================
// 图片描述生成脚本(识图): 用 DeepSeek 视觉能力为 docs 里全部
// 无 alt 图片生成简短中文描述, 缓存到 server/data/image-captions.json。
// build-kb.mjs 会把描述写进知识库, 让图片可被检索、可被助手引用。
//
// 用法: npm run caption            # 只补缺失的(增量, 便宜)
//       npm run caption -- --force # 全部重新生成
//
// 图片文件名是源文档 URL 的 md5 前 16 位(sync_doc.py), 内容不变则
// 文件名不变, 天然适合做缓存键。无 DEEPSEEK_API_KEY 或网络失败时
// 打印警告并退出(退出码 0), 保证 npm run build 在任何环境都能跑通。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const docsDir = path.join(root, 'docs')
const imgDir = path.join(docsDir, 'public', 'images')
const cacheFile = path.join(root, 'server', 'data', 'image-captions.json')

const CONCURRENCY = 4
const MAX_BYTES = 4 * 1024 * 1024 // 超大图跳过, 控制请求体积

const PROMPT = `你是文档网站的图片标注员。用一句简体中文描述这张图片:先说类型(照片/截图/表格/海报/通知等),再说核心内容;图内有关键文字(标题、时间、地点、要求)时务必概括进去。不超过 60 字,直接输出描述,不要任何前缀和引号。`

// ------------------------------------------------------------ 收集引用
const refs = new Set()
for (const f of fs.readdirSync(docsDir)) {
  if (!f.endsWith('.md')) continue
  const raw = fs.readFileSync(path.join(docsDir, f), 'utf8')
  for (const m of raw.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    if (m[1].startsWith('/images/')) refs.add(path.basename(m[1]))
  }
}
if (!refs.size) {
  console.log('[caption] 文档中没有引用站内图片, 跳过')
  process.exit(0)
}

// ------------------------------------------------------------ 缓存
let cache = {}
try {
  cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
} catch { /* 首次运行或缓存损坏, 从零开始 */ }

// 只保留磁盘上仍存在的图片条目(源文档删图后清理陈旧描述)
const onDisk = new Set(fs.readdirSync(imgDir))
for (const k of Object.keys(cache)) {
  if (!onDisk.has(k)) delete cache[k]
}

const force = process.argv.includes('--force')
const todo = [...refs].filter((n) => force || !cache[n])
console.log(
  `[caption] 引用图片 ${refs.size} 张, 已有描述 ${refs.size - todo.length} 张, 待生成 ${todo.length} 张`
)
if (!todo.length) process.exit(0)

// ------------------------------------------------------------ API 调用
// 手动读取仓库根 .env(兼容 Node 18/20, 不依赖 --env-file 参数); 不存在则跳过
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const apiKey = process.env.DEEPSEEK_API_KEY || ''
if (!apiKey) {
  console.warn('[caption] 未配置 DEEPSEEK_API_KEY, 跳过描述生成(知识库将只收录图片地址)')
  process.exit(0)
}
const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' }

async function captionOne(name) {
  const file = path.join(imgDir, name)
  const stat = fs.statSync(file)
  if (stat.size > MAX_BYTES) throw new Error(`图片过大(${Math.round(stat.size / 1024)}KB)`)
  const b64 = fs.readFileSync(file).toString('base64')
  const mime = MIME[path.extname(name).toLowerCase()] || 'image/webp'

  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          thinking: { type: 'disabled' }, // 描述任务不需要思考, 省时省钱
          max_tokens: 200,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
              ],
            },
          ],
        }),
      })
      if (res.status === 429) throw new Error('限流, 稍后重试')
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`)
      const data = await res.json()
      const text = (data.choices?.[0]?.message?.content || '').trim().replace(/^["'「」]|["'「」]$/g, '')
      if (!text) throw new Error('空描述')
      return text.slice(0, 120)
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw lastErr
}

// 简单并发池
let done = 0
let failed = 0
const queue = [...todo]
async function worker() {
  while (queue.length) {
    const name = queue.shift()
    try {
      cache[name] = await captionOne(name)
    } catch (e) {
      failed++
      console.warn(`[caption] ✗ ${name}: ${e.message}`)
    }
    if (++done % 10 === 0 || !queue.length) {
      console.log(`[caption] 进度 ${done}/${todo.length}${failed ? `, 失败 ${failed}` : ''}`)
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + '\n') // 中途落盘, 断点不丢
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + '\n')
console.log(
  failed
    ? `[caption] 完成, ${failed} 张失败(下次运行会自动重试); 已写入 ${path.relative(root, cacheFile)}`
    : `[caption] 全部完成 → ${path.relative(root, cacheFile)}`
)
