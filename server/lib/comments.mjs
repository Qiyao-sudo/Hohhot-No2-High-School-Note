// ============================================================
// 自建评论区: 提交即待审(pending), 管理员在统一后台审核,
// 通过(approved)后公开展示, 驳回(rejected)仅后台可见。
//
// 存储: SQLite(node:sqlite 内置模块, 零 npm 依赖), 库文件在部署根目录
// comments.db(与 visits.json 同级), server 目录整体更新部署时数据不受影响。
// 首次启动若发现旧版 comments.json 会自动导入并把原文件改名为
// comments.json.migrated-<日期> 留档(仅在库为空时执行, 可安全重启)。
//
// 点赞: comment_likes 表按 (评论id, ip) 主键做幂等 —— 同一 IP 对同一评论
// 只计一次, 重复调用返回当前计数不递增; 防刷叠加 ratelimit 分钟/小时窗口。
// 回复: addComment 可带 replyTo(被回复评论 id), 与普通留言一样进待审;
// 公开列表仅在父评论仍为 approved 时解析出 replyTo {id, nick}。
//
// 管理鉴权: COMMENT_ADMIN_PASSWORD 环境变量 + 无状态 HMAC token
// (密码未配置时所有 /admin* 接口一律 503, 功能整体关闭)。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

// node:sqlite 需 Node 22.5+(生产 Node 24 已稳定); 用动态导入避免不支持的
// 运行时(如 Vercel Node 20)在模块加载期直接崩溃, 拖垮同进程的 /ask 等接口
let DatabaseSync = null
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch { /* 留空, 首次调用时优雅报错 */ }

const ROOT = path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '..')
const DB_FILE = process.env.COMMENTS_DB || path.join(ROOT, 'comments.db')
const LEGACY_JSON = process.env.COMMENTS_FILE || path.join(ROOT, 'comments.json')

const NICK_MAX = 24
const CONTENT_MAX = 500
const PAGE_MAX = 64
const PAGE_SIZE = 20 // 公开列表每页条数
const MAX_COMMENTS = 5000 // 容量上限, 超出时优先清理最旧的已驳回
const TOKEN_TTL = 7 * 86400_000

// ---------------------------------------------------------------- 初始化
let db = null
function ready() {
  return Boolean(db)
}

function initDb() {
  if (db || !DatabaseSync) return
  db = new DatabaseSync(DB_FILE)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(`
CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  nick          TEXT NOT NULL,
  content       TEXT NOT NULL,
  page          TEXT NOT NULL,
  ip            TEXT NOT NULL DEFAULT '',
  time          INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  reply_content TEXT,
  reply_time    INTEGER,
  reply_to_id   TEXT,
  likes         INTEGER NOT NULL DEFAULT 0,
  ai_json       TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(page, status, time);
CREATE INDEX IF NOT EXISTS idx_comments_status_time ON comments(status, time);
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL,
  ip         TEXT NOT NULL,
  time       INTEGER NOT NULL,
  PRIMARY KEY (comment_id, ip)
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)
  // 旧库升级: ai_json 列(已存在时报错忽略)
  try { db.exec('ALTER TABLE comments ADD COLUMN ai_json TEXT') } catch { /* 列已存在 */ }
  migrateLegacyJson()
}

// 旧版 comments.json → SQLite 一次性迁移(仅在库为空时; 完成后原文件留档改名)
function migrateLegacyJson() {
  let legacy = null
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'))
  } catch {
    return // 无旧文件
  }
  if (!Array.isArray(legacy.comments) || !legacy.comments.length) return
  const count = db.prepare('SELECT COUNT(*) AS n FROM comments').get().n
  if (count > 0) return // 库里已有数据, JSON 视为过期残留
  const insert = db.prepare(`
INSERT OR IGNORE INTO comments (id, nick, content, page, ip, time, status, reply_content, reply_time, reply_to_id, likes)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
  db.exec('BEGIN')
  try {
    for (const c of legacy.comments) {
      insert.run(
        String(c.id), String(c.nick ?? ''), String(c.content ?? ''), String(c.page ?? ''),
        String(c.ip ?? ''), Number(c.time) || 0,
        ['pending', 'approved', 'rejected'].includes(c.status) ? c.status : 'pending',
        c.reply?.content ?? null, c.reply?.time ?? null, null,
      )
    }
    db.exec('COMMIT')
    const backup = `${LEGACY_JSON}.migrated-${new Date().toISOString().slice(0, 10)}`
    try { fs.renameSync(LEGACY_JSON, backup) } catch { /* 改名失败不影响, 下次启动会因库非空而跳过 */ }
    console.log(`[comments] 已迁移 ${legacy.comments.length} 条旧数据 → ${DB_FILE}（原文件留档 ${path.basename(backup)}）`)
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

initDb()

// ---------------------------------------------------------------- 校验
// 去控制字符(保留换行)、去首尾空白、截断长度
function clean(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
}

function cleanPage(p) {
  const s = String(p ?? '').trim().slice(0, PAGE_MAX)
  // 站内路径: / 开头, 只允许常规 URL 字符, 不带协议与查询串
  return /^\/[A-Za-z0-9\-._~%/]*$/.test(s) ? s : ''
}

// ---------------------------------------------------------------- 昵称联系方式检测(常开)
// 昵称里出现联系方式是典型引流行为, 提交时直接拒绝(400), 不进队列不耗 AI 调用。
// 关键词类同时在"去分隔符紧凑串"上匹配, 防止"微 信"这类拆写绕过。
const NICK_CONTACT_PATTERNS = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+/i, // 邮箱
  /https?:\/\/|www\./i, // 网址
  /[\w-]+\.(com|cn|net|org|top|xyz|vip|icu|site|online)\b/i, // 常见域名
  /1[3-9]\d{9}/, // 大陆手机号
  /(^|[^a-z0-9])(vx|wx|v信|wechat|qq)([^a-z0-9]|$)/i, // 联系方式缩写(词边界)
  /(vx|wx|v信|wechat|qq)[\s:：\-·]?\d{3,}/i, // 缩写+号码
]
const NICK_CONTACT_KEYWORDS = /微信|薇信|威信|扣扣|企鹅|加微|加v/i

export function nickHasContact(nick) {
  const s = String(nick ?? '')
  if (!s) return false
  if (NICK_CONTACT_PATTERNS.some((re) => re.test(s))) return true
  const compact = s.replace(/[\s._\-·•、,，]+/g, '')
  return NICK_CONTACT_KEYWORDS.test(compact) || /(vx|wx|v信|wechat|qq)\d{3,}/i.test(compact)
}

// 行 → 对外对象。parentOnlyApproved: 公开列表只解析 approved 父评论;
// 管理列表放开到任意状态(待审上下文里能看到回复对象更有用)
function rowToComment(row, parentNick, { forAdmin = false } = {}) {
  const out = {
    id: row.id,
    nick: row.nick,
    content: row.content,
    page: row.page,
    ip: forAdmin ? row.ip : undefined,
    time: row.time,
    status: row.status,
    reply: row.reply_content != null ? { content: row.reply_content, time: row.reply_time ?? row.time } : null,
    likes: row.likes ?? 0,
    replyTo: row.reply_to_id && parentNick != null ? { id: row.reply_to_id, nick: parentNick } : null,
  }
  if (forAdmin && row.ai_json) {
    try { out.ai = JSON.parse(row.ai_json) } catch { out.ai = null }
  }
  return out
}

// ---------------------------------------------------------------- 公开操作
// initialStatus: 'approved' = AI 初审通过直接公开; aiReview: 初审记录(存 ai_json, 管理端展示)
export function addComment({ nick, content, page, ip, replyTo, initialStatus, aiReview }) {
  if (!ready()) return { error: '评论存储不可用（需 Node 22.5+ 的 node:sqlite）。', status: 503 }
  const n = clean(nick, NICK_MAX)
  const c = clean(content, CONTENT_MAX)
  const p = cleanPage(page)
  if (!n) return { error: '请填写昵称。' }
  if (nickHasContact(n)) return { error: '昵称不能包含联系方式（微信 / QQ / 手机号 / 邮箱 / 网址）。' }
  if (!c) return { error: '请填写留言内容。' }
  if (!p) return { error: '页面地址不正确。' }
  let parentId = null
  if (replyTo != null && String(replyTo).trim()) {
    parentId = String(replyTo).trim().slice(0, 40)
    const parent = db.prepare('SELECT id FROM comments WHERE id = ?').get(parentId)
    if (!parent) return { error: '被回复的评论不存在。' }
  }
  const now = Date.now()
  const status = initialStatus === 'approved' ? 'approved' : initialStatus === 'rejected' ? 'rejected' : 'pending'
  const aiJson = aiReview ? JSON.stringify({ ...aiReview, time: aiReview.time ?? now }) : null
  db.prepare(`
INSERT INTO comments (id, nick, content, page, ip, time, status, reply_content, reply_time, reply_to_id, likes, ai_json)
VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?)`)
    .run('c' + now.toString(36) + crypto.randomBytes(3).toString('hex'), n, c, p, ip || '', now, status, parentId, aiJson)
  prune()
  return {
    ok: true,
    status,
    message:
      status === 'approved'
        ? '留言已通过智能初审，现已公开展示。'
        : status === 'rejected'
          ? '留言审核被驳回。' // 不向提交者透露具体原因
          : '留言已提交，审核通过后会公开显示。',
  }
}

// 审核通过的评论按时间倒序, cursor=上一页最后一条的 time(继续取更早的)
export function listPublic(page, cursor) {
  if (!ready()) throw new Error('评论存储不可用')
  const p = cleanPage(page) || '/messages'
  const cutoff = Number(cursor) || Number.MAX_SAFE_INTEGER
  const total = db.prepare("SELECT COUNT(*) AS n FROM comments WHERE page = ? AND status = 'approved'").get(p).n
  // 父评论须仍为 approved 才解析 replyTo(父被驳回/删除后引用行自动消失)
  const rows = db.prepare(`
SELECT c.*, parent.nick AS parent_nick
FROM comments c
LEFT JOIN comments parent ON c.reply_to_id = parent.id AND parent.status = 'approved' AND parent.page = c.page
WHERE c.page = ? AND c.status = 'approved' AND c.time < ?
ORDER BY c.time DESC
LIMIT ?`).all(p, cutoff, PAGE_SIZE + 1)
  const list = rows.slice(0, PAGE_SIZE)
  return {
    comments: list.map(r => {
      const pub = rowToComment(r, r.parent_nick)
      delete pub.ip
      delete pub.page
      delete pub.status
      return pub
    }),
    nextCursor: rows.length > PAGE_SIZE ? String(list[PAGE_SIZE - 1].time) : null,
    total,
    capabilities: { likes: true, replies: true },
  }
}

// 点赞: (评论id, ip) 幂等 —— 同一 IP 重复点赞不重复计数, 返回当前总数
export function like(id, ip) {
  if (!ready()) return { error: '评论存储不可用。', status: 503 }
  const cid = String(id ?? '').trim().slice(0, 40)
  const target = db.prepare("SELECT id FROM comments WHERE id = ? AND status = 'approved'").get(cid)
  if (!target) return { error: '评论不存在。', status: 404 }
  const added = db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, ip, time) VALUES (?, ?, ?)')
    .run(cid, ip || '', Date.now())
  if (added.changes > 0) {
    db.prepare('UPDATE comments SET likes = likes + 1 WHERE id = ?').run(cid)
  }
  const { likes } = db.prepare('SELECT likes FROM comments WHERE id = ?').get(cid)
  return { ok: true, likes }
}

// ---------------------------------------------------------------- 管理操作
export function listForAdmin(status) {
  if (!ready()) throw new Error('评论存储不可用')
  const s = ['pending', 'approved', 'rejected', 'all'].includes(status) ? status : 'pending'
  const counts = { pending: 0, approved: 0, rejected: 0 }
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status').all()) {
    if (counts[row.status] != null) counts[row.status] = row.n
  }
  // 管理视图解析任意状态的父评论(审核时看得到回复对象)
  const rows = db.prepare(`
SELECT c.*, parent.nick AS parent_nick
FROM comments c
LEFT JOIN comments parent ON c.reply_to_id = parent.id
WHERE ? = 'all' OR c.status = ?
ORDER BY c.time DESC
LIMIT 200`).all(s, s)
  return { comments: rows.map(r => rowToComment(r, r.parent_nick, { forAdmin: true })), counts }
}

export function moderate(id, action, reply) {
  if (!ready()) return { error: '评论存储不可用。', status: 503 }
  const cid = String(id ?? '').slice(0, 40)
  const target = db.prepare('SELECT id FROM comments WHERE id = ?').get(cid)
  if (!target) return { error: '留言不存在或已删除。', status: 404 }
  if (action === 'approve') db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(cid)
  else if (action === 'reject') db.prepare("UPDATE comments SET status = 'rejected' WHERE id = ?").run(cid)
  else if (action === 'delete') {
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM comment_likes WHERE comment_id = ?').run(cid)
      db.prepare('DELETE FROM comments WHERE id = ?').run(cid)
      // 被删评论的子回复引用一并清掉, 避免 replyTo 悬空
      db.prepare('UPDATE comments SET reply_to_id = NULL WHERE reply_to_id = ?').run(cid)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } else if (action === 'reply') {
    const r = clean(reply, CONTENT_MAX)
    if (!r) return { error: '回复内容不能为空。', status: 400 }
    db.prepare('UPDATE comments SET reply_content = ?, reply_time = ? WHERE id = ?').run(r, Date.now(), cid)
  } else return { error: '未知操作。', status: 400 }
  prune()
  return { ok: true }
}

// 超容量时只清理最旧的已驳回; 待审/已通过必须人工处理, 不自动丢弃
function prune() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM comments').get()
  if (n <= MAX_COMMENTS) return
  db.prepare(`
DELETE FROM comment_likes WHERE comment_id IN (
  SELECT id FROM comments WHERE status = 'rejected' ORDER BY time ASC LIMIT ?)`)
    .run(n - MAX_COMMENTS)
  db.prepare("DELETE FROM comments WHERE status = 'rejected' ORDER BY time ASC LIMIT ?").run(n - MAX_COMMENTS)
}

export function commentStats() {
  if (!ready()) throw new Error('评论存储不可用')
  const counts = { pending: 0, approved: 0, rejected: 0 }
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status').all()) {
    if (counts[row.status] != null) counts[row.status] = row.n
  }
  return counts
}

// ---------------------------------------------------------------- 社区设置
// settings 键值表; 未写入的键回落默认值
const SETTING_DEFAULTS = {
  aiReviewEnabled: 1, // AI 初审: 通过即自动公开(需已配置 DEEPSEEK_API_KEY), 拒绝/失败回落人工
  blockedWords: '',   // 敏感词(换行/逗号分隔): 命中直接进人工待审, 不经过 AI
}

export function getSettings() {
  if (!ready()) throw new Error('评论存储不可用')
  const out = { ...SETTING_DEFAULTS }
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (row.key in out) out[row.key] = row.value
  }
  out.aiReviewEnabled = Number(out.aiReviewEnabled) ? 1 : 0
  out.blockedWords = String(out.blockedWords || '').slice(0, 2000)
  return out
}

export function saveSettings(patch = {}) {
  if (!ready()) throw new Error('评论存储不可用')
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  if (patch.aiReviewEnabled !== undefined) upsert.run('aiReviewEnabled', patch.aiReviewEnabled ? '1' : '0')
  if (patch.blockedWords !== undefined) upsert.run('blockedWords', String(patch.blockedWords).slice(0, 2000))
  return getSettings()
}

// 命中敏感词则返回该词, 否则 null(大小写不敏感)
export function matchBlockedWords(text, rawList) {
  const haystack = String(text || '').toLowerCase()
  for (const word of String(rawList || '').split(/[\n,，、;；]/)) {
    const w = word.trim().toLowerCase()
    if (w.length >= 1 && haystack.includes(w)) return word.trim()
  }
  return null
}

// 通用键值读写(字符串值; JSON 由调用方处理) — 供 LLM 模型管理等应用级设置复用
export function getAppSetting(key) {
  if (!ready()) throw new Error('评论存储不可用')
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key))
  return row ? row.value : null
}

export function setAppSetting(key, value) {
  if (!ready()) throw new Error('评论存储不可用')
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(String(key), String(value))
}

// ---------------------------------------------------------------- 管理鉴权
const adminPassword = () => process.env.COMMENT_ADMIN_PASSWORD || ''

export function adminEnabled() {
  return Boolean(adminPassword())
}

function hmac(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest()
}

// 密钥由密码派生: 改密码即自动吊销所有已签发 token, 无需服务端状态
function tokenKey() {
  return crypto.createHash('sha256').update('hs2z-comments:' + adminPassword()).digest()
}

export function issueToken() {
  const payload = String(Date.now() + TOKEN_TTL)
  return `${payload}.${hmac(payload, tokenKey()).toString('hex')}`
}

export function verifyToken(token) {
  if (!adminEnabled()) return false
  const m = /^(\d{13})\.([0-9a-f]{64})$/.exec(String(token ?? ''))
  if (!m) return false
  if (Number(m[1]) < Date.now()) return false
  const got = Buffer.from(m[2], 'hex')
  const expect = hmac(m[1], tokenKey())
  return got.length === expect.length && crypto.timingSafeEqual(got, expect)
}

export function checkPassword(input) {
  const pw = adminPassword()
  if (!pw) return false
  const a = Buffer.from(String(input ?? ''))
  const b = Buffer.from(pw)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
