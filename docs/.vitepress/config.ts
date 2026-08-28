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
    sidebar: [
      {
        text: '新生',
        items: [
          { text: '新生须知', link: '/freshman' },
          { text: '日常生活', link: '/daily' },
        ],
      },
      {
        text: '校园组织',
        items: [
          { text: '学生会 国旗班 播音站', link: '/student-org' },
          { text: '社团相关', link: '/clubs' },
        ],
      },
      {
        text: '政策与管理',
        items: [
          { text: '日常学习政策及环境', link: '/study-policy' },
          { text: '日常管理', link: '/management' },
          { text: '金川校区情况', link: '/jinchuan' },
          { text: '二中传统', link: '/tradition' },
        ],
      },
      {
        text: '学习与互动',
        items: [
          { text: '学习板块', link: '/study' },
          { text: '留言处', link: '/messages' },
          { text: '后记', link: '/afterword' },
        ],
      },
      // 评论功能暂时下线; 恢复时加回:
      // { text: '站点', items: [{ text: '评论后端部署', link: '/waline-setup' }] },
    ],
    outline: { level: [2, 3] },
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
