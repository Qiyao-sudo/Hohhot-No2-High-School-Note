// ============================================================
// 文档助手端到端冒烟测试(本地无头 Edge, 需先启动两个服务):
//   1. npm run assistant        # 后端 :8787
//   2. npm run build && npx vitepress preview docs --port 4179
//   3. node scripts/e2e-assistant.mjs
// 依赖 puppeteer-core(devDependency) + 本机已装 Edge/Chrome。
// ============================================================
import puppeteer from 'puppeteer-core'

const EDGE =
  process.env.EDGE_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = process.env.E2E_BASE || 'http://localhost:4179/Hohhot-No2-High-School-Note'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  // 本地预览服务: 绕过系统代理, 避免 localhost 被代理拦截
  args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('response', (r) => {
  if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`)
})

try {
  // ------------------------------------------------ 1. 助手页面加载
  console.log('1. /assistant/ 页面')
  await page.goto(`${BASE}/assistant/`, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.ai-chat', { timeout: 10000 })
  const badge = await page.$eval('.head-meta', (el) => el.textContent.trim()).catch(() => '')
  check('健康检查通过(模型徽章)', /deepseek/.test(badge), badge)
  check('推荐问题渲染', (await page.$$('.suggest-item')).length >= 4)

  // ------------------------------------------------ 2. 智能问答(点击推荐问题)
  console.log('2. 智能问答流程')
  await page.click('.suggest-item:nth-child(3)') // 手机/发型管理
  await page.waitForSelector('.answer p', { timeout: 60000 })
  await page.waitForFunction(
    () => !document.querySelector('button.send-btn.stop') && document.querySelector('.msg-ops'),
    { timeout: 90000 }
  )
  const answerText = await page.$eval('.answer', (el) => el.textContent)
  check('回答非空且包含实质内容', answerText.length > 30, answerText.slice(0, 60) + '…')
  const citCount = await page.$$('.answer .cit')
  check('引用角标 [[n]] 已渲染', citCount.length > 0, `${citCount.length} 处`)
  const chips = await page.$$eval('.src-chip', (els) =>
    els.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
  )
  check('来源卡片存在', chips.length > 0, `${chips.length} 条`)
  check(
    '来源链接带站点 base 与锚点',
    chips.every((c) => /^\/Hohhot-No2-High-School-Note\/[a-z-]+#.+/.test(c.href)),
    chips[0]?.href
  )
  // 回答原文里点击角标应能解析出目标链接(delegated click → window.open)
  const citHref = await page.$eval('.answer .cit', (el) => el.dataset.cite)
  check('角标携带来源编号', /^\d+$/.test(citHref || ''), `cite=${citHref}`)

  // ------------------------------------------------ 3. 历史持久化
  console.log('3. 会话持久化')
  const stored = await page.evaluate(() => localStorage.getItem('hs2-assistant-msgs'))
  check('localStorage 已保存会话', stored && stored.includes('手机'))

  // ------------------------------------------------ 4. 快速检索模式
  console.log('4. 快速检索模式')
  await page.click('.mode-btn:nth-child(2)')
  await page.click('.ai-input-row textarea')
  await page.type('.ai-input-row textarea', '食堂')
  await page.click('button.send-btn')
  await page.waitForSelector('.result-card', { timeout: 20000 })
  const cards = await page.$$eval('.result-card', (els) =>
    els.map((a) => ({ title: a.querySelector('.rc-page').textContent, href: a.getAttribute('href') }))
  )
  check('检索结果卡片', cards.length > 0, `${cards.length} 条, 首条: ${cards[0]?.title}`)

  // ------------------------------------------------ 5. 浮动小组件(首页)
  console.log('5. 全站浮动入口')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.ai-launcher', { timeout: 10000 })
  await page.click('.ai-launcher')
  await page.waitForSelector('.ai-panel .ai-chat', { timeout: 5000 })
  check('浮动面板打开', true)
  const panelBadge = await page.$eval('.ai-panel .head-meta', (el) => el.textContent.trim()).catch(() => '')
  check('面板内健康检查通过', /deepseek/.test(panelBadge), panelBadge)

  // 助手页面自身不显示浮动入口
  await page.goto(`${BASE}/assistant/`, { waitUntil: 'networkidle2' })
  await sleep(500)
  check('助手页面隐藏浮动入口', !(await page.$('.ai-launcher')))

  // ------------------------------------------------ 6. 未配置降级(伪造不可达后端)
  console.log('6. 控制台错误')
  check('无 console/page 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
