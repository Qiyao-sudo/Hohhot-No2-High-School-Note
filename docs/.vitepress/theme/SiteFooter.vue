<script setup lang="ts">
// 全站页脚统计条: 建站日期 + 实时运行时长 + 访问计数(自建后端, PV 口径)。
// 每次页面访问 +1(同 IP 也累计, 同一访客每分钟最多计一次防刷新),
// 数据来自同源后端 GET /api/assistant/visit(server/lib/visits.mjs 计数);
// 后端未部署/不可达时访问统计整行隐藏, 不影响其余内容。
// 运行时长含秒且持续跳动, 只在客户端挂载后渲染, 避免 SSR 水合不一致。
import { onMounted, onUnmounted, ref } from 'vue'

const apiBase =
  (typeof __ASSISTANT_API__ !== 'undefined' && __ASSISTANT_API__) || '/api/assistant'

// 建站时间: 2026年9月12日 10时(北京时间)
const LAUNCH = new Date('2026-09-12T10:00:00+08:00').getTime()

const mounted = ref(false)
const days = ref(0)
const uptime = ref('')
const visitors = ref(0)
const todayVisitors = ref(0)
const statsOff = ref(true)

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

onMounted(async () => {
  mounted.value = true
  refresh()
  timer = setInterval(refresh, 1000)
  try {
    const res = await fetch(`${apiBase}/visit`)
    const d = await res.json()
    if (d.ok && d.pv > 0) {
      visitors.value = d.pv
      todayVisitors.value = d.today
      statsOff.value = false
    }
  } catch { /* 后端不可达: 保持隐藏 */ }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <footer class="site-stats">
    <p class="site-stats-line">
      <span>建站于 2026 年 9 月 12 日</span>
      <template v-if="mounted">
        <span class="dot" aria-hidden="true">·</span>
        <span>已稳定运行 {{ uptime }}</span>
      </template>
    </p>
    <p class="site-stats-line muted" :class="{ off: statsOff }">
      <span title="每次页面访问计一次, 同一访客每分钟最多计一次">
        累计 {{ visitors.toLocaleString() }} 次访问
      </span>
      <span class="dot" aria-hidden="true">·</span>
      <span>今日 {{ todayVisitors.toLocaleString() }}次</span>
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
