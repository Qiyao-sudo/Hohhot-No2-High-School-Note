import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

// 本地开发便利: 读取仓库根目录 .env(KEY=VALUE), 不覆盖已有环境变量;
// 服务器/CI 部署时使用平台注入的环境变量, 通常没有 .env。
try {
  const raw = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const val = m[2].replace(/^['"]|['"]$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = val
  }
} catch { /* 无 .env 文件时跳过 */ }

// 站点根路径: 服务器部署在根路径(见 docs/linux-deploy.md), 本地开发相同;
// 特殊部署位置通过 BASE 环境变量覆盖
const BASE = process.env.BASE || '/'

// Waline 服务端地址(Vercel 部署后填入), 也可通过环境变量注入
const WALINE_SERVERURL =
  process.env.WALINE_SERVERURL || 'https://your-waline.vercel.app'

// 文档助手后端地址: 默认同源 /api/assistant —— Vercel 同项目部署(前端+api/函数)
// 即插即用; 独立部署后端时通过 ASSISTANT_API 指向其地址(见 docs/assistant-setup.md)
const ASSISTANT_API = process.env.ASSISTANT_API || '/api/assistant'

// 站点线上地址: og:url / og:image 必须是绝对 URL(微信/QQ 等分享卡片要求)
const SITE_URL = (process.env.SITE_URL || 'https://hs2z.inknook.ink').replace(/\/+$/, '')

const SITE_TITLE = '呼市二中学习生活指导'
const SITE_DESC = '来自呼市二中呼伦校区 2022 级学长及所有参与文章建设的二中人'

export default defineConfig({
  lang: 'zh-CN',
  title: SITE_TITLE,
  description: SITE_DESC,
  base: BASE,
  head: [
    // favicon 需手动拼 base(head 里的 href 不会被 VitePress 自动加前缀)
    ['link', { rel: 'icon', href: BASE + 'badge.svg' }],
    // Open Graph / 微信·QQ 分享卡片(站点级; 每页的 title/description/url 由 transformHead 注入)
    // og:image 用纯校徽 478x478(微信各场景裁剪不易截掉内容, ≤2MB)
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    ['meta', { property: 'og:image', content: SITE_URL + '/og-badge.png' }],
    ['meta', { property: 'og:image:width', content: '478' }],
    ['meta', { property: 'og:image:height', content: '478' }],
    ['meta', { property: 'og:image:alt', content: '呼市二中校徽' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
  ],
  // 每页注入 og:title / og:description / og:url, 让分享出去的卡片按页面显示
  transformHead({ pageData }) {
    const pageTitle = (pageData.title || '').trim()
    const ogTitle =
      !pageTitle || pageTitle === SITE_TITLE
        ? `${SITE_TITLE} —— 二中新生到校全攻略`
        : `${pageTitle} | ${SITE_TITLE}`
    const ogDesc =
      pageData.description ||
      (pageTitle && pageTitle !== SITE_TITLE
        ? `呼市二中《学习生活指导》· ${pageTitle}：历届学长整理的实用经验`
        : SITE_DESC)
    // index.md → 站点根, 其余用优雅链接(freshman.md → /freshman)
    const rel = (pageData.relativePath || 'index.md')
      .replace(/\.md$/, '')
      .replace(/(^|\/)index$/, '$1')
    return [
      ['meta', { property: 'og:title', content: ogTitle }],
      ['meta', { property: 'og:description', content: ogDesc }],
      ['meta', { property: 'og:url', content: `${SITE_URL}/${rel}` }],
    ]
  },
  themeConfig: {
    // 校徽: 导航栏与侧栏标题前的站点 logo(圆角徽章底, 见 docs/public/badge.svg)
    logo: '/badge.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '新生须知', link: '/freshman' },
      { text: '校园生活', link: '/daily' },
      { text: '学习板块', link: '/study' },
      { text: '文档助手', link: '/assistant/' },
      { text: '留言处', link: '/messages' },
    ],
    // 侧栏按"学生找信息"的场景分组(而非照搬源文档目录):
    // 新生先看入学准备 → 校园生活 → 规矩政策 → 学习方法 → 校区差异 → 交流。
    // collapsed:false = 默认展开但可点击收起, 所在分组自动高亮。
    sidebar: [
      {
        text: '新生必读',
        collapsed: false,
        items: [{ text: '入学准备全览', link: '/freshman' }],
      },
      {
        text: '校园生活',
        collapsed: false,
        items: [
          { text: '日常生活', link: '/daily' },
          { text: '学生会·国旗班·播音站', link: '/student-org' },
          { text: '社团相关', link: '/clubs' },
        ],
      },
      {
        text: '政策与管理',
        collapsed: false,
        items: [
          { text: '学习政策与环境', link: '/study-policy' },
          { text: '日常管理(手机/头发等)', link: '/management' },
          { text: '二中传统', link: '/tradition' },
        ],
      },
      {
        text: '学习方法',
        collapsed: false,
        items: [{ text: '学习板块', link: '/study' }],
      },
      {
        text: '金川校区',
        collapsed: false,
        items: [{ text: '金川校区情况', link: '/jinchuan' }],
      },
      {
        text: '交流',
        collapsed: false,
        items: [
          { text: '留言处', link: '/messages' },
          { text: '后记', link: '/afterword' },
          { text: '支持我们', link: '/support' },
        ],
      },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    returnToTop: '回到顶部',
    search: {
      provider: 'local',
      options: {
        // miniSearch 默认分词按空白/标点切分, 中文整句会变成一个巨型词元,
        // 导致"校服"搜不到"关于校服/秋季校服"。这里换成中文二元(bigram)
        // 分词: 单字 + 相邻两字组合, 中文子串即可命中(标题与正文都会索引)。
        miniSearch: {
          options: {
            tokenize(text: string): string[] {
              const tokens: string[] = []
              for (const m of text.matchAll(/[a-zA-Z0-9]+/g)) {
                tokens.push(m[0].toLowerCase())
              }
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
            },
          },
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
            boost: { title: 4, titles: 3, text: 1 },
          },
        },
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '未找到相关内容',
            resetButtonTitle: '清除关键词',
            footer: { selectText: '打开', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: {
      text: '最近更新',
      formatOptions: { dateStyle: 'short', timeStyle: 'short' },
    },
    socialLinks: [
      { icon: 'github', link: 'https://docs.qq.com/doc/DYm5PeUxOVmdEZmxs' },
    ],
  },
  markdown: { lineNumbers: false },
  // 供 WalineComment / AssistantChat 组件读取
  vite: {
    define: {
      __WALINE_SERVERURL__: JSON.stringify(WALINE_SERVERURL),
      __ASSISTANT_API__: JSON.stringify(ASSISTANT_API),
    },
  },
})
