<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  PhChatsCircle,
} from '@phosphor-icons/vue'
import { init } from '@waline/client'
import '@waline/client/waline.css'

// Waline 服务端地址: 构建时由 config.ts 的 vite.define 注入,
// 本地开发可在 docs/.vitepress/config.ts 中修改默认值
const serverURL =
  (typeof __WALINE_SERVERURL__ !== 'undefined' && __WALINE_SERVERURL__) || ''

// 后端未配置(占位/空地址)时不初始化, 显示配置提示
const configured = /^https?:\/\//.test(serverURL) &&
  !serverURL.includes('your-waline')

const el = ref<HTMLElement | null>(null)

onMounted(() => {
  if (!configured) return
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
    <h2 id="comment">
      <component :is="PhChatsCircle" :size="20" weight="duotone" aria-hidden="true" />
      评论留言
    </h2>
    <p v-if="configured" class="hint">
      无需注册登录，填写<span class="required">昵称</span>（必填）和
      <span class="optional">邮箱</span>（选填，用于接收回复通知）即可留言。
    </p>
    <p v-else class="waline-off">
      评论区后端尚未配置，站点其余功能不受影响。维护者可参考本站
      <a href="/waline-setup">评论后端部署指南</a>（腾讯云开发 CloudBase，
      约 5 分钟）完成配置。
    </p>
    <div v-if="configured" ref="el"></div>
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
.waline-off {
  padding: 1rem 1.2rem;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 0.9em;
  background: var(--vp-c-bg-soft);
}
.waline-off a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
