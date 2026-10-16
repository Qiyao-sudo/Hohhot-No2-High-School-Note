// ============================================================
// 评论系统端到端测试(自包含: 临时目录 + 独立端口起后端实例,
// 不需要预先启动任何服务, 不碰真实数据):
//   node scripts/e2e-comments.mjs
// 覆盖: 旧 JSON 自动迁移 SQLite → 提交→待审不可见→登录→通过→公开可见→
//       站长回复/驳回/恢复→删除→提交限流→点赞幂等(多 IP)→
//       replyTo 审核流(父被驳回时引用隐藏)→持久化重启。
// ============================================================
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8791
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-admin-pass-42'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hs2z-comments-'))
const dbFile = path.join(tmp, 'comments.db')
const legacyFile = path.join(tmp, 'comments.json')

// 预置旧版 JSON: 1 条已通过(带站长回复), 验证启动时自动迁移到 SQLite
fs.writeFileSync(legacyFile, JSON.stringify({
  seq: 1,
  comments: [{
    id: 'clegacy0001', nick: '旧数据用户', content: 'JSON 时代的留言',
    page: '/messages', ip: '9.9.9.9', time: Date.now() - 86400_000,
    status: 'approved', reply: { content: '旧站长回复', time: Date.now() - 86000_000 },
  }],
}))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      COMMENT_ADMIN_PASSWORD: PASSWORD,
      COMMENTS_DB: dbFile,
      COMMENTS_FILE: legacyFile, // 仅供迁移逻辑读取
      COMMENT_RATE_SUBMIT_MIN: '3', // 低阈值便于触发限流断言
      COMMENT_RATE_SUBMIT: '999',
      COMMENT_RATE_LIST_MIN: '999',
      COMMENT_RATE_LIST: '999',
      // AI 初审指向本地 mock(OpenAI 兼容), 全程不调真实模型
      DEEPSEEK_API_KEY: 'e2e-mock-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      DEEPSEEK_MODEL: 'mock-flash',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  return child
}

// mock LLM: 内容含 SPAM 或昵称像联系方式(薇/微/vx/wx/qq 等) → reject, 否则 approve(OpenAI 非流式)
const MOCK_PORT = 8792
const mockLlm = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) { res.writeHead(404); res.end(); return }
  let buf = ''
  req.on('data', (c) => { buf += c })
  req.on('end', () => {
    let nick = ''
    let content = ''
    try {
      const payload = JSON.parse(buf)
      const user = (payload.messages || []).find((m) => m.role === 'user')?.content || ''
      nick = /昵称：(.*)/.exec(user)?.[1] || ''
      content = /留言内容：([\s\S]*)/.exec(user)?.[1] || ''
    } catch { /* 解析失败按内容原文判断 */ content = buf }
    const spam = content.includes('SPAM')
    const contactNick = /薇|微|vx|wx|v信|qq|wechat|@|www\.|1[3-9]\d{9}/i.test(nick)
    const reject = spam || contactNick
    const reason = spam ? '垃圾广告' : contactNick ? '昵称含联系方式' : '正常留言'
    const out = `{"verdict":"${reject ? 'reject' : 'approve'}","reason":"${reason}"}`
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: out } }] }))
  })
})

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch { /* 尚未监听 */ }
    await sleep(250)
  }
  throw new Error('后端实例启动超时')
}

async function req(method, p, body, token, extraHeaders = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text()
  return { status: res.status, data, headers: res.headers }
}

let server = startServer()
await new Promise((r) => mockLlm.listen(MOCK_PORT, '127.0.0.1', r))
try {
  await waitReady()
  console.log('0. 旧数据迁移(comments.json → SQLite)')
  let token = ''
  {
    check('库文件已创建', fs.existsSync(dbFile))
    const renamed = fs.readdirSync(tmp).some((f) => f.startsWith('comments.json.migrated-'))
    check('旧 JSON 已改名留档', renamed && !fs.existsSync(legacyFile), fs.readdirSync(tmp).join(', '))
    const login = await req('POST', '/admin/login', { password: PASSWORD })
    token = login.data?.token
    const off = await req('POST', '/admin/settings', { aiReviewEnabled: false }, token)
    check('关闭 AI 初审(后续传统用例回归纯人工流)', off.status === 200 && off.data.settings.aiReviewEnabled === 0)
    const all = await req('GET', '/admin/comments?status=all', undefined, token)
    const legacy = all.data.comments.find((c) => c.id === 'clegacy0001')
    check('旧数据已入库', Boolean(legacy), `共 ${all.data.comments.length} 条`)
    check('旧站长回复随迁', legacy?.reply?.content === '旧站长回复')
    const pub = await req('GET', '/comments?page=/messages')
    check('旧数据公开可见', pub.data.comments.length === 1 && pub.data.comments[0].nick === '旧数据用户')
  }

  console.log('1. 基础端点')
  {
    const r = await req('GET', '/health')
    check('健康检查', r.status === 200 && r.data.ok, `v${r.data?.version}`)
    const a = await req('GET', '/admin')
    check('旧审核页已下线(404 JSON)', a.status === 404 && a.data?.error, a.data?.error || '')
  }

  console.log('2. 提交与限流')
  {
    const bad = await req('POST', '/comment', { nick: '  ', content: 'x', page: '/messages' })
    check('空昵称被拒(400)', bad.status === 400, bad.data?.error || '')

    const a = await req('POST', '/comment', { nick: 'E2E张三', content: '第一条测试留言', page: '/messages' })
    check('提交 A 成功', a.status === 200 && /审核/.test(a.data?.message || ''), a.data?.message)

    const b = await req('POST', '/comment', { nick: 'E2E李四', content: '第二条测试留言\n带换行', page: '/messages' })
    check('提交 B 成功', b.status === 200)

    const c = await req('POST', '/comment', { nick: 'E2E王五', content: '第三条(应触发限流)', page: '/messages' })
    check('分钟限流触发(429)', c.status === 429, c.data?.error || '(无错误信息)')
  }

  console.log('3. 待审不可见 + 登录鉴权')
  {
    const pub = await req('GET', '/comments?page=/messages')
    check('公开列表仅旧数据(待审不可见)', pub.status === 200 && pub.data.comments.length === 1)
    check('能力声明已返回', pub.data.capabilities?.likes === true && pub.data.capabilities?.replies === true,
      JSON.stringify(pub.data.capabilities))
    check('公开条目带 likes/replyTo 字段', typeof pub.data.comments[0].likes === 'number' && 'replyTo' in pub.data.comments[0])

    const noToken = await req('GET', '/admin/comments?status=pending')
    check('无 token 访问管理接口被拒(401)', noToken.status === 401)

    const wrong = await req('POST', '/admin/login', { password: 'not-the-password' })
    check('错误密码(401)', wrong.status === 401)

    const okLogin = await req('POST', '/admin/login', { password: PASSWORD })
    check('正确密码登录拿到 token', okLogin.status === 200 && typeof okLogin.data?.token === 'string')
    token = okLogin.data?.token

    const forged = await req('GET', '/admin/comments?status=pending', undefined, token.slice(0, -2) + 'ff')
    check('伪造 token 被拒(401)', forged.status === 401)

    const pending = await req('GET', '/admin/comments?status=pending', undefined, token)
    check('待审列表 2 条', pending.status === 200 && pending.data.comments.length === 2, `counts=${JSON.stringify(pending.data?.counts)}`)
    check('管理列表含 IP 字段', pending.data.comments.every((c) => typeof c.ip === 'string'))
  }

  console.log('4. 审核流转')
  let idA = ''
  {
    const pending = await req('GET', '/admin/comments?status=pending', undefined, token)
    const list = pending.data.comments
    idA = list.find((c) => c.nick === 'E2E张三').id
    const idB = list.find((c) => c.nick === 'E2E李四').id

    const appr = await req('POST', '/admin/comment', { id: idA, action: 'approve' }, token)
    check('通过 A', appr.status === 200 && appr.data.ok)

    const pub = await req('GET', '/comments?page=/messages')
    check('A 公开可见', pub.data.comments.length === 2 && pub.data.comments.some((c) => c.nick === 'E2E张三'))
    check('公开字段不含 ip', !('ip' in pub.data.comments[0]), Object.keys(pub.data.comments[0]).join(','))

    const reply = await req('POST', '/admin/comment', { id: idA, action: 'reply', reply: 'E2E 站长回复' }, token)
    check('站长回复 A', reply.status === 200)
    const pub2 = await req('GET', '/comments?page=/messages')
    check('回复随评论公开', pub2.data.comments.find((c) => c.id === idA)?.reply?.content === 'E2E 站长回复')

    await req('POST', '/admin/comment', { id: idB, action: 'reject' }, token)
    await req('POST', '/admin/comment', { id: idB, action: 'approve' }, token)
    const pub4 = await req('GET', '/comments?page=/messages')
    check('驳回→恢复通过后可见', pub4.data.comments.length === 3)

    const del = await req('POST', '/admin/comment', { id: idB, action: 'delete' }, token)
    check('删除 B', del.status === 200)
    const all = await req('GET', '/admin/comments?status=all', undefined, token)
    check('全部列表剩 2 条(旧数据+A)', all.data.comments.length === 2)

    const gone = await req('POST', '/admin/comment', { id: idB, action: 'approve' }, token)
    check('操作已删评论返回 404', gone.status === 404)
  }

  console.log('5. 点赞(按 IP 幂等)')
  {
    const like1 = await req('POST', '/comment/like', { id: idA }, undefined, { 'X-Forwarded-For': '1.1.1.1' })
    check('IP① 点赞 → 1', like1.status === 200 && like1.data.likes === 1, JSON.stringify(like1.data))
    const like2 = await req('POST', '/comment/like', { id: idA }, undefined, { 'X-Forwarded-For': '1.1.1.1' })
    check('IP① 重复点赞不重复计数', like2.status === 200 && like2.data.likes === 1)
    const like3 = await req('POST', '/comment/like', { id: idA }, undefined, { 'X-Forwarded-For': '2.2.2.2' })
    check('IP② 点赞 → 2', like3.status === 200 && like3.data.likes === 2)
    const badLike = await req('POST', '/comment/like', { id: 'no-such-id' })
    check('点赞不存在的评论 404', badLike.status === 404)
    const pub = await req('GET', '/comments?page=/messages')
    check('公开列表计数同步', pub.data.comments.find((c) => c.id === idA)?.likes === 2)
  }

  console.log('6. 持久化重启 + replyTo 回复流')
  {
    server.kill()
    await sleep(600)
    server = startServer()
    await waitReady()

    const pub = await req('GET', '/comments?page=/messages')
    const a = pub.data.comments.find((c) => c.id === idA)
    check('重启后 A 仍在', Boolean(a))
    check('重启后站长回复仍在', a?.reply?.content === 'E2E 站长回复')
    check('重启后点赞数仍在', a?.likes === 2)
    check('重启后不再重复迁移(旧 JSON 不存在)', !fs.existsSync(legacyFile))

    // 重启后限流计数清零: 回复 A + 提交一条含 HTML 的评论(均在 3/min 内)
    const rp = await req('POST', '/comment', { nick: 'E2E回复者', content: '回复张三的留言', page: '/messages', replyTo: idA })
    check('带 replyTo 提交成功', rp.status === 200, rp.data?.error || '')
    const badRp = await req('POST', '/comment', { nick: 'E2E', content: 'x', page: '/messages', replyTo: 'no-such-id' })
    check('replyTo 指向不存在的评论被拒(400)', badRp.status === 400, badRp.data?.error || '')

    const login = await req('POST', '/admin/login', { password: PASSWORD })
    token = login.data.token
    const pending = await req('GET', '/admin/comments?status=pending', undefined, token)
    const rpItem = pending.data.comments.find((c) => c.nick === 'E2E回复者')
    check('管理列表解析回复对象', rpItem?.replyTo?.id === idA && rpItem?.replyTo?.nick === 'E2E张三',
      JSON.stringify(rpItem?.replyTo))
    await req('POST', '/admin/comment', { id: rpItem.id, action: 'approve' }, token)

    const pub2 = await req('GET', '/comments?page=/messages')
    const shown = pub2.data.comments.find((c) => c.id === rpItem.id)
    check('公开列表显示 回复@张三', shown?.replyTo?.nick === 'E2E张三')

    // 父评论被驳回后引用行自动隐藏, 恢复后回来
    await req('POST', '/admin/comment', { id: idA, action: 'reject' }, token)
    const pub3 = await req('GET', '/comments?page=/messages')
    check('父被驳回 → replyTo 隐藏', pub3.data.comments.find((c) => c.id === rpItem.id)?.replyTo === null)
    const adminAll = await req('GET', '/admin/comments?status=all', undefined, token)
    check('管理列表仍可见回复对象(任意状态)', adminAll.data.comments.find((c) => c.id === rpItem.id)?.replyTo?.nick === 'E2E张三')
    await req('POST', '/admin/comment', { id: idA, action: 'approve' }, token)
    const pub4 = await req('GET', '/comments?page=/messages')
    check('父恢复 → replyTo 回来', pub4.data.comments.find((c) => c.id === rpItem.id)?.replyTo?.nick === 'E2E张三')

    // 删除父评论: 子回复引用清空不悬空
    await req('POST', '/admin/comment', { id: idA, action: 'delete' }, token)
    const pub5 = await req('GET', '/comments?page=/messages')
    check('父被删除 → 子回复引用清空', pub5.data.comments.find((c) => c.id === rpItem.id)?.replyTo === null)
  }

  console.log('7. AI 初审(开启, 通过即自动公开)')
  {
    server.kill()
    await sleep(600)
    server = startServer()
    await waitReady()
    const login = await req('POST', '/admin/login', { password: PASSWORD })
    token = login.data.token

    const on = await req('POST', '/admin/settings', { aiReviewEnabled: true, blockedWords: '违禁样本词' }, token)
    check('开启 AI 初审 + 敏感词', on.status === 200 && on.data.settings.aiReviewEnabled === 1 && on.data.settings.blockedWords === '违禁样本词')
    const st = await req('GET', '/admin/settings', undefined, token)
    check('设置读取: 模型状态(mock)', st.status === 200 && st.data.ai.configured === true && st.data.ai.model === 'mock-flash',
      JSON.stringify(st.data?.ai))

    const good = await req('POST', '/comment', { nick: 'AI通过者', content: '一条正常的留言', page: '/messages' })
    check('AI 通过 → 提示智能初审', good.status === 200 && /智能初审/.test(good.data?.message || ''), good.data?.message)
    const pub = await req('GET', '/comments?page=/messages')
    const goodItem = pub.data.comments.find((c) => c.nick === 'AI通过者')
    check('AI 通过 → 立即公开展示', Boolean(goodItem))

    const spam = await req('POST', '/comment', { nick: 'AI拒绝者', content: 'SPAM 加我微信买粉', page: '/messages' })
    check('AI 拒绝 → 提示驳回(不露原因)', spam.status === 200 && spam.data?.status === 'rejected' && /驳回/.test(spam.data?.message || '') && !/垃圾|广告|微信/.test(spam.data?.message || ''), spam.data?.message)
    const spamPub = await req('GET', '/comments?page=/messages')
    check('AI 拒绝 → 不公开', !spamPub.data.comments.some((c) => c.nick === 'AI拒绝者'))
    const rejected = await req('GET', '/admin/comments?status=rejected', undefined, token)
    const spamItem = rejected.data.comments.find((c) => c.nick === 'AI拒绝者')
    check('驳回队列留有 AI 拒绝原因(管理端可见,可救回)', spamItem?.ai?.verdict === 'reject' && spamItem?.ai?.reason === '垃圾广告',
      JSON.stringify(spamItem?.ai))
    check('通过项亦留有 AI 记录', (await req('GET', '/admin/comments?status=approved', undefined, token)).data.comments.find((c) => c.nick === 'AI通过者')?.ai?.verdict === 'approve')

    // AI 兜底: 正则抓不到的变体昵称(薇❤520)由 AI 拒绝 → 直接驳回
    const sneaky = await req('POST', '/comment', { nick: '薇❤520', content: '内容本身很正常', page: '/messages' })
    check('AI 兜底: 变体昵称不自动公开', sneaky.status === 200 && sneaky.data?.status === 'rejected' && !/智能初审/.test(sneaky.data?.message || ''), sneaky.data?.message)
    const sneakyRejected = await req('GET', '/admin/comments?status=rejected', undefined, token)
    const sneakyItem = sneakyRejected.data.comments.find((c) => c.nick === '薇❤520')
    check('AI 兜底: 判定与理由入库', sneakyItem?.ai?.verdict === 'reject' && /昵称/.test(sneakyItem?.ai?.reason || ''), JSON.stringify(sneakyItem?.ai))
  }

  console.log('8. 敏感词 / 试审接口 / 关闭回落')
  {
    server.kill()
    await sleep(600)
    server = startServer()
    await waitReady()
    const login = await req('POST', '/admin/login', { password: PASSWORD })
    token = login.data.token
    const st = await req('GET', '/admin/settings', undefined, token)
    check('设置跨重启持久化', st.data.aiReviewEnabled === 1 && st.data.blockedWords === '违禁样本词')

    const blocked = await req('POST', '/comment', { nick: '敏感词者', content: '这句话包含 违禁样本词 应被拦截', page: '/messages' })
    check('命中敏感词 → 人工待审', blocked.status === 200 && /审核/.test(blocked.data?.message || ''))
    const pending = await req('GET', '/admin/comments?status=pending', undefined, token)
    const blockedItem = pending.data.comments.find((c) => c.nick === '敏感词者')
    check('管理列表标注命中敏感词', blockedItem?.ai?.verdict === 'blocked' && /违禁样本词/.test(blockedItem?.ai?.reason || ''),
      JSON.stringify(blockedItem?.ai))

    const t1 = await req('POST', '/admin/settings/test', { nick: '试审', content: '正常内容' }, token)
    check('试审: 正常 → 将通过', t1.status === 200 && t1.data.wouldApprove === true && t1.data.verdict === 'approve')
    const t2 = await req('POST', '/admin/settings/test', { content: 'SPAM 内容' }, token)
    check('试审: SPAM → 拒绝', t2.data.verdict === 'reject' && t2.data.wouldApprove === false)
    const t3 = await req('POST', '/admin/settings/test', { content: '带 违禁样本词' }, token)
    check('试审: 敏感词优先于 AI', t3.data.verdict === 'blocked')

    const nickCases = [
      ['微信abc', '微信号昵称'], ['13812345678', '手机号昵称'], ['a@b.com', '邮箱昵称'],
      ['www.example.com', '网址昵称'], ['vx9988', '缩写+号码'], ['微 信888', '拆写绕过'], ['QQ:12345678', 'QQ号'],
    ]
    for (const [nick, label] of nickCases) {
      const r = await req('POST', '/admin/settings/test', { nick, content: '正常内容' }, token)
      check(`昵称规则: ${label} → 拒绝提交`, r.status === 200 && r.data.verdict === 'nick-contact' && r.data.wouldApprove === false)
    }
    const okNick = await req('POST', '/admin/settings/test', { nick: '2107', content: '正常内容' }, token)
    check('昵称规则: 纯短数字(班级/年份)放行', okNick.data.verdict === 'approve' && okNick.data.wouldApprove === true)

    const aiFallback = await req('POST', '/admin/settings/test', { nick: '薇❤520', content: '正常内容' }, token)
    check('AI 兜底: 试审中变体昵称被拒', aiFallback.data.verdict === 'reject' && aiFallback.data.wouldApprove === false, JSON.stringify(aiFallback.data))

    const off = await req('POST', '/admin/settings', { aiReviewEnabled: false }, token)
    check('关闭 AI 初审', off.data.settings.aiReviewEnabled === 0)
    const t4 = await req('POST', '/admin/settings/test', { content: '任何内容' }, token)
    check('关闭后试审 → skip', t4.data.verdict === 'skip')
    const plain = await req('POST', '/comment', { nick: '关闭后', content: '关闭初审后的留言', page: '/messages' })
    check('关闭后提交 → 传统人工流', plain.status === 200 && /审核通过后会公开/.test(plain.data?.message || ''), plain.data?.message)
    const plainPub = await req('GET', '/comments?page=/messages')
    check('关闭后不自动公开', !plainPub.data.comments.some((c) => c.nick === '关闭后'))
    const plainItem = (await req('GET', '/admin/comments?status=pending', undefined, token)).data.comments.find((c) => c.nick === '关闭后')
    check('关闭后无 AI 记录', plainItem && !plainItem.ai)

    const badNick = await req('POST', '/comment', { nick: 'QQ:12345678', content: '昵称带联系方式的提交', page: '/messages' })
    check('真实提交: 联系方式昵称被拒(400)', badNick.status === 400 && /昵称不能包含联系方式/.test(badNick.data?.error || ''), badNick.data?.error)

    // 清理本节测试数据
    for (const item of [blockedItem, plainItem]) {
      if (item) await req('POST', '/admin/comment', { id: item.id, action: 'delete' }, token)
    }
    const approved = (await req('GET', '/admin/comments?status=approved', undefined, token)).data.comments
    for (const item of approved.filter((c) => ['AI通过者', 'AI拒绝者'].includes(c.nick))) {
      await req('POST', '/admin/comment', { id: item.id, action: 'delete' }, token)
    }
    const leftovers = (await req('GET', '/admin/comments?status=rejected', undefined, token)).data.comments
    for (const item of leftovers.filter((c) => ['薇❤520', 'AI拒绝者'].includes(c.nick))) {
      await req('POST', '/admin/comment', { id: item.id, action: 'delete' }, token)
    }
  }

  console.log('9. 大模型管理(文档助手 / 评论审核)')
  {
    const login = await req('POST', '/admin/login', { password: PASSWORD })
    token = login.data.token
    await req('POST', '/admin/settings', { aiReviewEnabled: true }, token)

    const empty = await req('GET', '/admin/llm', undefined, token)
    check('初始列表为空, 双用途回落环境变量', empty.status === 200 && empty.data.models.length === 0 && empty.data.effective.review.source === 'env' && empty.data.effective.assistant.source === 'env')

    const add = await req('POST', '/admin/llm/models', { name: 'Mock二号', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-two', apiKey: 'e2e-secret-key-9999' }, token)
    check('添加模型', add.status === 200 && Boolean(add.data?.id))
    const mid = add.data.id

    const after = await req('GET', '/admin/llm', undefined, token)
    const m = after.data.models[0]
    check('列表回显掩码, 不泄露 Key', m && m.hasKey === true && /9999/.test(m.keyHint || '') && !JSON.stringify(after.data).includes('e2e-secret-key-9999'), m?.keyHint)

    const upd = await req('POST', '/admin/llm/models', { id: mid, name: 'Mock二号改', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-two-b' }, token)
    check('编辑留空 Key 沿用旧 Key', upd.status === 200)
    const after2 = await req('GET', '/admin/llm', undefined, token)
    check('编辑后模型名更新且 Key 仍在', after2.data.models[0]?.model === 'mock-two-b' && after2.data.models[0]?.hasKey === true)

    const bad = await req('POST', '/admin/llm/models', { name: 'x', baseUrl: 'ftp://x', model: 'y', apiKey: 'k' }, token)
    check('非法接口地址被拒(400)', bad.status === 400)

    const sel = await req('POST', '/admin/llm/select', { review: mid }, token)
    check('选择审核模型', sel.status === 200 && sel.data.selection.review === mid)
    const eff = await req('GET', '/admin/llm', undefined, token)
    check('审核生效切到自定义模型', eff.data.effective.review.source === 'custom' && eff.data.effective.review.model === 'mock-two-b', JSON.stringify(eff.data.effective.review))
    check('助手仍走环境变量', eff.data.effective.assistant.source === 'env')

    const t = await req('POST', '/admin/settings/test', { nick: '访客', content: '正常内容' }, token)
    check('试审经新模型仍正常判定', t.data.wouldApprove === true, JSON.stringify(t.data))

    const selBad = await req('POST', '/admin/llm/select', { review: 'no-such' }, token)
    check('选择不存在的模型被拒(400)', selBad.status === 400)

    const del = await req('POST', '/admin/llm/models/delete', { id: mid }, token)
    check('删除模型', del.status === 200)
    const fin = await req('GET', '/admin/llm', undefined, token)
    check('删除后选择复位并回落环境变量', fin.data.models.length === 0 && fin.data.effective.review.source === 'env')
  }
} finally {
  server.kill()
  mockLlm.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 文件占用时可忽略 */ }
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
