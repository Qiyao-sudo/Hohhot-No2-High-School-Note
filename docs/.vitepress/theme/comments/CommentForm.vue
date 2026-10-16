<script setup lang="ts">
// 留言表单卡片：昵称 + 自动增高输入框 + 表情/字数/提交工具栏 + 回复模式
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  PhPaperPlaneRight,
  PhCheckCircle,
  PhWarningCircle,
  PhArrowBendUpLeft,
  PhX,
} from '@phosphor-icons/vue'
import EmojiPanel from './EmojiPanel.vue'
import { postComment } from './api'
import { avatarFor } from './utils'

const props = defineProps<{
  replyTarget: { id: string; nick: string } | null
}>()

const emit = defineEmits<{
  (e: 'submitted', item: { nick: string; content: string; status: 'approved' | 'pending' | 'rejected' }): void
  (e: 'cancel-reply'): void
}>()

const NICK_KEY = 'hs2-comment-nick'
const CONTENT_MAX = 500

const nick = ref('')
const content = ref('')
const sending = ref(false)
const notice = ref('') // 提交结果提示（自动消退）
const noticeKind = ref<'ok' | 'reject'>('ok') // 通过/待审=正常，驳回=警示样式
const error = ref('') // 提交错误提示
const ta = ref<HTMLTextAreaElement | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

const canSubmit = computed(() => !!nick.value.trim() && !!content.value.trim() && !sending.value)

// ---------------------------------------------------------------- 输入框自动增高（min 88 / max 320）
function grow() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 88), 320)}px`
}

// 表情插到光标处并保持焦点；超长则放弃本次插入
function insertEmoji(e: string) {
  const el = ta.value
  if (!el) {
    content.value += e
    return
  }
  const start = el.selectionStart ?? content.value.length
  const end = el.selectionEnd ?? content.value.length
  const next = content.value.slice(0, start) + e + content.value.slice(end)
  if (next.length > CONTENT_MAX) return
  content.value = next
  nextTick(() => {
    const pos = start + e.length
    el.focus()
    el.setSelectionRange(pos, pos)
    grow()
  })
}

// 进入回复模式时表单滚动到视口中央并聚焦（由父组件调用）
function focus() {
  const el = ta.value
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.closest('form')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  el.focus({ preventScroll: true })
}
defineExpose({ focus })

function showNotice(msg: string) {
  notice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 4000)
}

async function submit() {
  if (sending.value) return
  notice.value = ''
  if (!nick.value.trim()) {
    error.value = '请填写昵称。'
    return
  }
  if (!content.value.trim()) {
    error.value = '请填写留言内容。'
    return
  }
  sending.value = true
  error.value = ''
  const nickTrim = nick.value.trim()
  const contentTrim = content.value.trim()
  try {
    const data = await postComment({
      nick: nickTrim,
      content: contentTrim,
      page: location.pathname,
      ...(props.replyTarget ? { replyTo: props.replyTarget.id } : {}),
    })
    localStorage.setItem(NICK_KEY, nickTrim)
    const status = data.status || 'pending'
    emit('submitted', { nick: nickTrim, content: contentTrim, status })
    content.value = ''
    nextTick(grow)
    noticeKind.value = status === 'rejected' ? 'reject' : 'ok'
    showNotice(
      status === 'rejected'
        ? '留言审核被驳回。'
        : data.message || '留言已提交，审核通过后会公开显示。',
    )
  } catch (e: any) {
    error.value = e?.message || '提交失败，请稍后重试。'
  } finally {
    sending.value = false
  }
}

watch(content, () => nextTick(grow))

onMounted(() => {
  nick.value = localStorage.getItem(NICK_KEY) || ''
  grow()
})
onUnmounted(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
})
</script>

<template>
  <form class="cf-card" @submit.prevent="submit">
    <span class="sr-only" aria-hidden="true">评论区表单</span>
    <div class="cf-avatar" :style="{ background: avatarFor(nick).bg }" aria-hidden="true">
      {{ avatarFor(nick).initial }}
    </div>
    <div class="cf-main">
      <transition name="cf-fade">
        <div v-if="replyTarget" class="cf-replybar">
          <component :is="PhArrowBendUpLeft" :size="14" aria-hidden="true" />
          <span class="cf-replybar-txt">回复 <span class="cf-replybar-nick">@{{ replyTarget.nick }}</span></span>
          <button type="button" class="cf-replybar-x" aria-label="取消回复" @click="emit('cancel-reply')">
            <component :is="PhX" :size="13" weight="bold" aria-hidden="true" />
          </button>
        </div>
      </transition>

      <label class="sr-only" for="cf-nick">昵称（必填）</label>
      <input
        id="cf-nick"
        v-model="nick"
        class="cf-nick"
        type="text"
        maxlength="24"
        placeholder="昵称（必填）"
        autocomplete="off"
      >

      <label class="sr-only" for="cf-content">留言内容（必填）</label>
      <textarea
        id="cf-content"
        ref="ta"
        v-model="content"
        class="cf-textarea"
        rows="3"
        :maxlength="CONTENT_MAX"
        placeholder="写下你的留言或问题…"
        @input="grow"
      ></textarea>

      <div class="cf-foot">
        <EmojiPanel @select="insertEmoji" />
        <span class="cf-count" :class="{ warn: content.length >= CONTENT_MAX * 0.9 }">
          {{ content.length }}/{{ CONTENT_MAX }}
        </span>
        <button type="submit" class="cf-send" :disabled="!canSubmit">
          <component :is="PhPaperPlaneRight" :size="15" weight="bold" aria-hidden="true" />
          {{ sending ? '提交中…' : replyTarget ? '提交回复' : '提交留言' }}
        </button>
      </div>

      <transition name="cf-fade">
        <p v-if="notice && noticeKind === 'reject'" class="cf-msg err" role="status">
          <component :is="PhWarningCircle" :size="15" weight="fill" aria-hidden="true" />
          {{ notice }}
        </p>
        <p v-else-if="notice" class="cf-msg ok" role="status">
          <component :is="PhCheckCircle" :size="15" weight="fill" aria-hidden="true" />
          {{ notice }}
        </p>
        <p v-else-if="error" class="cf-msg err">
          <component :is="PhWarningCircle" :size="15" weight="fill" aria-hidden="true" />
          {{ error }}
        </p>
      </transition>
    </div>
  </form>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ------------------------------------------------ 卡片：整卡 focus-within 高亮 */
.cf-card {
  display: flex;
  gap: 12px;
  margin-top: 1.4rem;
  padding: 16px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  background: var(--vp-c-bg-elv);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px -16px rgba(16, 24, 40, 0.08);
  transition: border-color 0.25s, box-shadow 0.25s;
}
.cf-card:focus-within {
  border-color: var(--hs2-blue);
  box-shadow: 0 0 0 3px var(--hs2-blue-soft);
}

.cf-avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  user-select: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.cf-main {
  flex: 1;
  min-width: 0;
}

/* ------------------------------------------------ 回复模式提示条 */
.cf-replybar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 4px 8px 4px 10px;
  border: 1px solid var(--hs2-blue-soft-2);
  border-radius: 999px;
  background: var(--hs2-blue-soft);
  color: var(--hs2-blue);
  font-size: 0.8em;
  font-weight: 600;
}
.dark .cf-replybar {
  color: #a8bdf2;
}
.cf-replybar-nick {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cf-replybar-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s, background-color 0.2s;
}
.cf-replybar-x:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.08);
}
.dark .cf-replybar-x:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* ------------------------------------------------ 输入控件 */
.cf-nick,
.cf-textarea {
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--hs2-radius-sm);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
  outline: none;
  transition: border-color 0.25s, background-color 0.25s;
}
.cf-nick {
  max-width: 220px;
  padding: 7px 12px;
  margin-bottom: 8px;
  border-radius: 999px;
}
.cf-textarea {
  display: block;
  padding: 10px 12px;
  line-height: 1.7;
  min-height: 88px;
  max-height: 320px;
  resize: none; /* 高度交给自动增高，避免双向拉扯 */
  overflow-y: auto;
}
.cf-nick:focus-visible,
.cf-textarea:focus-visible {
  border-color: var(--hs2-blue);
  background: var(--vp-c-bg);
}
.cf-nick::placeholder,
.cf-textarea::placeholder {
  color: var(--vp-c-text-3);
}

/* ------------------------------------------------ 底部工具栏 */
.cf-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.cf-count {
  margin-left: auto;
  color: var(--vp-c-text-3);
  font-size: 0.75em;
  font-variant-numeric: tabular-nums;
}
.cf-count.warn {
  color: var(--vp-c-yellow-1, #b45309);
  font-weight: 600;
}
.cf-send {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border: none;
  border-radius: 999px;
  background: var(--hs2-blue);
  color: #fff;
  font: inherit;
  font-size: 0.9em;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.25s, transform 0.15s, opacity 0.2s;
}
.cf-send:hover:not(:disabled) {
  background: var(--hs2-blue-deep);
}
.cf-send:active:not(:disabled) {
  transform: scale(0.96);
}
.cf-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ------------------------------------------------ 提交反馈 */
.cf-msg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 8px 0 0;
  font-size: 0.84em;
}
.cf-msg.ok {
  color: var(--vp-c-green-1, #1a9e5c);
}
.cf-msg.err {
  color: var(--vp-c-red-1, #c0392b);
}

/* ------------------------------------------------ 动效 */
.cf-fade-enter-active,
.cf-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.cf-fade-enter-from,
.cf-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* ------------------------------------------------ 移动端 */
@media (max-width: 640px) {
  .cf-card {
    padding: 14px;
  }
  .cf-avatar {
    display: none;
  }
  .cf-nick {
    max-width: none;
  }
  .cf-send {
    padding: 8px 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cf-card,
  .cf-send,
  .cf-fade-enter-active,
  .cf-fade-leave-active {
    transition: none;
  }
}
</style>
