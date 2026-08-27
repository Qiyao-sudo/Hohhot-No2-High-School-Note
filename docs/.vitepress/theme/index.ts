import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'

export default {
  Layout,
  enhanceApp({ app }) {
    // 预留: 全局组件注册
  },
} satisfies Theme
