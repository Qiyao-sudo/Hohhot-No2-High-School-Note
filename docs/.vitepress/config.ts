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
  head: [['link', { rel: 'icon', href: '/logo.svg' }]],
  themeConfig: {
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
