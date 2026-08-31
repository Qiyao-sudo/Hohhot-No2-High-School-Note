<script setup lang="ts">
// 侧栏分组标题图标: VitePress 侧栏配置不接受图标, 这里在渲染后把
// Phosphor 图标(svg 克隆)注入到对应文字的分组标题前。
// 挂载在 layout-bottom 插槽(始终渲染), 路由变化 + MutationObserver 兜底
// 侧栏折叠/展开/首次挂载引起的重渲染。
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'
import {
  PhGraduationCap,
  PhBackpack,
  PhShieldCheck,
  PhBookOpenText,
  PhMapPin,
  PhChatsCircle,
} from '@phosphor-icons/vue'

const route = useRoute()

// 分组名(config.ts sidebar text) → 图标组件
const ICONS: Record<string, unknown> = {
  新生必读: PhGraduationCap,
  校园生活: PhBackpack,
  政策与管理: PhShieldCheck,
  学习方法: PhBookOpenText,
  金川校区: PhMapPin,
  交流: PhChatsCircle,
}

// 隐藏容器: Vue 渲染这些图标, 注入时克隆其 svg 节点
const bank = ref<HTMLElement | null>(null)

function apply() {
  const src = bank.value
  if (!src) return
  const items = document.querySelectorAll<HTMLElement>(
    '.VPSidebar .VPSidebarItem.level-0 > .item .text'
  )
  for (const el of items) {
    if (el.querySelector('svg')) continue // 已注入
    const key = (el.textContent || '').trim()
    const icon = ICONS[key]
    if (!icon) continue
    const svg = src.querySelector(`[data-icon="${key}"] svg`)
    if (!svg) continue
    el.prepend(svg.cloneNode(true))
    el.classList.add('has-icon')
  }
}

let mo: MutationObserver | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(apply, 50)
}

onMounted(() => {
  nextTick(apply)
  mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true })
})

onUnmounted(() => {
  mo?.disconnect()
  if (timer) clearTimeout(timer)
})

watch(
  () => route.path,
  () => nextTick(apply)
)
</script>

<template>
  <div ref="bank" class="sidebar-icon-bank" aria-hidden="true">
    <span v-for="(icon, key) in ICONS" :key="key" :data-icon="key">
      <component :is="icon" :size="15" weight="duotone" />
    </span>
  </div>
</template>

<style scoped>
.sidebar-icon-bank {
  display: none;
}
</style>
