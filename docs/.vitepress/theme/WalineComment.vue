<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { init } from '@waline/client'
import '@waline/client/waline.css'

// Waline 服务端地址: 构建时由 config.ts 的 vite.define 注入,
// 本地开发可在 docs/.vitepress/config.ts 中修改默认值
const serverURL =
  (typeof __WALINE_SERVERURL__ !== 'undefined' && __WALINE_SERVERURL__) ||
  'https://your-waline.vercel.app'

const el = ref<HTMLElement | null>(null)

onMounted(() => {
  init({
    el: el.value!,
    serverURL,
    path: location.pathname,
    // 匿名模式: 免登录, 游客直接填写昵称/邮箱评论
    login: 'anonymous',
    // 昵称必填, 邮箱可选(默认 nick 必填; mail/comment 按需)
    requiredMeta: ['nick'],
    lang: 'zh-CN',
    dark: 'html.dark',
    pageview: true,
    comment: true,
    reply: true,
    reaction: false,
  })
})
</script>

<template>
  <div class="waline-wrapper">
    <h2 id="comment">评论留言</h2>
    <p class="hint">
      无需注册登录，填写<span class="required">昵称</span>（必填）和
      <span class="optional">邮箱</span>（选填，用于接收回复通知）即可留言。
    </p>
    <div ref="el"></div>
  </div>
</template>

<style scoped>
.waline-wrapper {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--vp-c-divider);
}
.hint {
  color: var(--vp-c-text-2);
  font-size: 0.9em;
}
.required {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.optional {
  color: var(--vp-c-text-2);
}
</style>
