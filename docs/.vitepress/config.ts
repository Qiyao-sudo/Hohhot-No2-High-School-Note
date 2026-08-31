import { defineConfig } from 'vitepress'

// GitHub Pages 仓库名, 如 <user>.github.io 仓库请改为 '/'
const BASE = process.env.BASE || '/Hohhot-No2-High-School-Note/'

// Waline 服务端地址(Vercel 部署后填入), 也可通过环境变量注入
const WALINE_SERVERURL =
  process.env.WALINE_SERVERURL || 'https://your-waline.vercel.app'

export default defineConfig({
  lang: 'zh-CN',
  title: '呼市二中学习生活指导',
  description:
    '来自呼市二中呼伦校区 2022 级学长及所有参与文章建设的二中人',
  base: BASE,
  head: [['link', { rel: 'icon', href: '/badge.svg' }]],
  themeConfig: {
    // 校徽: 导航栏与侧栏标题前的站点 logo(圆角徽章底, 见 docs/public/badge.svg)
    logo: '/badge.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '新生须知', link: '/freshman' },
      { text: '校园生活', link: '/daily' },
      { text: '学习板块', link: '/study' },
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
  // 供 WalineComment 组件读取
  vite: {
    define: {
      __WALINE_SERVERURL__: JSON.stringify(WALINE_SERVERURL),
    },
  },
})
