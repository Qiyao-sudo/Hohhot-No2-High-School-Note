import type { Theme } from 'vitepress'
import Layout from './Layout.vue'

export default {
  Layout,
  enhanceApp({ app }) {
    // 预留: 全局组件注册
  },
} satisfies Theme
