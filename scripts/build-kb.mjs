// ============================================================
// 文档助手知识库构建脚本
// 读取 docs/*.md(由 sync_doc.py 从源文档生成), 按标题切块并生成
// server/data/kb.mjs, 供后端检索(RAG)与前端引用溯源使用。
//
// 用法: node scripts/build-kb.mjs
// 随 npm run build 自动执行, 源文档同步后重新构建即可更新知识库。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const docsDir = path.join(root, 'docs')
const outFile = path.join(root, 'server', 'data', 'kb.mjs')

// 收录进知识库的页面(排除首页/留言处/维护者指南, 它们没有问答价值)
const PAGES = [
  ['freshman.md', '新生须知'],
  ['daily.md', '日常生活'],
  ['student-org.md', '学生会·国旗班·播音站'],
  ['clubs.md', '社团相关'],
  ['study-policy.md', '学习政策与环境'],
  ['management.md', '日常管理'],
  ['tradition.md', '二中传统'],
  ['study.md', '学习板块'],
  ['jinchuan.md', '金川校区情况'],
  ['afterword.md', '后记'],
]

// 与 VitePress 完全一致的锚点 slugify(逐字符复制自 vitepress 源码),
// 保证引用跳转的 #锚点 与站点实际渲染一致。
const rControl = /[\u0000-\u001f]/g
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g
const rCombining = /[\u0300-\u036f]/g
const slugify = (str) =>
  str
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()

// 正文清洗: 去掉样式标签保留文字、丢弃图片/HTML注释/同步横幅
function cleanLine(line) {
  return line
    .replace(/<!--.*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<\/?(?:span|strong|em|mark|sub|sup|b|i|u|s|code|br|div|section|font|a)\b[^>]*>/gi, '')
    .trim()
}

// 单个块超过该长度时按段落二次切分(中文约 1 字 = 1 token, 控制上下文体积)
const MAX_CHUNK_CHARS = 1100

const pages = []
const chunks = []

for (const [file, pageTitle] of PAGES) {
  const full = path.join(docsDir, file)
  if (!fs.existsSync(full)) {
    console.warn(`[build-kb] 缺少 ${file}, 跳过`)
    continue
  }
  const raw = fs.readFileSync(full, 'utf8')
  const pagePath = '/' + file.replace(/\.md$/, '')
  const anchorSeen = new Map() // slug -> 次数, 复刻 markdown-it-anchor 去重规则

  // frontmatter 跳过
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')

  const sections = [] // { heading, slug, lines[] }
  let current = null
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^(#{2,4})\s+(.*)$/)
    if (h) {
      current = { heading: cleanLine(h[2]), slug: '', lines: [] }
      sections.push(current)
      // markdown-it-anchor: 同页重复标题依次追加 -1/-2…
      let slug = slugify(current.heading)
      const n = (anchorSeen.get(slug) ?? 0) + 1
      anchorSeen.set(slug, n)
      if (n > 1) slug = `${slug}-${n - 1}`
      current.slug = slug
      continue
    }
    if (!current) continue
    const cleaned = cleanLine(line)
    if (!cleaned) continue
    // 丢弃自动同步横幅与空引用行
    if (cleaned.startsWith('>')) {
      if (cleaned.includes('自动同步')) continue
      const quote = cleaned.replace(/^>\s*/, '')
      if (quote) current.lines.push(quote)
      continue
    }
    current.lines.push(cleaned)
  }

  pages.push({ title: pageTitle, path: pagePath, file })

  for (const sec of sections) {
    if (!sec.lines.length) continue
    const paras = sec.lines.join('\n').split(/\n+/)
    let buf = []
    let len = 0
    const flush = () => {
      if (!buf.length) return
      chunks.push({
        page: pageTitle,
        path: pagePath,
        heading: sec.heading,
        anchor: sec.slug,
        text: buf.join('\n').slice(0, 1600),
      })
      buf = []
      len = 0
    }
    for (const p of paras) {
      if (len + p.length > MAX_CHUNK_CHARS && buf.length) flush()
      buf.push(p)
      len += p.length
    }
    flush()
  }
}

if (!chunks.length) {
  console.error('[build-kb] 未生成任何知识块, 请检查 docs/*.md 是否存在')
  process.exit(1)
}

const banner = `// 自动生成: node scripts/build-kb.mjs (勿手改, 会被覆盖)
// 知识库: ${pages.length} 个页面 / ${chunks.length} 个内容块
export const generatedAt = ${JSON.stringify(new Date().toISOString())}
export const pages = ${JSON.stringify(pages)}
export const chunks = ${JSON.stringify(chunks)}
`
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, banner)
console.log(`[build-kb] ${pages.length} 页 / ${chunks.length} 块 → server/data/kb.mjs`)
