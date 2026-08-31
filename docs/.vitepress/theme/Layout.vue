<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { onMounted, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import {
  PhSidebarSimple,
} from '@phosphor-icons/vue'
import WalineComment from './WalineComment.vue'
import ImageLightbox from './ImageLightbox.vue'
import SidebarIcons from './SidebarIcons.vue'

const { frontmatter } = useData()

// 桌面端侧栏开关: 状态存 localStorage, 通过 html 上的类名收起侧栏。
// 移动端用 VitePress 自带的抽屉侧栏, 此按钮在小屏隐藏。
const SIDEBAR_KEY = 'hs2-sidebar'
const sidebarOpen = ref(true)

function apply() {
  document.documentElement.classList.toggle('sidebar-collapsed', !sidebarOpen.value)
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  localStorage.setItem(SIDEBAR_KEY, sidebarOpen.value ? '1' : '0')
  apply()
}

onMounted(() => {
  sidebarOpen.value = localStorage.getItem(SIDEBAR_KEY) !== '0'
  apply()
})
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-content-before>
      <button
        v-if="frontmatter.sidebar !== false"
        class="sidebar-toggle"
        :title="sidebarOpen ? '收起侧栏' : '展开侧栏'"
        :aria-label="sidebarOpen ? '收起侧栏' : '展开侧栏'"
        @click="toggleSidebar"
      >
        <component :is="PhSidebarSimple" :size="19" weight="bold" aria-hidden="true" />
      </button>
      <!-- 侧栏收起时的紧凑品牌组合: 校徽 + 主名/副名双色, 点击回首页 -->
      <a
        v-if="frontmatter.sidebar !== false"
        v-show="!sidebarOpen"
        class="nav-brand-lockup"
        :href="withBase('/')"
        aria-label="呼市二中学习生活指导, 返回首页"
      >
        <img class="brand-badge" :src="withBase('/badge.svg')" alt="" aria-hidden="true" />
        <span class="brand-main">呼市二中</span>
        <span class="brand-sub">学习生活指导</span>
      </a>
    </template>
    <template #doc-after>
      <!-- 在带 comment: true 的页面(如留言处)渲染 Waline 评论 -->
      <WalineComment v-if="frontmatter.comment" />
    </template>
    <!-- 全站图片点击放大(layout-bottom 插槽保证始终渲染) -->
    <template #layout-bottom>
      <ImageLightbox />
      <SidebarIcons />
    </template>
  </DefaultTheme.Layout>
</template>
