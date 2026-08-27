import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import IntroMedia from './IntroMedia.vue'
import './custom.css'

export default {
  Layout,
  enhanceApp({ app }) {
    app.component('IntroMedia', IntroMedia)
  },
} satisfies Theme
