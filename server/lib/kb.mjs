// ============================================================
// 知识库检索: 中文 bigram + 词元 BM25 打分
// 分词策略与站点本地搜索(docs/.vitepress/config.ts)保持一致:
// 拉丁字母/数字整词 + 汉字单字与相邻二元组, 保证"校服"能命中
// "秋季校服"等子串。
// ============================================================
import { chunks as allChunks, pages as allPages, generatedAt } from '../data/kb.mjs'

export function tokenize(text) {
  const tokens = []
  for (const m of text.matchAll(/[a-zA-Z0-9]+/g)) tokens.push(m[0].toLowerCase())
  for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length; i++) {
      tokens.push(run.slice(i, i + 1))
      if (i + 2 <= run.length) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

let index = null

function getIndex() {
  if (index) return index
  const df = new Map()
  const docs = allChunks.map((c) => {
    const tf = new Map()
    for (const t of tokenize(c.text)) tf.set(t, (tf.get(t) ?? 0) + 1)
    const headTf = new Set(tokenize(`${c.page} ${c.heading}`))
    for (const t of new Set([...tf.keys(), ...headTf])) {
      df.set(t, (df.get(t) ?? 0) + 1)
    }
    return { c, tf, headTf }
  })
  index = { docs, df, N: docs.length }
  return index
}

// 返回与 query 最相关的 k 个知识块(同小节的分块最多保留 2 个, 避免单节刷屏)
export function search(query, k = 6) {
  const qTokens = [...new Set(tokenize(String(query ?? '')))]
  if (!qTokens.length) return []
  const { docs, df, N } = getIndex()
  const perHeading = new Map()
  const scored = []
  for (const d of docs) {
    let s = 0
    for (const t of qTokens) {
      const idf = Math.log(1 + N / (1 + (df.get(t) ?? 0)))
      const tf = d.tf.get(t) ?? 0
      if (tf) s += idf * Math.min(tf, 3)
      if (d.headTf.has(t)) s += idf * 4
    }
    if (s > 0) scored.push({ chunk: d.c, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  const out = []
  for (const { chunk, score } of scored) {
    const key = `${chunk.path}#${chunk.heading}`
    const n = (perHeading.get(key) ?? 0) + 1
    if (n > 2) continue
    perHeading.set(key, n)
    out.push({ chunk, score })
    if (out.length >= k) break
  }
  return out
}

// 截取与查询最相关的片段作为检索结果摘要
export function snippetFor(text, query, max = 120) {
  const qTokens = [...new Set(tokenize(query))]
    .filter((t) => t.length >= 2 || /[\u4e00-\u9fff]/.test(t))
    .sort((a, b) => b.length - a.length)
  let pos = -1
  for (const t of qTokens) {
    const i = text.indexOf(t)
    if (i >= 0) {
      pos = i
      break
    }
  }
  if (pos < 0) return text.slice(0, max)
  const start = Math.max(0, pos - Math.floor(max / 3))
  const snip = text.slice(start, start + max)
  return (start > 0 ? '…' : '') + snip + (start + max < text.length ? '…' : '')
}

export function kbStats() {
  return {
    pages: allPages.length,
    chunks: allChunks.length,
    generatedAt,
  }
}

export { allPages }
