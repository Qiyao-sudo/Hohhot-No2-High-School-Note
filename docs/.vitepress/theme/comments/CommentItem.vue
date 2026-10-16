<script setup lang="ts">
// 单条评论卡片：头像 + 昵称/时间 + 回复引用行 + 正文 + 站长回复气泡 + 点赞/回复操作
// 支持楼层嵌套：根卡片通过 replies 渲染楼中楼(递归自身, nested 轻量样式)，
// 回复和楼主在同一张卡片里。
import { computed } from 'vue'
import { PhHeart, PhArrowBendUpLeft, PhSealCheck } from '@phosphor-icons/vue'
import type { CommentItem, FeatureFlags } from './api'
import { avatarFor, relTime, absTime } from './utils'

const props = defineProps<{
  comment: CommentItem
  features: FeatureFlags
  likedIds: Set<string> // 已赞集合(整棵楼层共用, 递归下传)
  index: number // 入场动画阶梯序号
  replies?: CommentItem[] // 楼中楼(仅根卡片使用, 按时间正序)
  threadRootId?: string // 所属楼层根评论 id(用于判断是否需要显示"回复 @"引用行)
  nested?: boolean // 楼中楼内的子卡片(轻量样式)
}>()

const emit = defineEmits<{
  (e: 'like', comment: CommentItem): void
  (e: 'reply', comment: CommentItem): void
}>()

const isLiked = computed(() => props.likedIds.has(props.comment.id))

const likeCount = computed(() =>
  typeof props.comment.likes === 'number' ? props.comment.likes : 0,
)

// 楼中楼里直接回复楼主的不再显示引用行(嵌套关系已可见)，楼中楼之间的互回复保留
const showReplyTo = computed(() => {
  if (!props.comment.replyTo) return false
  if (props.nested && props.threadRootId && props.comment.replyTo.id === props.threadRootId) return false
  return true
})

function onLike() {
  if (!isLiked.value) emit('like', props.comment) // 已赞过的不重复触发（本地去重，后端仍按 IP 幂等兜底）
}
</script>

<template>
  <article class="ci-card" :class="{ nested }" :style="{ '--i': Math.min(index, 8) }">
    <div class="ci-avatar" :style="{ background: avatarFor(comment.nick).bg }" aria-hidden="true">
      {{ avatarFor(comment.nick).initial }}
    </div>
    <div class="ci-body">
      <div class="ci-meta">
        <span class="ci-nick">{{ comment.nick }}</span>
        <span class="ci-dot" aria-hidden="true">·</span>
        <span class="ci-time" :title="absTime(comment.time)">{{ relTime(comment.time) }}</span>
        <span class="ci-actions">
          <button
            v-if="features.replies"
            type="button"
            class="ci-act"
            aria-label="回复这条评论"
            @click="emit('reply', comment)"
          >
            <component :is="PhArrowBendUpLeft" :size="15" aria-hidden="true" />
            <span class="ci-act-txt">回复</span>
          </button>
          <button
            v-if="features.likes"
            type="button"
            class="ci-act like"
            :class="{ on: isLiked }"
            :aria-pressed="isLiked"
            :aria-label="isLiked ? '已点赞' : '点赞'"
            :title="isLiked ? '已赞过' : '点赞'"
            @click="onLike"
          >
            <span :key="String(isLiked)" class="ci-heart" :class="{ pop: isLiked }">
              <component :is="PhHeart" :size="15" :weight="isLiked ? 'fill' : 'regular'" aria-hidden="true" />
            </span>
            <span v-if="likeCount > 0" class="ci-like-n">{{ likeCount }}</span>
          </button>
        </span>
      </div>

      <div v-if="showReplyTo" class="ci-replyto">
        回复 <span class="ci-replyto-nick">@{{ comment.replyTo!.nick }}</span>
      </div>

      <div class="ci-content">{{ comment.content }}</div>

      <div v-if="comment.reply" class="ci-owner">
        <div class="ci-owner-head">
          <span class="ci-owner-badge">
            <component :is="PhSealCheck" :size="13" weight="fill" aria-hidden="true" />
            站长
          </span>
          <span class="ci-time" :title="absTime(comment.reply.time)">{{ relTime(comment.reply.time) }}</span>
        </div>
        <div class="ci-owner-body">{{ comment.reply.content }}</div>
      </div>

      <!-- 楼中楼：回复与楼主同卡展示（递归渲染, 轻量样式） -->
      <div v-if="replies && replies.length" class="ci-children">
        <CommentItem
          v-for="(r, i) in replies"
          :key="r.id"
          :comment="r"
          :features="features"
          :liked-ids="likedIds"
          :index="i"
          :thread-root-id="threadRootId"
          nested
          @like="(c: CommentItem) => emit('like', c)"
          @reply="(c: CommentItem) => emit('reply', c)"
        />
      </div>
    </div>
  </article>
</template>

<style scoped>
/* ------------------------------------------------ 卡片基底 */
.ci-card {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  background: var(--vp-c-bg-elv);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
  transition: border-color 0.25s, box-shadow 0.25s;
  animation: ci-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}
.ci-card:hover {
  border-color: var(--hs2-blue-soft-2);
}
@keyframes ci-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ------------------------------------------------ 楼中楼容器与子卡片 */
.ci-children {
  margin-top: 12px;
  padding-left: 10px;
  border-left: 2px solid var(--vp-c-divider);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ci-card.nested {
  padding: 8px 10px;
  gap: 9px;
  border: none;
  border-radius: var(--hs2-radius-sm);
  background: var(--vp-c-bg-soft);
  box-shadow: none;
  animation-delay: calc(var(--i, 0) * 40ms);
}
.ci-card.nested:hover {
  border: none;
  background: var(--vp-c-bg);
}
.ci-card.nested .ci-avatar {
  width: 28px;
  height: 28px;
  font-size: 13px;
}
.ci-card.nested .ci-nick {
  font-size: 0.9em;
}
.ci-card.nested .ci-content {
  font-size: 0.92em;
  line-height: 1.65;
}
.ci-card.nested .ci-act {
  min-width: 28px;
  min-height: 28px;
  padding: 2px 6px;
}
.ci-card.nested .ci-owner {
  margin-top: 8px;
  padding: 8px 10px;
}

.ci-avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  user-select: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.ci-body {
  flex: 1;
  min-width: 0;
}

/* ------------------------------------------------ meta 行：昵称 · 时间 …… 操作 */
.ci-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ci-nick {
  font-weight: 700;
  font-size: 0.95em;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ci-dot {
  color: var(--vp-c-text-3);
  font-size: 0.8em;
}
.ci-time {
  flex: none;
  color: var(--vp-c-text-3);
  font-size: 0.78em;
  cursor: default;
}
.ci-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 操作按钮（回复 / 点赞）：ghost 风格，触控区 ≥ 32px */
.ci-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 32px;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--hs2-radius-sm);
  background: transparent;
  color: var(--vp-c-text-3);
  font: inherit;
  font-size: 0.8em;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s, transform 0.15s;
}
.ci-act:hover {
  background: var(--vp-c-bg-soft);
  color: var(--hs2-blue);
}
.dark .ci-act:hover {
  color: #a8bdf2;
}
.ci-act:active {
  transform: scale(0.92);
}
.ci-act:focus-visible {
  outline: 2px solid var(--hs2-blue);
  outline-offset: 2px;
}
.ci-act.like.on {
  color: var(--hs2-blue);
}
.dark .ci-act.like.on {
  color: #8aa7f0;
}
.ci-like-n {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.ci-heart {
  display: inline-flex;
}
/* 点赞瞬间的弹跳：key 变化触发重挂载从而重播动画 */
.ci-heart.pop {
  animation: ci-pop 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes ci-pop {
  0% {
    transform: scale(0.6);
  }
  55% {
    transform: scale(1.35);
  }
  100% {
    transform: scale(1);
  }
}

/* ------------------------------------------------ 回复引用行 */
.ci-replyto {
  margin-top: 4px;
  color: var(--vp-c-text-3);
  font-size: 0.82em;
}
.ci-replyto-nick {
  color: var(--hs2-blue);
  font-weight: 600;
}
.dark .ci-replyto-nick {
  color: #a8bdf2;
}

/* ------------------------------------------------ 正文 */
.ci-content {
  margin-top: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--vp-c-text-1);
  line-height: 1.75;
}

/* ------------------------------------------------ 站长回复气泡 */
.ci-owner {
  margin-top: 12px;
  padding: 10px 14px;
  border: 1px solid var(--hs2-blue-soft-2);
  border-radius: var(--hs2-radius);
  background: var(--hs2-blue-soft);
}
.ci-owner-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ci-owner-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--hs2-blue);
  color: #fff;
  font-size: 0.72em;
  font-weight: 600;
  line-height: 1.8;
}
.ci-owner-body {
  margin-top: 5px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.94em;
  line-height: 1.7;
  color: var(--vp-c-text-1);
}

/* ------------------------------------------------ 移动端 */
@media (max-width: 640px) {
  .ci-card {
    padding: 12px 14px;
    gap: 10px;
  }
  .ci-avatar {
    width: 34px;
    height: 34px;
    font-size: 14px;
  }
  .ci-meta {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .ci-act {
    min-width: 40px;
    min-height: 40px;
  }
  .ci-children {
    padding-left: 6px;
    margin-top: 10px;
  }
  .ci-card.nested {
    padding: 7px 8px;
  }
  .ci-card.nested .ci-avatar {
    width: 24px;
    height: 24px;
    font-size: 11px;
  }
  .ci-card.nested .ci-act {
    min-width: 32px;
    min-height: 32px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ci-card {
    animation: none;
    transition: none;
  }
  .ci-heart.pop {
    animation: none;
  }
  .ci-act {
    transition: none;
  }
}
</style>
