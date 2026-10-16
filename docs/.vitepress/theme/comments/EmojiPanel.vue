<script setup lang="ts">
// 表情弹层：自带开关按钮 + 弹层，点击表情即上抛 select，由表单插到光标处
import { onMounted, onUnmounted, ref } from 'vue'
import { PhSmiley } from '@phosphor-icons/vue'

const emit = defineEmits<{ (e: 'select', emoji: string): void }>()

const EMOJIS = [
  '😀', '😄', '😂', '🤣', '😊', '😍', '🤔', '😮',
  '😭', '😅', '😉', '😎', '🥺', '😤', '🙏', '👍',
  '👏', '❤️', '🎉', '🔥', '✨', '💯', '📚', '🏫',
]

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
}

function pick(e: string) {
  emit('select', e)
  open.value = false
}

function onDocDown(ev: PointerEvent) {
  if (open.value && root.value && !root.value.contains(ev.target as Node)) open.value = false
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && open.value) open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocDown)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="emoji">
    <button
      type="button"
      class="emoji-toggle"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="插入表情"
      title="插入表情"
      @click="toggle"
    >
      <component :is="PhSmiley" :size="18" aria-hidden="true" />
    </button>
    <transition name="emoji-pop">
      <div v-if="open" class="emoji-panel" role="menu" aria-label="常用表情">
        <button
          v-for="e in EMOJIS"
          :key="e"
          type="button"
          class="emoji-item"
          role="menuitem"
          @click="pick(e)"
        >{{ e }}</button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.emoji {
  position: relative;
}
.emoji-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s, transform 0.15s;
}
.emoji-toggle:hover,
.emoji-toggle[aria-expanded='true'] {
  background: var(--vp-c-bg-soft);
  color: var(--hs2-blue);
}
.emoji-toggle:active {
  transform: scale(0.92);
}
.emoji-toggle:focus-visible {
  outline: 2px solid var(--hs2-blue);
  outline-offset: 2px;
}
.emoji-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(8, 32px);
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  background: var(--vp-c-bg-elv);
  box-shadow: 0 6px 24px rgba(16, 24, 40, 0.12), 0 1px 3px rgba(16, 24, 40, 0.06);
}
.emoji-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--hs2-radius-sm);
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s, transform 0.15s;
}
.emoji-item:hover {
  background: var(--vp-c-bg-soft);
  transform: scale(1.15);
}
.emoji-item:focus-visible {
  outline: 2px solid var(--hs2-blue);
  outline-offset: -1px;
}

/* 弹层进出：轻微上浮 + 淡入 */
.emoji-pop-enter-active,
.emoji-pop-leave-active {
  transition: opacity 0.18s, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.emoji-pop-enter-from,
.emoji-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

@media (max-width: 640px) {
  /* 移动端贴边可用：8 列收窄为自适应，避免溢出屏幕 */
  .emoji-panel {
    grid-template-columns: repeat(6, 36px);
    left: -8px;
  }
  .emoji-item {
    width: 36px;
    height: 36px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .emoji-pop-enter-active,
  .emoji-pop-leave-active,
  .emoji-item,
  .emoji-toggle {
    transition: none;
  }
}
</style>
