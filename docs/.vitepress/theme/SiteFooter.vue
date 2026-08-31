<script setup lang="ts">
// 全站页脚统计条: 建站日期 + 实时运行时长 + 访问统计(不蒜子)。
// 挂载在 layout-bottom 插槽, 位于所有页面内容之下。
// 不蒜子为第三方免费计数服务, 加载失败时访问统计整行隐藏。
// 运行时长含秒且持续跳动, 只在客户端挂载后渲染, 避免 SSR 水合不一致。
import { onMounted, onUnmounted, ref } from 'vue'

// 建站时间: 2026年9月1日 0时(北京时间)
const LAUNCH = new Date('2026-09-01T00:00:00+08:00').getTime()

const mounted = ref(false)
const days = ref(0)
const uptime = ref('')
const statsOff = ref(false)

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function refresh() {
  const diff = Math.max(0, Date.now() - LAUNCH)
  days.value = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000) % 24
  const m = Math.floor(diff / 60000) % 60
  const s = Math.floor(diff / 1000) % 60
  uptime.value = `${days.value} 天 ${pad(h)} 时 ${pad(m)} 分 ${pad(s)} 秒`
}

let timer: ReturnType<typeof setInterval> | null = null
let probe: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  mounted.value = true
  refresh()
  timer = setInterval(refresh, 1000)
  // 不蒜子为异步注入: 4 秒后计数仍未回填则整行隐藏
  probe = setTimeout(() => {
    const v = document.getElementById('busuanzi_value_site_pv')
    statsOff.value = !v || !/\d/.test(v.textContent || '')
  }, 4000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (probe) clearTimeout(probe)
})
</script>

<template>
  <footer class="site-stats">
    <p class="site-stats-line">
      <span>建站于 2026 年 9 月 1 日</span>
      <template v-if="mounted">
        <span class="dot" aria-hidden="true">·</span>
        <span>已稳定运行 {{ uptime }}</span>
      </template>
    </p>
    <p class="site-stats-line muted" :class="{ off: statsOff }">
      <span id="busuanzi_container_site_pv" title="总浏览量">
        本站共被浏览 <span id="busuanzi_value_site_pv"></span> 次
      </span>
      <span class="dot" aria-hidden="true">·</span>
      <span id="busuanzi_container_site_uv" title="访客数">
        <span id="busuanzi_value_site_uv"></span> 位访客观临
      </span>
    </p>
  </footer>
</template>

<style scoped>
.site-stats {
  margin: 3rem auto 0;
  padding: 1.25rem 1rem 1.75rem;
  border-top: 1px solid var(--vp-c-divider);
  text-align: center;
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
  letter-spacing: 0.02em;
}

.site-stats-line {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  line-height: 1.9;
  font-variant-numeric: tabular-nums;
}

.site-stats-line.muted {
  color: var(--vp-c-text-3);
}

.site-stats-line.off {
  display: none;
}

.site-stats .dot {
  color: var(--vp-c-divider);
}
</style>
