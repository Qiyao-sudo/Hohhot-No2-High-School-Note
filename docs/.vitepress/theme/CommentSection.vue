<script setup lang="ts">
// 评论区编排组件：数据加载 / 能力探测 / 点赞与回复调度
// 视觉拆分到 comments/ 子组件；接口契约见 comments/api.ts 头部注释
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  PhChatsCircle,
  PhWarningCircle,
  PhChatCircleDots,
  PhInfo,
  PhSpinnerGap,
} from '@phosphor-icons/vue'
import CommentForm from './comments/CommentForm.vue'
import CommentItem from './comments/CommentItem.vue'
import {
  fetchComments,
  postLike,
  detectFeatures,
  type CommentItem as CommentItemT,
  type FeatureFlags,
} from './comments/api'
import { loadLiked, rememberLiked, forgetLiked } from './comments/utils'

const comments = ref<CommentItemT[]>([])
const total = ref(0)
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadError = ref('')
// 能力探测结果：当前后端不带 likes/replyTo 字段，两项默认 false → 对应 UI 不渲染
const features = ref<FeatureFlags>({ likes: false, replies: false })
const liked = ref<Set<string>>(new Set())
const replyTarget = ref<{ id: string; nick: string } | null>(null)
const formRef = ref<InstanceType<typeof CommentForm> | null>(null)
const listNotice = ref('') // 列表区提示（点赞失败等，自动消退）
let listNoticeTimer: ReturnType<typeof setTimeout> | null = null
let detected = false
let pagePath = '/messages'

// ---------------------------------------------------------------- 数据
async function load(reset: boolean) {
  if (reset) {
    comments.value = []
    nextCursor.value = null
  }
  loading.value = true
  loadError.value = ''
  try {
    const data = await fetchComments(pagePath, nextCursor.value)
    comments.value.push(...(data.comments ?? []))
    nextCursor.value = data.nextCursor ?? null
    total.value = Number(data.total) || 0
    if (!detected) {
      features.value = detectFeatures(data)
      detected = true
    }
  } catch (e: any) {
    loadError.value = e?.message || '评论加载失败，请稍后刷新重试。'
  } finally {
    loading.value = false
  }
}

function showListNotice(msg: string) {
  listNotice.value = msg
  if (listNoticeTimer) clearTimeout(listNoticeTimer)
  listNoticeTimer = setTimeout(() => (listNotice.value = ''), 4000)
}

// ---------------------------------------------------------------- 楼层归并
// 回复与楼主同卡：replyTo 链上溯到已加载的根评论, 全部后代归入该楼层的 replies(时间正序)；
// 根不在当前列表(更早页未加载/被删)的回复保持平铺并显示"回复 @"引用行。
interface Thread {
  comment: CommentItemT
  replies: CommentItemT[]
}
const threads = computed<Thread[]>(() => {
  const byId = new Map(comments.value.map((c) => [c.id, c]))
  const entry = new Map<string, Thread>()
  const all: Thread[] = []
  for (const c of comments.value) {
    const t: Thread = { comment: c, replies: [] }
    entry.set(c.id, t)
    all.push(t)
  }
  const roots: Thread[] = []
  for (const t of all) {
    let root = t
    let cur = t.comment
    let guard = 0
    while (cur.replyTo && guard++ < 20) {
      const parent = byId.get(cur.replyTo.id)
      const pe = parent && entry.get(parent.id)
      if (!parent || !pe || pe === root) break // 链断/防环 → 就地停
      root = pe
      cur = parent
    }
    if (root === t) roots.push(t)
    else root.replies.push(t.comment)
  }
  for (const t of roots) t.replies.sort((a, b) => a.time - b.time)
  return roots
})

// 提交结果分流：AI 初审通过 → 立即重载列表直接显示；
// 驳回 / 待人工 → 表单内已给出对应提示（驳回不显示原因），无需本地占位元素
async function onSubmitted(item: { nick: string; content: string; status: string }) {
  replyTarget.value = null
  if (item.status === 'approved') await load(true)
}

// 点赞：乐观 +1，失败回滚；接口不存在（后端未上线）则会话内隐藏点赞功能
async function onLike(c: CommentItemT) {
  if (liked.value.has(c.id)) return
  const before = c.likes ?? 0
  liked.value.add(c.id)
  rememberLiked(liked.value, c.id)
  c.likes = before + 1
  try {
    const data = await postLike(c.id)
    if (typeof data.likes === 'number') c.likes = data.likes
  } catch (e: any) {
    c.likes = before
    liked.value.delete(c.id)
    forgetLiked(liked.value, c.id)
    if (e?.status === 404) {
      features.value = { ...features.value, likes: false }
    } else {
      showListNotice(e?.message || '点赞失败，请稍后重试。')
    }
  }
}

function onReply(c: CommentItemT) {
  replyTarget.value = { id: c.id, nick: c.nick }
  formRef.value?.focus()
}

onMounted(() => {
  pagePath = location.pathname || '/messages'
  liked.value = loadLiked()
  load(true)
})
onUnmounted(() => {
  if (listNoticeTimer) clearTimeout(listNoticeTimer)
})
</script>

<template>
  <section class="comment-section">
    <header class="cs-head">
      <h2 id="comment" class="cs-title">
        <component :is="PhChatsCircle" :size="20" weight="duotone" aria-hidden="true" />
        评论留言
        <span v-if="total" class="cs-badge">{{ total }}</span>
      </h2>
      <p class="cs-info">
        <component :is="PhInfo" :size="14" weight="fill" aria-hidden="true" />
        <span>无需注册，填写昵称即可留言；提交后经<span class="cs-em">智能初审</span>，通过即公开，未通过将提示驳回。</span>
      </p>
    </header>

    <!-- ---------------- 表单 ---------------- -->
    <CommentForm
      ref="formRef"
      :reply-target="replyTarget"
      @submitted="onSubmitted"
      @cancel-reply="replyTarget = null"
    />

    <!-- ---------------- 列表 ---------------- -->
    <div class="cs-list">
      <!-- 骨架屏：与条目卡片同构，微光扫过 -->
      <template v-if="loading && !comments.length">
        <div v-for="n in 2" :key="'sk' + n" class="cs-skel" aria-hidden="true">
          <div class="cs-sk-circle"></div>
          <div class="cs-skel-body">
            <div class="cs-sk-line" style="width: 26%"></div>
            <div class="cs-sk-line" style="width: 84%"></div>
            <div class="cs-sk-line" style="width: 52%"></div>
          </div>
        </div>
      </template>

      <div v-else-if="loadError" class="cs-state">
        <span class="cs-state-icon">
          <component :is="PhWarningCircle" :size="26" weight="duotone" aria-hidden="true" />
        </span>
        <p class="cs-state-main">{{ loadError }}</p>
        <button class="cs-more" @click="load(true)">重试</button>
      </div>

      <div v-else-if="!comments.length" class="cs-state">
        <span class="cs-state-icon">
          <component :is="PhChatCircleDots" :size="26" weight="duotone" aria-hidden="true" />
        </span>
        <p class="cs-state-main">还没有留言</p>
        <p class="cs-state-sub">成为第一个留言的人，学长学姐会认真回复每一条。</p>
      </div>

      <template v-else>
        <CommentItem
          v-for="(t, i) in threads"
          :key="t.comment.id"
          :comment="t.comment"
          :replies="t.replies"
          :thread-root-id="t.comment.id"
          :features="features"
          :liked-ids="liked"
          :index="i"
          @like="onLike"
          @reply="onReply"
        />
        <div v-if="nextCursor" class="cs-more-wrap">
          <button class="cs-more" :disabled="loading" @click="load(false)">
            <component v-if="loading" :is="PhSpinnerGap" :size="15" class="cs-spin" aria-hidden="true" />
            {{ loading ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </template>
    </div>

    <transition name="cs-fade">
      <p v-if="listNotice" class="cs-listnotice">
        <component :is="PhWarningCircle" :size="15" weight="fill" aria-hidden="true" />
        {{ listNotice }}
      </p>
    </transition>
  </section>
</template>

<style scoped>
/* ------------------------------------------------ 基底 */
.comment-section {
  margin-top: 3rem;
  padding-top: 1.75rem;
  border-top: 1px solid var(--vp-c-divider);
}

/* ------------------------------------------------ 头部 */
.cs-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.4;
}
.cs-title svg {
  color: var(--hs2-blue);
}
.dark .cs-title svg {
  color: #8aa7f0;
}
.cs-badge {
  min-width: 24px;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--hs2-blue-soft);
  color: var(--hs2-blue);
  font-size: 0.55em;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.dark .cs-badge {
  color: #a8bdf2;
}
.cs-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  padding: 9px 14px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 0.86em;
  line-height: 1.6;
}
.cs-info svg {
  flex: none;
  color: var(--hs2-blue);
}
.dark .cs-info svg {
  color: #8aa7f0;
}
.cs-em {
  color: var(--hs2-blue);
  font-weight: 600;
}
.dark .cs-em {
  color: #a8bdf2;
}

/* ------------------------------------------------ 列表 */
.cs-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 1.6rem;
}
.cs-more-wrap {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}
.cs-more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 24px;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 0.86em;
  cursor: pointer;
  transition: border-color 0.25s, color 0.25s, transform 0.15s;
}
.cs-more:hover:not(:disabled) {
  border-color: var(--hs2-blue);
  color: var(--hs2-blue);
}
.dark .cs-more:hover:not(:disabled) {
  color: #a8bdf2;
  border-color: #a8bdf2;
}
.cs-more:active:not(:disabled) {
  transform: scale(0.96);
}
.cs-more:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.cs-more:focus-visible {
  outline: 2px solid var(--hs2-blue);
  outline-offset: 2px;
}
.cs-spin {
  animation: cs-rot 0.8s linear infinite;
}
@keyframes cs-rot {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------ 空态 / 错误态 */
.cs-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 2.6rem 0 1.8rem;
  color: var(--vp-c-text-3);
}
.cs-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-3);
}
.cs-state-main {
  margin: 0;
  color: var(--vp-c-text-2);
  font-weight: 600;
}
.cs-state-sub {
  margin: 0;
  font-size: 0.85em;
}

/* ------------------------------------------------ 骨架屏 */
.cs-skel {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  background: var(--vp-c-bg-elv);
  pointer-events: none;
}
.cs-skel-body {
  flex: 1;
  min-width: 0;
}
.cs-sk-circle,
.cs-sk-line {
  border-radius: 8px;
  background: linear-gradient(
    100deg,
    var(--vp-c-bg-soft) 40%,
    var(--vp-c-bg-alt, var(--vp-c-bg)) 50%,
    var(--vp-c-bg-soft) 60%
  );
  background-size: 200% 100%;
  animation: cs-shimmer 1.4s ease-in-out infinite;
}
.cs-sk-circle {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.cs-sk-line {
  height: 13px;
  margin-top: 10px;
}
.cs-sk-line:first-child {
  margin-top: 4px;
  height: 12px;
}
@keyframes cs-shimmer {
  from {
    background-position: 180% 0;
  }
  to {
    background-position: -80% 0;
  }
}

/* ------------------------------------------------ 列表区提示 */
.cs-listnotice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 12px 0 0;
  color: var(--vp-c-red-1, #c0392b);
  font-size: 0.84em;
}

/* ------------------------------------------------ 动效 */
.cs-fade-enter-active,
.cs-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.cs-fade-enter-from,
.cs-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* ------------------------------------------------ 移动端 */
@media (max-width: 640px) {
  .cs-title {
    font-size: 1.2rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cs-spin {
    animation: none;
  }
  .cs-sk-circle,
  .cs-sk-line {
    animation: none;
  }
  .cs-fade-enter-active,
  .cs-fade-leave-active,
  .cs-more {
    transition: none;
  }
}
</style>
