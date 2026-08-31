<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, withBase } from 'vitepress'
import { PhSparkle, PhX, PhArrowsOutSimple } from '@phosphor-icons/vue'
import AssistantChat from './AssistantChat.vue'

// 浮动文档助手: 全站右下角入口, 打开为滑出面板。
// /assistant/ 独立页面隐藏入口, 避免重复。
const route = useRoute()
const open = ref(false)

function onAssistantPage() {
  return route.path.replace(/\.html$/, '').replace(/\/+$/, '').endsWith('/assistant')
}
watch(
  () => route.path,
  () => {
    if (onAssistantPage()) open.value = false
  },
  { immediate: true }
)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
</script>

<template>
  <div v-if="!onAssistantPage()" class="ai-widget">
    <Transition name="panel">
      <div v-if="open" class="ai-panel" role="dialog" aria-label="文档助手">
        <div class="ai-panel-head">
          <component :is="PhSparkle" :size="18" weight="duotone" aria-hidden="true" />
          <span>文档助手</span>
          <a
            class="panel-link"
            :href="withBase('/assistant/')"
            title="在独立页面打开(完整会话历史)"
            aria-label="在独立页面打开"
          >
            <component :is="PhArrowsOutSimple" :size="16" aria-hidden="true" />
          </a>
          <button class="panel-close" title="收起" aria-label="收起" @click="open = false">
            <component :is="PhX" :size="16" weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div class="ai-panel-body">
          <AssistantChat compact />
        </div>
      </div>
    </Transition>

    <button
      class="ai-launcher"
      :title="open ? '收起文档助手' : '问文档助手'"
      :aria-label="open ? '收起文档助手' : '问文档助手'"
      @click="open = !open"
      @keydown="onKey"
    >
      <component :is="open ? PhX : PhSparkle" :size="22" :weight="open ? 'bold' : 'duotone'" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.ai-widget {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.75rem;
}

.ai-launcher {
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: var(--hs2-blue);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(47, 90, 216, 0.35);
  transition: transform 0.15s, background 0.15s;
}
.ai-launcher:hover {
  background: var(--hs2-blue-deep);
  transform: translateY(-2px);
}

.ai-panel {
  width: min(400px, calc(100vw - 2rem));
  height: min(620px, calc(100dvh - 8rem));
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ai-panel-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--hs2-blue);
  font-size: 0.92rem;
  font-weight: 600;
}
.ai-panel-head span { flex: 1; color: var(--vp-c-text-1); }
.panel-link,
.panel-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s;
}
.panel-link:hover,
.panel-close:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}
.ai-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 入场/退场: 轻微上浮淡入, 与站点克制动效一致 */
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 768px) {
  .ai-widget { right: 0.9rem; bottom: 0.9rem; }
  .ai-panel { height: min(560px, calc(100dvh - 6.5rem)); }
}
</style>
